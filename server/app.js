'use strict';

const path = require('path');
const express = require('express');
const { loadUser, requireUser, requireDevice } = require('./middleware/auth');

const PUBLIC = path.join(__dirname, '..', 'public');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    next();
  });

  // Device API (ESP32) – authenticated by API key, not by session
  app.use('/api/device', requireDevice(db), require('./routes/device-api')(db));

  app.use(loadUser(db));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'bikeguard360', time: new Date().toISOString() });
  });
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/devices', requireUser, require('./routes/devices')(db));
  app.use('/api/alarms', requireUser, require('./routes/alarms')(db));
  app.use('/api/notifications', requireUser, require('./routes/notifications')(db));
  app.get('/api/events', requireUser, require('./routes/events')());
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Pages
  app.get('/login', (req, res) => (req.user ? res.redirect('/dashboard') : res.sendFile(path.join(PUBLIC, 'login.html'))));
  app.get('/register', (req, res) => (req.user ? res.redirect('/dashboard') : res.sendFile(path.join(PUBLIC, 'login.html'))));
  app.get('/dashboard', (req, res) => (req.user ? res.sendFile(path.join(PUBLIC, 'dashboard.html')) : res.redirect('/login')));
  app.use(express.static(PUBLIC, { index: 'index.html', extensions: ['html'] }));
  // Leaflet (map library) is served from node_modules, so the dashboard works without a CDN
  app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js'))));

  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  });

  return app;
}

module.exports = { createApp };
