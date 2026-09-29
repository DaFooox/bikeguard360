'use strict';

const express = require('express');
const { hashPassword, verifyPassword } = require('../services/security');
const { createSession, destroySession, requireUser } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = (db) => {
  const router = express.Router();

  router.post('/register', (req, res) => {
    const { email, name, password } = req.body || {};
    if (!EMAIL_RE.test(String(email || ''))) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Name fehlt' });
    if (String(password || '').length < 8) return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'E-Mail-Adresse ist bereits registriert' });
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
      .run(email.trim(), name.trim(), hashPassword(password));
    createSession(db, res, lastInsertRowid);
    res.status(201).json({ user: { id: lastInsertRowid, email: email.trim(), name: name.trim() } });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || ''));
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    }
    createSession(db, res, user.id);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  router.get('/me', requireUser, (req, res) => res.json({ user: req.user }));

  return router;
};
