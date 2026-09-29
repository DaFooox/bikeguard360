'use strict';

const config = require('../config');
const { randomToken } = require('../services/security');

const COOKIE = 'bg360_session';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, res, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE);
}

// Resolves the logged-in user (if any) from the session cookie
const loadUser = (db) => (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db
      .prepare(`SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token = ?`)
      .get(token);
    if (row && Date.parse(row.expires_at) > Date.now()) {
      req.user = { id: row.id, email: row.email, name: row.name };
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  next();
};

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

// Authenticates an ESP32 by its API key (Authorization: Bearer <key> or X-Device-Key)
const requireDevice = (db) => (req, res, next) => {
  const auth = req.get('authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : req.get('x-device-key');
  const device = key && db.prepare('SELECT * FROM devices WHERE api_key = ?').get(key);
  if (!device) return res.status(401).json({ error: 'Invalid device key' });
  req.device = device;
  next();
};

module.exports = { loadUser, requireUser, requireDevice, createSession, destroySession, COOKIE };
