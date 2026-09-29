'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' ? n : fallback;
};

module.exports = {
  root: ROOT,
  port: num(process.env.PORT, 3000),
  dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/bikeguard360.db'),
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 168),
  offlineAfterMin: num(process.env.OFFLINE_AFTER_MIN, 15),
  ntfyUrl: process.env.NTFY_URL || '',
  // Minimum time between two alarms of the same type for one device
  alarmCooldownMin: 5,
  lowBatteryPercent: 15,
};
