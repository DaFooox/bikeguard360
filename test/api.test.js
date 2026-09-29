'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

// Small client that keeps the session cookie
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }), ...headers },
      body: body && JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
}

async function newUser(email) {
  const c = client();
  const r = await c('/api/auth/register', { method: 'POST', body: { email, name: 'Test', password: 'secret123' } });
  assert.equal(r.status, 201);
  return c;
}

async function newDevice(c, serial) {
  const r = await c('/api/devices', { method: 'POST', body: { name: 'Rad', serial } });
  assert.equal(r.status, 201);
  return r.body.device;
}

const send = (key, packet) => fetch(`${base}/api/device/telemetry`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify(packet),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const still = (lat = 52.5, lon = 13.4) => ({ accel: { x: 0, y: 0, z: 1 }, gps: { lat, lon }, battery: 80, rssi: -60 });
const shake = (lat = 52.5, lon = 13.4) => ({ accel: { x: 0.9, y: 0.4, z: 1.6 }, gps: { lat, lon }, battery: 80 });

test('health endpoint and pages', async () => {
  const c = client();
  assert.equal((await c('/api/health')).body.status, 'ok');
  assert.equal((await c('/')).status, 200);
  const dash = await c('/dashboard');
  assert.equal(dash.status, 302);
  assert.equal((await c('/does-not-exist')).status, 404);
});

test('register, login, logout', async () => {
  const c = await newUser('a@test.de');
  assert.equal((await c('/api/auth/me')).body.user.email, 'a@test.de');
  assert.equal((await c('/dashboard')).status, 200);

  const dup = await client()('/api/auth/register', { method: 'POST', body: { email: 'A@test.de', name: 'X', password: 'secret123' } });
  assert.equal(dup.status, 409);

  await c('/api/auth/logout', { method: 'POST' });
  assert.equal((await c('/api/auth/me')).status, 401);

  const bad = await c('/api/auth/login', { method: 'POST', body: { email: 'a@test.de', password: 'wrong-pass' } });
  assert.equal(bad.status, 401);
  const ok = await c('/api/auth/login', { method: 'POST', body: { email: 'a@test.de', password: 'secret123' } });
  assert.equal(ok.status, 200);
});

test('API requires login', async () => {
  assert.equal((await client()('/api/devices')).status, 401);
});

test('users only see their own devices', async () => {
  const alice = await newUser('alice@test.de');
  const bob = await newUser('bob@test.de');
  const device = await newDevice(alice, 'ISO-0001');
  assert.equal((await bob(`/api/devices/${device.id}`)).status, 404);
  assert.equal((await bob('/api/devices')).body.devices.length, 0);
  assert.equal((await alice('/api/devices')).body.devices.length, 1);
});

test('telemetry requires a valid device key', async () => {
  assert.equal((await send('nope', still())).status, 401);
});

test('shaking a disarmed bike raises no alarm', async () => {
  const c = await newUser('disarmed@test.de');
  const device = await newDevice(c, 'DIS-0001');
  const r = await send(device.api_key, shake());
  assert.equal(r.status, 201);
  assert.equal(r.body.armed, false);
  assert.deepEqual(r.body.alarms, []);
  assert.equal(r.body.report_interval_s, 300);
});

test('armed bike: shaking raises one motion alarm (with cooldown) and a notification', async () => {
  const c = await newUser('armed@test.de');
  const device = await newDevice(c, 'ARM-0001');
  await send(device.api_key, still());
  const armed = await c(`/api/devices/${device.id}`, { method: 'PATCH', body: { armed: true } });
  assert.equal(armed.body.device.armed, true);
  assert.deepEqual(armed.body.device.armed_position, { lat: 52.5, lon: 13.4 });

  assert.deepEqual((await send(device.api_key, still())).body.alarms, []);
  const first = await send(device.api_key, shake());
  assert.equal(first.body.alarms[0].type, 'motion');
  assert.equal(first.body.report_interval_s, 10);
  const second = await send(device.api_key, shake());
  assert.equal(second.body.alarms[0].id, first.body.alarms[0].id, 'second shake updates the same alarm');

  const alarms = (await c(`/api/alarms?device_id=${device.id}`)).body.alarms;
  assert.equal(alarms.length, 1);
  const notes = (await c('/api/notifications')).body;
  assert.equal(notes.unread, 1);

  // Disarming resolves open theft alarms
  await c(`/api/devices/${device.id}`, { method: 'PATCH', body: { armed: false } });
  const after = (await c(`/api/alarms?device_id=${device.id}`)).body.alarms;
  assert.equal(after[0].status, 'resolved');
});

test('armed bike: moving away from the parking spot raises a movement alarm', async () => {
  const c = await newUser('move@test.de');
  const device = await newDevice(c, 'MOV-0001');
  await send(device.api_key, still(52.5, 13.4));
  await c(`/api/devices/${device.id}`, { method: 'PATCH', body: { armed: true, move_radius_m: 30 } });

  assert.deepEqual((await send(device.api_key, still(52.50010, 13.4))).body.alarms, []); // ~11 m
  const r = await send(device.api_key, still(52.5010, 13.4)); // ~111 m
  assert.equal(r.body.alarms[0].type, 'movement');

  const track = (await c(`/api/devices/${device.id}/track`)).body.points;
  assert.equal(track.length, 3);
});

test('low battery alarm fires once when crossing the limit', async () => {
  const c = await newUser('battery@test.de');
  const device = await newDevice(c, 'BAT-0001');
  await send(device.api_key, { ...still(), battery: 20 });
  const low = await send(device.api_key, { ...still(), battery: 14 });
  assert.equal(low.body.alarms[0].type, 'low_battery');
  const lower = await send(device.api_key, { ...still(), battery: 12 });
  assert.deepEqual(lower.body.alarms, []);
});

test('batch upload and alarm acknowledgement', async () => {
  const c = await newUser('batch@test.de');
  const device = await newDevice(c, 'BAT-0002');
  await send(device.api_key, still());
  await c(`/api/devices/${device.id}`, { method: 'PATCH', body: { armed: true } });
  const r = await send(device.api_key, { readings: [still(), still(), shake()] });
  assert.equal(r.body.accepted, 3);
  const alarmId = r.body.alarms[0].id;

  const ack = await c(`/api/alarms/${alarmId}`, { method: 'PATCH', body: { status: 'acknowledged' } });
  assert.equal(ack.body.alarm.status, 'acknowledged');
  assert.ok(ack.body.alarm.acknowledged_at);
  const readings = (await c(`/api/devices/${device.id}/readings`)).body.readings;
  assert.equal(readings.length, 4);
});

test('device settings are validated', async () => {
  const c = await newUser('settings@test.de');
  const device = await newDevice(c, 'SET-0001');
  assert.equal((await c(`/api/devices/${device.id}`, { method: 'PATCH', body: { motion_threshold: 9 } })).status, 400);
  assert.equal((await c('/api/devices', { method: 'POST', body: { name: 'x', serial: 'a b' } })).status, 400);
  assert.equal((await c('/api/devices', { method: 'POST', body: { name: 'x', serial: 'SET-0001' } })).status, 409);
  const ok = await c(`/api/devices/${device.id}`, { method: 'PATCH', body: { motion_threshold: 0.5, name: 'Neu' } });
  assert.equal(ok.body.device.motion_threshold, 0.5);
  assert.equal(ok.body.device.name, 'Neu');
});
