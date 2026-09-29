'use strict';

const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check – later also used by the ESP32 to verify server reachability.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'bikeguard360', time: new Date().toISOString() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`BikeGuard360 server running at http://localhost:${PORT}`);
});
