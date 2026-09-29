'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Nicht angemeldet'); }
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
  return body;
}

function relTime(iso) {
  if (!iso) return 'nie';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  const d = Math.round(s / 86400);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

const fmtDate = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtCoord = (p) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

function toast(title, body = '', kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${body ? `<span>${escapeHtml(body)}</span>` : ''}`;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 5500);
  setTimeout(() => el.remove(), 6000);
}

function distanceM(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const ALARM_LABEL = { motion: 'Erschütterung', movement: 'Bewegung', low_battery: 'Akku schwach' };
const STATUS_LABEL = { open: 'offen', acknowledged: 'gesehen', resolved: 'erledigt' };

/* ------------------------------------------------------------------ state */

const state = {
  devices: [],
  selectedId: null,
  device: null,     // detail of the selected device (incl. api key)
  alarms: [],
  track: [],
  readings: [],
  rangeHours: 24,
  keyVisible: false,
};

/* ------------------------------------------------------------------ map */

let map = null;
const layers = {};

async function initMap() {
  if (!window.L) {
    $('map').innerHTML = '<p class="map-fallback">Karte konnte nicht geladen werden.</p>';
    return;
  }
  const { map: tiles } = await api('/config');
  map = L.map('map', { zoomControl: true }).setView([52.52, 13.405], 13);
  L.tileLayer(tiles.tile_url, {
    maxZoom: tiles.max_zoom,
    attribution: tiles.attribution,
    // Tile servers like OpenStreetMap reject requests without a Referer
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  layers.track = L.polyline([], { color: '#0f9d74', weight: 4, opacity: 0.85 }).addTo(map);
  layers.alarms = L.layerGroup().addTo(map);
  layers.armed = L.layerGroup().addTo(map);
  layers.current = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: '<div class="bike-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
  });
}

function renderMap(fit = false) {
  const d = state.device;
  if (!map || !d) return;
  map.invalidateSize();
  const pts = state.track.map((p) => [p.lat, p.lon]);
  layers.track.setLatLngs(pts);

  layers.armed.clearLayers();
  if (d.armed && d.armed_position) {
    const c = [d.armed_position.lat, d.armed_position.lon];
    L.circle(c, { radius: d.move_radius_m, color: '#5b6b7a', weight: 1, dashArray: '4 4', fillOpacity: 0.06 }).addTo(layers.armed);
    L.circleMarker(c, { radius: 5, color: '#5b6b7a', fillColor: '#fff', fillOpacity: 1, weight: 2 })
      .bindTooltip('Abstellort (scharf geschaltet)').addTo(layers.armed);
  }

  layers.alarms.clearLayers();
  for (const a of state.alarms) {
    if (a.lat == null || a.status === 'resolved') continue;
    L.circleMarker([a.lat, a.lon], { radius: 7, color: '#e5484d', fillColor: '#e5484d', fillOpacity: 0.35, weight: 2 })
      .bindTooltip(`${ALARM_LABEL[a.type]} · ${fmtDate(a.created_at)}`).addTo(layers.alarms);
  }

  const alarmed = d.open_alarms > 0;
  if (d.position) {
    layers.current.setLatLng([d.position.lat, d.position.lon]).addTo(map);
    layers.current.getElement()?.firstChild?.classList.toggle('alarm', alarmed);
  } else {
    layers.current.remove();
  }

  if (fit) {
    const bounds = L.latLngBounds(pts);
    if (d.position) bounds.extend([d.position.lat, d.position.lon]);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }
}

function trackLengthKm(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += distanceM(points[i - 1], points[i]);
  return m / 1000;
}

/* ------------------------------------------------------------------ chart */

function renderChart() {
  const el = $('chart');
  const data = state.readings.filter((r) => r.magnitude != null);
  const d = state.device;
  if (!data.length || !d) { el.innerHTML = '<p class="muted small">Noch keine Messwerte.</p>'; return; }

  const W = 600; const H = 180; const P = 28;
  const dev = data.map((r) => Math.abs(r.magnitude - 1));
  const max = Math.max(d.motion_threshold * 1.6, ...dev, 0.2);
  const x = (i) => P + (i / Math.max(data.length - 1, 1)) * (W - P - 8);
  const y = (v) => H - 20 - (v / max) * (H - 36);
  const line = dev.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(dev.length - 1).toFixed(1)},${H - 20}L${x(0)},${H - 20}Z`;
  const ty = y(d.motion_threshold);
  const ticks = [0, max / 2, max].map((v) =>
    `<text x="${P - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>` +
    `<line x1="${P}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join('');
  const peaks = dev.map((v, i) => (v >= d.motion_threshold ? `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" class="peak"/>` : '')).join('');
  const first = new Date(data[0].recorded_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const last = new Date(data[data.length - 1].recorded_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${ticks}
    <path d="${area}" class="area"/>
    <path d="${line}" class="line"/>
    <line x1="${P}" x2="${W - 8}" y1="${ty}" y2="${ty}" class="threshold"/>
    ${peaks}
    <text x="${P}" y="${H - 4}">${first}</text>
    <text x="${W - 8}" y="${H - 4}" text-anchor="end">${last}</text>
  </svg>`;
}

/* ------------------------------------------------------------------ rendering */

function batteryClass(b) { return b == null ? '' : b <= 15 ? 'bad' : b <= 35 ? 'warn' : 'good'; }
function rssiText(r) {
  if (r == null) return ['–', ''];
  const q = r >= -60 ? 'sehr gut' : r >= -70 ? 'gut' : r >= -80 ? 'mittel' : 'schwach';
  return [`${r} dBm`, q];
}

function renderDeviceList() {
  const list = $('device-list');
  list.innerHTML = state.devices.map((d) => `
    <li>
      <button class="device-item ${d.id === state.selectedId ? 'active' : ''} ${d.open_alarms ? 'has-alarm' : ''}" data-id="${d.id}">
        <span class="device-item-top">
          <span class="status-dot ${d.status}" title="${d.status}"></span>
          <strong>${escapeHtml(d.name)}</strong>
          ${d.open_alarms ? `<span class="badge badge-alarm">${d.open_alarms} Alarm</span>` : ''}
        </span>
        <span class="device-item-meta">
          <span class="pill ${d.armed ? 'pill-armed' : ''}">${d.armed ? 'Scharf' : 'Unscharf'}</span>
          <span class="pill">🔋 ${d.battery ?? '–'} %</span>
          <span class="muted small">${relTime(d.last_seen)}</span>
        </span>
      </button>
    </li>`).join('');
  $('empty-state').hidden = state.devices.length > 0;
  $('device-view').hidden = state.devices.length === 0;
}

function renderDevice() {
  const d = state.device;
  if (!d) return;
  document.title = `${d.name} – BikeGuard360`;
  $('device-name').textContent = d.name;
  $('device-sub').textContent = `${d.serial} · Firmware ${d.firmware || '–'}`;

  $('arm-toggle').checked = d.armed;
  $('arm-label').textContent = d.armed ? `Scharf seit ${relTime(d.armed_at).replace('vor ', '')}` : 'Unscharf';
  $('arm-switch').classList.toggle('on', d.armed);

  const statusText = { online: 'Online', offline: 'Offline', never: 'Nie verbunden' }[d.status];
  $('tile-status').innerHTML = `<span class="status-dot ${d.status}"></span> ${statusText}`;
  $('tile-status-sub').textContent = `Letzte Meldung ${relTime(d.last_seen)}`;

  $('tile-battery').textContent = d.battery != null ? `${d.battery} %` : '–';
  const bar = $('tile-battery-bar');
  bar.style.width = `${d.battery ?? 0}%`;
  bar.className = batteryClass(d.battery);

  const [rv, rq] = rssiText(d.rssi);
  $('tile-rssi').textContent = rv;
  $('tile-rssi-sub').textContent = rq;

  $('tile-alarms').textContent = d.open_alarms;
  $('tile-alarms').classList.toggle('alarm-text', d.open_alarms > 0);
  $('tile-alarms-sub').textContent = d.open_alarms ? 'Bitte prüfen!' : 'Alles ruhig';

  if (d.position) {
    $('map-position').textContent = `📍 ${fmtCoord(d.position)}`;
    const link = $('map-link');
    link.href = `https://www.openstreetmap.org/?mlat=${d.position.lat}&mlon=${d.position.lon}#map=17/${d.position.lat}/${d.position.lon}`;
    link.hidden = false;
  } else {
    $('map-position').textContent = 'Noch keine GPS-Position';
    $('map-link').hidden = true;
  }

  // Alarm banner for open theft alarms
  const open = state.alarms.filter((a) => a.status === 'open');
  const theft = open.find((a) => a.type === 'movement') || open.find((a) => a.type === 'motion') || open[0];
  $('alarm-banner').hidden = !theft;
  if (theft) {
    $('alarm-banner-title').textContent = theft.type === 'low_battery' ? 'Akku fast leer' : 'Diebstahlalarm!';
    let text = theft.message || '';
    if (theft.type === 'movement' && d.armed_position && d.position) {
      text = `Dein Fahrrad ist ${Math.round(distanceM(d.armed_position, d.position))} m vom Abstellort entfernt (letzte Meldung ${relTime(d.last_seen)}).`;
    }
    $('alarm-banner-body').textContent = text;
    $('alarm-banner').classList.toggle('warn', theft.type === 'low_battery');
  }

  // Settings form (don't overwrite while the user is editing)
  const f = $('settings-form');
  if (!f.contains(document.activeElement)) {
    f.name.value = d.name;
    f.motion_threshold.value = d.motion_threshold;
    f.move_radius_m.value = d.move_radius_m;
    $('threshold-out').textContent = Number(d.motion_threshold).toFixed(2);
    $('radius-out').textContent = d.move_radius_m;
  }
  $('api-key').textContent = state.keyVisible ? d.api_key : '•'.repeat(16);
  $('key-show').textContent = state.keyVisible ? 'Verbergen' : 'Anzeigen';
}

function renderAlarms() {
  const list = $('alarm-list');
  if (!state.alarms.length) { list.innerHTML = '<li class="muted small">Keine Alarme – alles ruhig.</li>'; return; }
  list.innerHTML = state.alarms.slice(0, 20).map((a) => `
    <li class="alarm-item ${a.status}">
      <span class="alarm-type type-${a.type}">${ALARM_LABEL[a.type]}</span>
      <span class="alarm-info">
        <span>${escapeHtml(a.message || '')}</span>
        <span class="muted small">${fmtDate(a.created_at)} · ${STATUS_LABEL[a.status]}</span>
      </span>
      ${a.status === 'open' ? `<button class="link-btn" data-ack="${a.id}">Gesehen</button>` : ''}
    </li>`).join('');
}

function renderTrackInfo() {
  const n = state.track.length;
  $('map-track-info').textContent = n ? `${n} Positionen · ${trackLengthKm(state.track).toFixed(1)} km` : 'Keine Positionen im Zeitraum';
}

/* ------------------------------------------------------------------ data loading */

async function loadDevices() {
  const { devices } = await api('/devices');
  state.devices = devices;
  if (!devices.find((d) => d.id === state.selectedId)) {
    const fromHash = Number(location.hash.slice(1));
    const alarmed = devices.find((d) => d.open_alarms > 0);
    state.selectedId = (devices.find((d) => d.id === fromHash) || alarmed || devices[0])?.id ?? null;
  }
  renderDeviceList();
}

async function loadTrack(fit) {
  const from = new Date(Date.now() - state.rangeHours * 3600 * 1000).toISOString();
  const { points } = await api(`/devices/${state.selectedId}/track?from=${encodeURIComponent(from)}`);
  state.track = points;
  renderTrackInfo();
  renderMap(fit);
}

async function selectDevice(id, { fit = true } = {}) {
  state.selectedId = id;
  state.keyVisible = false;
  history.replaceState(null, '', `#${id}`);
  renderDeviceList();
  if (id == null) return;
  const [{ device }, { alarms }, { readings }] = await Promise.all([
    api(`/devices/${id}`),
    api(`/alarms?device_id=${id}&limit=50`),
    api(`/devices/${id}/readings?limit=120`),
  ]);
  state.device = device;
  state.alarms = alarms;
  state.readings = readings;
  renderDevice();
  renderAlarms();
  renderChart();
  await loadTrack(fit);
  document.body.classList.remove('sidebar-open');
}

async function refreshSelected() {
  if (state.selectedId == null) return;
  const [{ device }, { alarms }] = await Promise.all([
    api(`/devices/${state.selectedId}`),
    api(`/alarms?device_id=${state.selectedId}&limit=50`),
  ]);
  state.device = device;
  state.alarms = alarms;
  renderDevice();
  renderAlarms();
  renderMap();
}

async function loadNotifications() {
  const { notifications, unread } = await api('/notifications');
  const count = $('notif-count');
  count.textContent = unread > 9 ? '9+' : unread;
  count.hidden = unread === 0;
  $('notif-list').innerHTML = notifications.length
    ? notifications.map((n) => `
      <li class="${n.read ? '' : 'unread'}">
        <button class="notif-item" data-device="${n.device_id ?? ''}">
          <strong>${escapeHtml(n.title)}</strong>
          <span>${escapeHtml(n.body)}</span>
          <span class="muted small">${relTime(n.created_at)}</span>
        </button>
      </li>`).join('')
    : '<li class="muted small notif-empty">Keine Benachrichtigungen</li>';
}

/* ------------------------------------------------------------------ live updates (SSE) */

function connectLive() {
  const live = $('live');
  const es = new EventSource('/api/events');
  es.onopen = () => live.classList.add('on');
  es.onerror = () => live.classList.remove('on');

  es.addEventListener('device', (e) => {
    const d = JSON.parse(e.data);
    const i = state.devices.findIndex((x) => x.id === d.id);
    if (i > -1) state.devices[i] = d; else state.devices.push(d);
    renderDeviceList();
    if (d.id === state.selectedId) {
      state.device = { ...state.device, ...d };
      renderDevice();
      renderMap();
    }
  });

  es.addEventListener('position', (e) => {
    const p = JSON.parse(e.data);
    if (p.device_id !== state.selectedId) return;
    state.track.push(p);
    renderTrackInfo();
    renderMap();
  });

  es.addEventListener('alarm', (e) => {
    const a = JSON.parse(e.data);
    if (a.device_id === state.selectedId) refreshSelected();
    loadDevices();
  });

  es.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    toast(n.title, n.body, 'alarm');
    loadNotifications();
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(n.title, { body: n.body, icon: '/img/favicon.svg', tag: `bg360-${n.alarm_id}` });
    }
  });

  // Also refresh sensor chart for the selected device every 30 s
  setInterval(async () => {
    if (state.selectedId == null) return;
    const { readings } = await api(`/devices/${state.selectedId}/readings?limit=120`);
    state.readings = readings;
    renderChart();
  }, 30000);
  // Keep relative times fresh
  setInterval(() => { renderDeviceList(); renderDevice(); }, 30000);
}

/* ------------------------------------------------------------------ actions */

async function updateDevice(changes) {
  const { device } = await api(`/devices/${state.selectedId}`, { method: 'PATCH', body: changes });
  state.device = device;
  const i = state.devices.findIndex((x) => x.id === device.id);
  if (i > -1) state.devices[i] = device;
  renderDeviceList();
  renderDevice();
  return device;
}

async function setAlarmStatus(id, status) {
  await api(`/alarms/${id}`, { method: 'PATCH', body: { status } });
  await refreshSelected();
  await loadDevices();
}

function bindEvents() {
  $('device-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.device-item');
    if (btn) selectDevice(Number(btn.dataset.id));
  });

  $('arm-toggle').addEventListener('change', async (e) => {
    const armed = e.target.checked;
    try {
      await updateDevice({ armed });
      toast(armed ? 'Gerät scharf geschaltet' : 'Gerät unscharf geschaltet',
        armed ? 'Du wirst bei Erschütterung oder Bewegung benachrichtigt.' : 'Offene Diebstahlalarme wurden geschlossen.');
      await refreshSelected();
    } catch (err) {
      e.target.checked = !armed;
      toast('Fehler', err.message, 'alarm');
    }
  });

  $('range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('range').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state.rangeHours = Number(b.dataset.hours);
    loadTrack(true);
  });

  $('alarm-list').addEventListener('click', (e) => {
    const id = e.target.dataset.ack;
    if (id) setAlarmStatus(id, 'acknowledged');
  });

  $('alarm-ack').addEventListener('click', async () => {
    for (const a of state.alarms.filter((x) => x.status === 'open')) await api(`/alarms/${a.id}`, { method: 'PATCH', body: { status: 'acknowledged' } });
    await refreshSelected(); await loadDevices();
  });
  $('alarm-resolve').addEventListener('click', async () => {
    if (!confirm('Entwarnung geben? Alle offenen Alarme dieses Geräts werden geschlossen.')) return;
    for (const a of state.alarms.filter((x) => x.status !== 'resolved')) await api(`/alarms/${a.id}`, { method: 'PATCH', body: { status: 'resolved' } });
    await refreshSelected(); await loadDevices();
  });
  $('alarm-locate').addEventListener('click', () => {
    const p = state.device?.position;
    if (map && p) map.setView([p.lat, p.lon], 17);
    $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Settings
  const f = $('settings-form');
  f.motion_threshold.addEventListener('input', () => { $('threshold-out').textContent = Number(f.motion_threshold.value).toFixed(2); });
  f.move_radius_m.addEventListener('input', () => { $('radius-out').textContent = f.move_radius_m.value; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await updateDevice({ name: f.name.value, motion_threshold: Number(f.motion_threshold.value), move_radius_m: Number(f.move_radius_m.value) });
      document.activeElement.blur();
      renderChart();
      renderMap();
      toast('Einstellungen gespeichert');
    } catch (err) { toast('Fehler', err.message, 'alarm'); }
  });
  $('key-show').addEventListener('click', () => { state.keyVisible = !state.keyVisible; renderDevice(); });
  $('key-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.device.api_key); toast('Schlüssel kopiert'); } catch { toast('Kopieren nicht möglich', '', 'alarm'); }
  });
  $('key-regen').addEventListener('click', async () => {
    if (!confirm('Neuen Schlüssel erzeugen? Das Gerät muss danach mit dem neuen Schlüssel konfiguriert werden.')) return;
    const { device } = await api(`/devices/${state.selectedId}/regenerate-key`, { method: 'POST' });
    state.device = device; state.keyVisible = true; renderDevice();
  });
  $('device-delete').addEventListener('click', async () => {
    if (!confirm(`„${state.device.name}“ wirklich entfernen? Alle Daten des Geräts werden gelöscht.`)) return;
    await api(`/devices/${state.selectedId}`, { method: 'DELETE' });
    state.selectedId = null;
    await loadDevices();
    await selectDevice(state.selectedId);
    toast('Gerät entfernt');
  });

  // Add device dialog
  const dialog = $('add-dialog');
  const openAdd = () => { $('add-error').hidden = true; $('add-form').reset(); dialog.showModal(); };
  $('add-device').addEventListener('click', openAdd);
  $('add-device-empty').addEventListener('click', openAdd);
  $('add-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const form = e.target;
    try {
      const { device } = await api('/devices', { method: 'POST', body: { name: form.name.value, serial: form.serial.value } });
      dialog.close();
      await loadDevices();
      await selectDevice(device.id);
      state.keyVisible = true;
      renderDevice();
      toast('Gerät hinzugefügt', 'Trage den Geräteschlüssel in die Firmware ein.');
    } catch (err) {
      $('add-error').textContent = err.message;
      $('add-error').hidden = false;
    }
  });

  // Notifications
  const panel = $('notif-panel');
  $('notif-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    $('notif-btn').setAttribute('aria-expanded', String(!panel.hidden));
    $('push-enable').hidden = !('Notification' in window) || Notification.permission !== 'default';
  });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
  $('notif-read').addEventListener('click', async () => { await api('/notifications/read-all', { method: 'POST' }); loadNotifications(); });
  $('notif-list').addEventListener('click', (e) => {
    const item = e.target.closest('.notif-item');
    if (item?.dataset.device) { panel.hidden = true; selectDevice(Number(item.dataset.device)); }
  });
  $('push-enable').addEventListener('click', async () => {
    const p = await Notification.requestPermission();
    $('push-enable').hidden = true;
    if (p === 'granted') toast('Browser-Benachrichtigungen aktiv');
  });

  $('logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = '/';
  });

  $('sidebar-toggle').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
}

/* ------------------------------------------------------------------ start */

(async function init() {
  const { user } = await api('/auth/me');
  $('user-name').textContent = user.name;
  await initMap();
  bindEvents();
  await loadDevices();
  await Promise.all([selectDevice(state.selectedId), loadNotifications()]);
  connectLive();
})().catch((err) => toast('Fehler beim Laden', err.message, 'alarm'));
