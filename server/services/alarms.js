'use strict';

const config = require('../config');
const events = require('./events');
const { notify } = require('./notify');
const { distanceMeters } = require('./geo');
const { serializeDevice } = require('./devices');

const ALARM_TEXT = {
  motion: {
    title: (d) => `Alarm: Erschütterung an „${d.name}“`,
    body: (a) => `Dein Fahrrad wurde bei scharf geschaltetem Gerät bewegt (${a.magnitude?.toFixed(2)} g).`,
  },
  movement: {
    title: (d) => `Alarm: „${d.name}“ wird bewegt`,
    body: (a) => `Dein Fahrrad hat sich ${Math.round(a.distance)} m vom Abstellort entfernt. Standort im Dashboard ansehen.`,
  },
  low_battery: {
    title: (d) => `Akku schwach: „${d.name}“`,
    body: (a) => `Der Akku deines BikeGuard360 liegt bei ${a.battery} %. Bitte bald aufladen.`,
  },
};

const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Normalise one telemetry packet from the ESP32
function parseReading(raw) {
  const accel = raw.accel || {};
  const gps = raw.gps || {};
  const ts = raw.ts ? new Date(typeof raw.ts === 'number' && raw.ts < 1e12 ? raw.ts * 1000 : raw.ts) : new Date();
  const reading = {
    recorded_at: Number.isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
    accel_x: num(accel.x),
    accel_y: num(accel.y),
    accel_z: num(accel.z),
    lat: num(gps.lat),
    lon: num(gps.lon),
    speed_kmh: num(gps.speed),
    satellites: num(gps.sats),
    hdop: num(gps.hdop),
    battery: num(raw.battery),
    rssi: num(raw.rssi),
    firmware: typeof raw.fw === 'string' ? raw.fw.slice(0, 32) : null,
  };
  if (reading.lat != null && (Math.abs(reading.lat) > 90 || Math.abs(reading.lon ?? 999) > 180)) {
    reading.lat = reading.lon = null;
  }
  if (reading.lon == null) reading.lat = null;
  reading.magnitude = reading.accel_x != null && reading.accel_y != null && reading.accel_z != null
    ? Math.sqrt(reading.accel_x ** 2 + reading.accel_y ** 2 + reading.accel_z ** 2)
    : num(raw.magnitude);
  return reading;
}

// Create a new alarm, or refresh a recent one of the same type (cooldown),
// so that a shaking bike does not flood the owner with messages.
function raiseAlarm(db, device, type, details) {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - config.alarmCooldownMin * 60000).toISOString();
  const recent = db
    .prepare(`SELECT * FROM alarms WHERE device_id = ? AND type = ? AND status != 'resolved' AND updated_at >= ?
              ORDER BY id DESC LIMIT 1`)
    .get(device.id, type, since);

  if (recent) {
    db.prepare(`UPDATE alarms SET updated_at = ?, lat = COALESCE(?, lat), lon = COALESCE(?, lon),
                magnitude = MAX(COALESCE(magnitude, 0), COALESCE(?, 0)) WHERE id = ?`)
      .run(now, details.lat, details.lon, details.magnitude, recent.id);
    return { alarm: db.prepare('SELECT * FROM alarms WHERE id = ?').get(recent.id), created: false };
  }

  const text = ALARM_TEXT[type];
  const message = text.body(details);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO alarms (device_id, type, magnitude, lat, lon, message, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(device.id, type, details.magnitude ?? null, details.lat ?? null, details.lon ?? null, message, now, now);
  const alarm = db.prepare('SELECT * FROM alarms WHERE id = ?').get(lastInsertRowid);

  notify(db, {
    userId: device.user_id,
    deviceId: device.id,
    alarmId: alarm.id,
    title: text.title(device),
    body: message,
    priority: type === 'low_battery' ? 'default' : 'urgent',
  });
  return { alarm, created: true };
}

// Store a reading, update the device state and evaluate the alarm thresholds.
function processReading(db, device, raw) {
  const r = parseReading(raw);
  const raised = [];

  const run = db.transaction(() => {
    db.prepare(`INSERT INTO readings (device_id, recorded_at, accel_x, accel_y, accel_z, magnitude, lat, lon,
                speed_kmh, satellites, hdop, battery, rssi)
                VALUES (@device_id, @recorded_at, @accel_x, @accel_y, @accel_z, @magnitude, @lat, @lon,
                @speed_kmh, @satellites, @hdop, @battery, @rssi)`)
      .run({ ...r, device_id: device.id });

    db.prepare(`UPDATE devices SET last_seen = ?, battery = COALESCE(?, battery), rssi = COALESCE(?, rssi),
                firmware = COALESCE(?, firmware), last_lat = COALESCE(?, last_lat), last_lon = COALESCE(?, last_lon)
                WHERE id = ?`)
      .run(new Date().toISOString(), r.battery, r.rssi, r.firmware, r.lat, r.lon, device.id);

    // Remember where the bike was parked if it was armed before we had a GPS fix
    if (device.armed && device.armed_lat == null && r.lat != null) {
      db.prepare('UPDATE devices SET armed_lat = ?, armed_lon = ? WHERE id = ?').run(r.lat, r.lon, device.id);
    }

    if (device.armed) {
      if (r.magnitude != null && Math.abs(r.magnitude - 1) >= device.motion_threshold) {
        raised.push(raiseAlarm(db, device, 'motion', { magnitude: r.magnitude, lat: r.lat, lon: r.lon }));
      }
      if (device.armed_lat != null && r.lat != null) {
        const distance = distanceMeters(device.armed_lat, device.armed_lon, r.lat, r.lon);
        if (distance > device.move_radius_m) {
          raised.push(raiseAlarm(db, device, 'movement', { distance, lat: r.lat, lon: r.lon, magnitude: r.magnitude }));
        }
      }
    }

    // Low battery: only when crossing the limit
    if (r.battery != null && r.battery <= config.lowBatteryPercent &&
        (device.battery == null || device.battery > config.lowBatteryPercent)) {
      raised.push(raiseAlarm(db, device, 'low_battery', { battery: r.battery, lat: r.lat, lon: r.lon }));
    }
  });
  run();

  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
  events.publish(device.user_id, 'device', serializeDevice(db, updated));
  if (r.lat != null) {
    events.publish(device.user_id, 'position', { device_id: device.id, lat: r.lat, lon: r.lon, speed_kmh: r.speed_kmh, recorded_at: r.recorded_at });
  }
  for (const { alarm } of raised) events.publish(device.user_id, 'alarm', alarm);

  return { device: updated, reading: r, alarms: raised.map((a) => a.alarm) };
}

module.exports = { processReading, parseReading, raiseAlarm };
