#!/usr/bin/env node
'use strict';

/**
 * Creates the SQLite database and fills it with realistic demo data:
 *
 *   - demo user  demo@bikeguard360.de / demo1234
 *   - "Stadtrad"   daily commute for 7 days, a false alarm, and a theft that is
 *                  happening right now (open alarms, bike moved away)
 *   - "Rennrad"    parked at home, armed, battery almost empty
 *   - "Lastenrad"  offline for two days
 *
 * Usage:  npm run seed            (replaces the existing database)
 *         node scripts/seed.js --db ./data/other.db
 */

const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const { openDatabase } = require('../server/db');
const { hashPassword } = require('../server/services/security');
const { distanceMeters } = require('../server/services/geo');

const argDb = process.argv.indexOf('--db');
const dbPath = argDb > -1 ? path.resolve(process.argv[argDb + 1]) : config.dbPath;

// ---------------------------------------------------------------- helpers

// Deterministic random numbers, so every seed produces the same data
let seed = 360;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => min + rand() * (max - min);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const iso = (ms) => new Date(ms).toISOString();

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();

function accel(level) {
  // level: 0 = standing still, 1 = riding, 2+ = being tampered with
  const noise = [0.01, 0.22, 0.6][Math.min(level, 2)] * (level > 2 ? level / 2 : 1);
  const x = round(0.02 + between(-noise, noise), 3);
  const y = round(-0.01 + between(-noise, noise), 3);
  const z = round(0.99 + between(-noise, noise), 3);
  return { x, y, z, magnitude: round(Math.sqrt(x * x + y * y + z * z), 3) };
}

// Points along a polyline, one every `stepS` seconds at `speedKmh`
function interpolate(waypoints, speedKmh, stepS) {
  const out = [];
  const stepM = (speedKmh / 3.6) * stepS;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [a, b] = [waypoints[i], waypoints[i + 1]];
    const dist = distanceMeters(a[0], a[1], b[0], b[1]);
    const n = Math.max(1, Math.round(dist / stepM));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push([a[0] + (b[0] - a[0]) * f + between(-0.00004, 0.00004), a[1] + (b[1] - a[1]) * f + between(-0.00004, 0.00004)]);
    }
  }
  out.push(waypoints[waypoints.length - 1]);
  return out;
}

// ---------------------------------------------------------------- places (Berlin)

const HOME = [52.54021, 13.41268];       // Prenzlauer Berg
const WORK = [52.50185, 13.41902];       // Kreuzberg
const COMMUTE = [HOME, [52.5335, 13.4118], [52.5259, 13.4106], [52.5219, 13.4132], [52.5160, 13.4175],
  [52.5100, 13.4163], [52.5046, 13.4178], WORK];
const SUNDAY_TOUR = [HOME, [52.5290, 13.4200], [52.5150, 13.4280], [52.4990, 13.4200], [52.4800, 13.4030],
  [52.4740, 13.3990], [52.4760, 13.4150], [52.4880, 13.4250], [52.5150, 13.4280], [52.5290, 13.4200], HOME];
// Where the thief takes the Stadtrad (shape of the route, shifted to wherever the bike is parked)
const THEFT_ROUTE = [WORK, [52.5003, 13.4262], [52.4968, 13.4340], [52.4931, 13.4418], [52.4895, 13.4497],
  [52.4861, 13.4563], [52.4832, 13.4611]];
const CARGO_PARKING = [52.53012, 13.40195];

// ---------------------------------------------------------------- build

if (fs.existsSync(dbPath)) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
}
const db = openDatabase(dbPath);

const insertReading = db.prepare(`INSERT INTO readings
  (device_id, recorded_at, accel_x, accel_y, accel_z, magnitude, lat, lon, speed_kmh, satellites, hdop, battery, rssi)
  VALUES (@device_id, @recorded_at, @x, @y, @z, @magnitude, @lat, @lon, @speed, @sats, @hdop, @battery, @rssi)`);
const insertAlarm = db.prepare(`INSERT INTO alarms
  (device_id, type, status, magnitude, lat, lon, message, created_at, updated_at, acknowledged_at, resolved_at)
  VALUES (@device_id, @type, @status, @magnitude, @lat, @lon, @message, @created_at, @updated_at, @acknowledged_at, @resolved_at)`);
const insertNotification = db.prepare(`INSERT INTO notifications (user_id, device_id, alarm_id, title, body, read, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);

function reading(deviceId, t, pos, { level = 0, speed = 0, battery, rssi }) {
  const a = accel(level);
  insertReading.run({
    device_id: deviceId, recorded_at: iso(t), ...a,
    lat: pos ? round(pos[0], 6) : null, lon: pos ? round(pos[1], 6) : null,
    speed: pos ? round(speed, 1) : null,
    sats: pos ? Math.round(between(7, 12)) : 0, hdop: pos ? round(between(0.8, 1.6), 1) : null,
    battery: Math.round(battery), rssi: Math.round(rssi ?? between(-72, -52)),
  });
  return a;
}

function alarm(userId, deviceId, deviceName, a) {
  const titles = {
    motion: `Alarm: Erschütterung an „${deviceName}“`,
    movement: `Alarm: „${deviceName}“ wird bewegt`,
    low_battery: `Akku schwach: „${deviceName}“`,
  };
  const row = { acknowledged_at: null, resolved_at: null, magnitude: null, lat: null, lon: null, ...a, device_id: deviceId };
  const { lastInsertRowid } = insertAlarm.run(row);
  insertNotification.run(userId, deviceId, lastInsertRowid, titles[a.type], a.message, a.status === 'open' ? 0 : 1, a.created_at);
  return lastInsertRowid;
}

const build = db.transaction(() => {
  const userId = db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('demo@bikeguard360.de', 'Alex Muster', hashPassword('demo1234'), iso(NOW - 30 * DAY)).lastInsertRowid;

  const addDevice = db.prepare(`INSERT INTO devices (user_id, name, serial, api_key, firmware, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const city = addDevice.run(userId, 'Stadtrad', 'BG360-0001', 'demo-key-stadtrad-0001', '0.3.1', iso(NOW - 30 * DAY)).lastInsertRowid;
  const road = addDevice.run(userId, 'Rennrad', 'BG360-0002', 'demo-key-rennrad-0002', '0.3.1', iso(NOW - 21 * DAY)).lastInsertRowid;
  const cargo = addDevice.run(userId, 'Lastenrad', 'BG360-0003', 'demo-key-lastenrad-0003', '0.2.4', iso(NOW - 14 * DAY)).lastInsertRowid;

  // ---------------- Stadtrad: 7 days of commuting, then a theft 95 minutes ago
  const theftAt = NOW - 95 * MIN;
  const start = new Date(NOW - 7 * DAY); start.setHours(0, 0, 0, 0);
  let t = start.getTime();
  let pos = HOME;
  let battery = 100;
  const drain = (ms) => { battery = Math.max(20, battery - ms / DAY * 1.9); };
  const parkUntil = (until, stepMs) => {
    for (; t < until && t < theftAt; t += stepMs + between(-10e3, 10e3)) {
      reading(city, t, pos, { battery, rssi: between(-70, -55) });
      drain(stepMs);
    }
  };
  const ride = (waypoints) => {
    for (const p of interpolate(waypoints, between(16, 21), 30)) {
      if (t >= theftAt) return;
      reading(city, t, p, { level: 1, speed: between(12, 25), battery, rssi: between(-88, -75) });
      pos = p; t += 30e3; drain(30e3);
    }
  };

  for (let day = start.getTime(); t < theftAt; day += DAY) {
    const weekday = new Date(day).getDay();
    if (weekday === 0 || weekday === 6) { parkUntil(day + DAY, 5 * MIN); continue; }
    parkUntil(day + 7 * HOUR + 45 * MIN, 5 * MIN);
    ride(COMMUTE);
    parkUntil(day + 17 * HOUR + between(0, 40) * MIN, 5 * MIN);
    if (t < theftAt) ride([...COMMUTE].reverse());
    parkUntil(day + DAY, 5 * MIN);
  }

  // A false alarm three days ago: somebody bumped into the parked bike
  const bump = NOW - 3 * DAY + 2 * HOUR;
  alarm(userId, city, 'Stadtrad', {
    type: 'motion', status: 'resolved', magnitude: 1.47, lat: WORK[0], lon: WORK[1],
    message: 'Dein Fahrrad wurde bei scharf geschaltetem Gerät bewegt (1.47 g).',
    created_at: iso(bump), updated_at: iso(bump + 20 * MIN), acknowledged_at: iso(bump + 3 * MIN), resolved_at: iso(bump + 20 * MIN),
  });

  // The theft: the lock is attacked, then the bike is moved away
  const parkedAt = pos;
  t = theftAt;
  for (let i = 0; i < 12; i++, t += 10e3) reading(city, t, parkedAt, { level: 4 + (i % 3), battery, rssi: -62 });
  alarm(userId, city, 'Stadtrad', {
    type: 'motion', status: 'open', magnitude: 2.31, lat: parkedAt[0], lon: parkedAt[1],
    message: 'Dein Fahrrad wurde bei scharf geschaltetem Gerät bewegt (2.31 g).',
    created_at: iso(theftAt), updated_at: iso(t),
  });
  const route = interpolate(THEFT_ROUTE.map(([lat, lon]) => [parkedAt[0] + lat - WORK[0], parkedAt[1] + lon - WORK[1]]), 14, 10);
  const movedAt = t;
  let alarmPos = null;
  for (const p of route) {
    reading(city, t, p, { level: 1, speed: between(10, 18), battery, rssi: between(-86, -70) });
    const d = distanceMeters(parkedAt[0], parkedAt[1], p[0], p[1]);
    if (!alarmPos && d > 30) alarmPos = [t, d];
    t += 10e3; drain(10e3);
  }
  const thiefPos = route[route.length - 1];
  alarm(userId, city, 'Stadtrad', {
    type: 'movement', status: 'open', magnitude: 1.24, lat: thiefPos[0], lon: thiefPos[1],
    message: `Dein Fahrrad hat sich ${Math.round(alarmPos ? alarmPos[1] : 31)} m vom Abstellort entfernt. Standort im Dashboard ansehen.`,
    created_at: iso(alarmPos ? alarmPos[0] : movedAt), updated_at: iso(t),
  });
  // Standing at the new location since then, still reporting every 60 s
  for (; t < NOW - 20e3; t += 60e3) reading(city, t, thiefPos, { battery, rssi: between(-80, -68) });

  db.prepare(`UPDATE devices SET armed = 1, armed_at = ?, armed_lat = ?, armed_lon = ?, battery = ?, rssi = ?,
              last_seen = ?, last_lat = ?, last_lon = ? WHERE id = ?`)
    .run(iso(theftAt - 4 * HOUR), parkedAt[0], parkedAt[1], Math.round(battery), -74, iso(NOW - 20e3), thiefPos[0], thiefPos[1], city);

  // ---------------- Rennrad: a Sunday tour, afterwards parked and armed at home
  battery = 32;
  const tourStart = NOW - 4 * DAY - 6 * HOUR;
  t = NOW - 7 * DAY;
  for (; t < tourStart; t += 5 * MIN) { reading(road, t, HOME, { battery }); battery -= 5 * MIN / DAY * 1.2; }
  for (const p of interpolate(SUNDAY_TOUR, 27, 30)) {
    reading(road, t, p, { level: 1, speed: between(22, 34), battery, rssi: between(-90, -78) });
    t += 30e3; battery -= 0.02;
  }
  const lowAt = { t: null };
  for (; t < NOW - 3 * MIN; t += 5 * MIN) {
    reading(road, t, HOME, { battery });
    const before = battery;
    battery -= 5 * MIN / DAY * 3.6;
    if (before > config.lowBatteryPercent && battery <= config.lowBatteryPercent) lowAt.t = t;
  }
  if (lowAt.t) {
    alarm(userId, road, 'Rennrad', {
      type: 'low_battery', status: 'acknowledged', lat: HOME[0], lon: HOME[1],
      message: `Der Akku deines BikeGuard360 liegt bei ${config.lowBatteryPercent} %. Bitte bald aufladen.`,
      created_at: iso(lowAt.t), updated_at: iso(lowAt.t + 2 * HOUR), acknowledged_at: iso(lowAt.t + 2 * HOUR),
    });
  }
  db.prepare(`UPDATE devices SET armed = 1, armed_at = ?, armed_lat = ?, armed_lon = ?, battery = ?, rssi = ?,
              last_seen = ?, last_lat = ?, last_lon = ?, motion_threshold = 0.25 WHERE id = ?`)
    .run(iso(tourStart + 3 * HOUR), HOME[0], HOME[1], Math.round(battery), -58, iso(NOW - 3 * MIN), HOME[0], HOME[1], road);

  // ---------------- Lastenrad: went offline two days ago (battery empty)
  battery = 21;
  const offlineAt = NOW - 2 * DAY - 5 * HOUR;
  for (t = NOW - 7 * DAY; t < offlineAt; t += 5 * MIN) {
    reading(cargo, t, CARGO_PARKING, { battery });
    battery = Math.max(3, battery - 5 * MIN / DAY * 4);
  }
  db.prepare(`UPDATE devices SET armed = 0, battery = ?, rssi = ?, last_seen = ?, last_lat = ?, last_lon = ? WHERE id = ?`)
    .run(Math.round(battery), -77, iso(offlineAt), CARGO_PARKING[0], CARGO_PARKING[1], cargo);
});

build();

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
console.log(`Database created: ${dbPath}`);
console.log(`  users: ${count('users')}, devices: ${count('devices')}, readings: ${count('readings')}, ` +
  `alarms: ${count('alarms')}, notifications: ${count('notifications')}`);
console.log('\nDemo login:  demo@bikeguard360.de  /  demo1234');
console.log('Device keys: demo-key-stadtrad-0001, demo-key-rennrad-0002, demo-key-lastenrad-0003');
db.close();
