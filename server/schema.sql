-- BikeGuard360 database schema (SQLite)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  serial            TEXT    NOT NULL UNIQUE,
  api_key           TEXT    NOT NULL UNIQUE,
  armed             INTEGER NOT NULL DEFAULT 0,
  armed_at          TEXT,
  armed_lat         REAL,
  armed_lon         REAL,
  -- Alarm thresholds, evaluated on the server
  motion_threshold  REAL    NOT NULL DEFAULT 0.35,  -- deviation from 1 g, in g
  move_radius_m     REAL    NOT NULL DEFAULT 30,    -- allowed drift from armed position
  battery           INTEGER,
  rssi              INTEGER,
  firmware          TEXT,
  last_seen         TEXT,
  last_lat          REAL,
  last_lon          REAL,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every data packet the ESP32 sends
CREATE TABLE IF NOT EXISTS readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  recorded_at  TEXT    NOT NULL,
  accel_x      REAL,
  accel_y      REAL,
  accel_z      REAL,
  magnitude    REAL,
  lat          REAL,
  lon          REAL,
  speed_kmh    REAL,
  satellites   INTEGER,
  hdop         REAL,
  battery      INTEGER,
  rssi         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings(device_id, recorded_at);

CREATE TABLE IF NOT EXISTS alarms (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL CHECK (type IN ('motion', 'movement', 'low_battery')),
  status           TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  magnitude        REAL,
  lat              REAL,
  lon              REAL,
  message          TEXT,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  acknowledged_at  TEXT,
  resolved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_alarms_device ON alarms(device_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  alarm_id    INTEGER REFERENCES alarms(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
