'use strict';

const express = require('express');
const events = require('../services/events');

module.exports = (db) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    const where = ['d.user_id = @user'];
    const params = { user: req.user.id, limit: Math.min(parseInt(req.query.limit, 10) || 50, 500) };
    if (req.query.device_id) { where.push('a.device_id = @device'); params.device = Number(req.query.device_id); }
    if (req.query.status) { where.push('a.status = @status'); params.status = String(req.query.status); }
    const alarms = db
      .prepare(`SELECT a.*, d.name AS device_name FROM alarms a JOIN devices d ON d.id = a.device_id
                WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT @limit`)
      .all(params);
    res.json({ alarms });
  });

  router.patch('/:id', (req, res) => {
    const alarm = db
      .prepare(`SELECT a.* FROM alarms a JOIN devices d ON d.id = a.device_id WHERE a.id = ? AND d.user_id = ?`)
      .get(req.params.id, req.user.id);
    if (!alarm) return res.status(404).json({ error: 'Alarm nicht gefunden' });

    const status = req.body?.status;
    if (!['acknowledged', 'resolved'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    const now = new Date().toISOString();
    db.prepare(`UPDATE alarms SET status = ?, updated_at = ?,
                acknowledged_at = COALESCE(acknowledged_at, ?), resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE resolved_at END
                WHERE id = ?`)
      .run(status, now, now, status, now, alarm.id);
    const updated = db.prepare('SELECT * FROM alarms WHERE id = ?').get(alarm.id);
    events.publish(req.user.id, 'alarm', updated);
    res.json({ alarm: updated });
  });

  return router;
};
