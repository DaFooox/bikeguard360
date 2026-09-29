'use strict';

const express = require('express');
const { processReading } = require('../services/alarms');
const { reportInterval } = require('../services/devices');

// Endpoints used by the ESP32 firmware (authenticated by device API key)
module.exports = (db) => {
  const router = express.Router();

  const deviceConfig = (device) => ({
    armed: Boolean(device.armed),
    // true while a theft alarm is open – the firmware then sounds the buzzer
    alarm_active: Boolean(db.prepare(`SELECT 1 FROM alarms WHERE device_id = ? AND status = 'open'
      AND type IN ('motion', 'movement') LIMIT 1`).get(device.id)),
    motion_threshold: device.motion_threshold,
    report_interval_s: reportInterval(db, device),
    server_time: new Date().toISOString(),
  });

  router.get('/config', (req, res) => res.json(deviceConfig(req.device)));

  // Accepts a single reading or { readings: [...] } (buffered while offline)
  router.post('/telemetry', (req, res) => {
    const body = req.body || {};
    const batch = Array.isArray(body.readings) ? body.readings.slice(0, 500) : [body];
    let device = req.device;
    const alarms = [];
    for (const raw of batch) {
      const result = processReading(db, device, raw || {});
      device = result.device;
      alarms.push(...result.alarms);
    }
    res.status(201).json({ accepted: batch.length, alarms: alarms.map((a) => ({ id: a.id, type: a.type })), ...deviceConfig(device) });
  });

  return router;
};
