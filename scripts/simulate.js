#!/usr/bin/env node
'use strict';

/**
 * Simulates a BikeGuard360 device (ESP32) that sends telemetry to the server
 * over HTTP – exactly like the real firmware. Useful to watch alarms and the
 * live map in the dashboard without hardware.
 *
 * Usage:
 *   npm run simulate                                   (theft scenario, "Rennrad")
 *   npm run simulate -- --scenario ride
 *   npm run simulate -- --key <device-api-key> --url http://localhost:3000 --interval 2
 *
 * Scenarios:
 *   idle   bike stands still, only status packets
 *   theft  bike stands still, is shaken after a few packets and then ridden away
 *   ride   normal ride without shaking (arm the device to see movement alarms)
 */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_BASE = arg('url', process.env.BG360_URL || `http://localhost:${process.env.PORT || 3000}`);
const KEY = arg('key', 'demo-key-rennrad-0002');
const SCENARIO = arg('scenario', 'theft');
const INTERVAL_S = Number(arg('interval', 2));
const START = [Number(arg('lat', 52.54021)), Number(arg('lon', 13.41268))];

if (!['idle', 'theft', 'ride'].includes(SCENARIO)) {
  console.error(`Unknown scenario "${SCENARIO}" (idle | theft | ride)`);
  process.exit(1);
}

let pos = [...START];
let heading = Math.random() * Math.PI * 2;
let battery = 78;
let tick = 0;

const jitter = (n) => (Math.random() - 0.5) * 2 * n;

function nextPacket() {
  tick++;
  let level = 0;
  let speed = 0;

  const moving = SCENARIO === 'ride' || (SCENARIO === 'theft' && tick > 8);
  const shaking = SCENARIO === 'theft' && tick > 4 && tick <= 8;

  if (shaking) level = 1.1;
  if (moving) {
    level = 0.25;
    speed = 12 + Math.random() * 8;
    heading += jitter(0.35);
    const metres = (speed / 3.6) * INTERVAL_S * 5; // run 5x faster than real time
    pos = [pos[0] + (Math.cos(heading) * metres) / 111320,
      pos[1] + (Math.sin(heading) * metres) / (111320 * Math.cos((pos[0] * Math.PI) / 180))];
  }
  battery = Math.max(1, battery - 0.05);

  return {
    ts: new Date().toISOString(),
    accel: { x: 0.02 + jitter(0.01 + level), y: -0.01 + jitter(0.01 + level), z: 0.99 + jitter(0.01 + level) },
    gps: { lat: pos[0], lon: pos[1], speed, sats: 9, hdop: 1.1 },
    battery: Math.round(battery),
    rssi: -60 - Math.round(Math.random() * 15),
    fw: '0.3.1-sim',
  };
}

async function send() {
  const packet = nextPacket();
  try {
    const res = await fetch(`${URL_BASE}/api/device/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(packet),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error(`Server answered ${res.status}: ${body.error || JSON.stringify(body)}`);
      if (res.status === 401) process.exit(1);
      return;
    }
    const mag = Math.hypot(packet.accel.x, packet.accel.y, packet.accel.z).toFixed(2);
    const alarms = body.alarms.length ? `  ALARM: ${body.alarms.map((a) => a.type).join(', ')}` : '';
    console.log(`#${String(tick).padStart(3)}  ${packet.gps.lat.toFixed(5)}, ${packet.gps.lon.toFixed(5)}  ` +
      `${mag} g  ${packet.battery} %  armed=${body.armed}${alarms}`);
  } catch (err) {
    console.error(`Cannot reach ${URL_BASE}: ${err.message}`);
  }
}

console.log(`Simulating device (${SCENARIO}) → ${URL_BASE}, every ${INTERVAL_S}s. Stop with Ctrl+C.\n`);
send();
setInterval(send, INTERVAL_S * 1000);
