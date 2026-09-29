'use strict';

const config = require('../config');
const events = require('./events');

// Stores a notification for the user, pushes it to open dashboards and,
// if configured, forwards it to an ntfy topic (push message on the phone).
function notify(db, { userId, deviceId = null, alarmId = null, title, body, priority = 'default' }) {
  const createdAt = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO notifications (user_id, device_id, alarm_id, title, body, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, deviceId, alarmId, title, body, createdAt);

  const notification = { id: lastInsertRowid, device_id: deviceId, alarm_id: alarmId, title, body, read: 0, created_at: createdAt };
  events.publish(userId, 'notification', notification);

  if (config.ntfyUrl) {
    fetch(config.ntfyUrl, {
      method: 'POST',
      headers: { Title: encodeURIComponent(title), Priority: priority, Tags: 'bike,rotating_light' },
      body,
    }).catch((err) => console.warn('ntfy delivery failed:', err.message));
  }
  return notification;
}

module.exports = { notify };
