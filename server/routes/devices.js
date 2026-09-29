'use strict';

const express = require('express');
const { randomToken } = require('../services/security');
const { serializeDevice } = require('../services/devices');
const events = require('../services/events');

const clampInt = (v, min, max, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

module.exports = (db) => {
  const router = express.Router();

  // Load a device owned by the current user
  router.param('id', (req, res, next, id) => {
    const device = db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!device) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    req.device = device;
    next();
  });

  router.get('/', (req, res) => {
    const devices = db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY id').all(req.user.id);
    res.json({ devices: devices.map((d) => serializeDevice(db, d)) });
  });

  // Register a new device. Returns the API key the firmware has to use.
  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const serial = String(req.body?.serial || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Name fehlt' });
    if (!/^[A-Z0-9-]{4,32}$/.test(serial)) return res.status(400).json({ error: 'Ungültige Seriennummer' });
    if (db.prepare('SELECT 1 FROM devices WHERE serial = ?').get(serial)) {
      return res.status(409).json({ error: 'Gerät ist bereits registriert' });
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO devices (user_id, name, serial, api_key) VALUES (?, ?, ?, ?)')
      .run(req.user.id, name, serial, randomToken(24));
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(lastInsertRowid);
    res.status(201).json({ device: serializeDevice(db, device, { withKey: true }) });
  });

  router.get('/:id', (req, res) => {
    res.json({ device: serializeDevice(db, req.device, { withKey: true }) });
  });

  router.patch('/:id', (req, res) => {
    const d = req.device;
    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: 'Name fehlt' });
      updates.name = name;
    }
    if (body.motion_threshold !== undefined) {
      const t = Number(body.motion_threshold);
      if (!(t >= 0.05 && t <= 3)) return res.status(400).json({ error: 'Schwellenwert muss zwischen 0,05 und 3 g liegen' });
      updates.motion_threshold = t;
    }
    if (body.move_radius_m !== undefined) {
      const r = Number(body.move_radius_m);
      if (!(r >= 10 && r <= 1000)) return res.status(400).json({ error: 'Radius muss zwischen 10 und 1000 m liegen' });
      updates.move_radius_m = r;
    }
    if (body.armed !== undefined) {
      const armed = Boolean(body.armed);
      if (armed && !d.armed) {
        // Remember the parking position, so movement away from it can be detected
        Object.assign(updates, { armed: 1, armed_at: new Date().toISOString(), armed_lat: d.last_lat, armed_lon: d.last_lon });
      } else if (!armed && d.armed) {
        Object.assign(updates, { armed: 0, armed_at: null, armed_lat: null, armed_lon: null });
      }
    }

    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE devices SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`)
        .run({ ...updates, id: d.id });
      if (updates.armed === 0) {
        // Disarming means the owner is back at the bike: close open theft alarms
        db.prepare(`UPDATE alarms SET status = 'resolved', resolved_at = ?, updated_at = ?
                    WHERE device_id = ? AND status != 'resolved' AND type IN ('motion', 'movement')`)
          .run(new Date().toISOString(), new Date().toISOString(), d.id);
      }
    }
    const device = serializeDevice(db, db.prepare('SELECT * FROM devices WHERE id = ?').get(d.id), { withKey: true });
    events.publish(req.user.id, 'device', device);
    res.json({ device });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM devices WHERE id = ?').run(req.device.id);
    res.status(204).end();
  });

  router.post('/:id/regenerate-key', (req, res) => {
    db.prepare('UPDATE devices SET api_key = ? WHERE id = ?').run(randomToken(24), req.device.id);
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.device.id);
    res.json({ device: serializeDevice(db, device, { withKey: true }) });
  });

  // GPS track for a time range (defaults to the last 24 hours)
  router.get('/:id/track', (req, res) => {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Ungültiger Zeitraum' });
    }
    const limit = clampInt(req.query.limit, 1, 20000, 5000);
    const points = db
      .prepare(`SELECT lat, lon, speed_kmh, recorded_at FROM readings
                WHERE device_id = ? AND lat IS NOT NULL AND recorded_at BETWEEN ? AND ?
                ORDER BY recorded_at LIMIT ?`)
      .all(req.device.id, from.toISOString(), to.toISOString(), limit);
    res.json({ from: from.toISOString(), to: to.toISOString(), points });
  });

  // Latest raw sensor readings (for the acceleration chart)
  router.get('/:id/readings', (req, res) => {
    const limit = clampInt(req.query.limit, 1, 1000, 100);
    const rows = db
      .prepare(`SELECT recorded_at, accel_x, accel_y, accel_z, magnitude, battery, rssi, satellites, speed_kmh
                FROM readings WHERE device_id = ? ORDER BY recorded_at DESC LIMIT ?`)
      .all(req.device.id, limit);
    res.json({ readings: rows.reverse() });
  });

  router.get('/:id/stats', (req, res) => {
    const id = req.device.id;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const counts = db
      .prepare(`SELECT COUNT(*) AS readings, MIN(battery) AS min_battery, MAX(speed_kmh) AS max_speed
                FROM readings WHERE device_id = ? AND recorded_at >= ?`)
      .get(id, since);
    const alarms = db
      .prepare(`SELECT COUNT(*) AS total, SUM(status = 'open') AS open FROM alarms WHERE device_id = ? AND created_at >= ?`)
      .get(id, since);
    res.json({ period_days: 7, readings: counts.readings, min_battery: counts.min_battery,
      max_speed_kmh: counts.max_speed, alarms: alarms.total, open_alarms: alarms.open || 0 });
  });

  return router;
};
