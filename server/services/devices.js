'use strict';

const config = require('../config');

function deviceStatus(device, now = Date.now()) {
  if (!device.last_seen) return 'never';
  const ageMin = (now - Date.parse(device.last_seen)) / 60000;
  return ageMin <= config.offlineAfterMin ? 'online' : 'offline';
}

// Shape a device row for the API. The API key is only included on request.
function serializeDevice(db, device, { withKey = false } = {}) {
  const openAlarms = db
    .prepare(`SELECT COUNT(*) AS n FROM alarms WHERE device_id = ? AND status = 'open'`)
    .get(device.id).n;
  const out = {
    id: device.id,
    name: device.name,
    serial: device.serial,
    armed: Boolean(device.armed),
    armed_at: device.armed_at,
    motion_threshold: device.motion_threshold,
    move_radius_m: device.move_radius_m,
    battery: device.battery,
    rssi: device.rssi,
    firmware: device.firmware,
    last_seen: device.last_seen,
    position: device.last_lat != null ? { lat: device.last_lat, lon: device.last_lon } : null,
    armed_position: device.armed_lat != null ? { lat: device.armed_lat, lon: device.armed_lon } : null,
    status: deviceStatus(device),
    open_alarms: openAlarms,
    created_at: device.created_at,
  };
  if (withKey) out.api_key = device.api_key;
  return out;
}

// How often the device should report, depending on its state (seconds)
function reportInterval(db, device) {
  if (!device.armed) return 300;
  const open = db.prepare(`SELECT 1 FROM alarms WHERE device_id = ? AND status = 'open' LIMIT 1`).get(device.id);
  return open ? 10 : 60;
}

module.exports = { serializeDevice, deviceStatus, reportInterval };
