'use strict';

const config = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const db = openDatabase();
const app = createApp(db);

// Remove expired sessions once an hour
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}, 3600 * 1000).unref();

const server = app.listen(config.port, () => {
  console.log(`BikeGuard360 server running at http://localhost:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
