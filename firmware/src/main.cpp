/*
 * BikeGuard360 – ESP32 firmware
 *
 * Reads the MPU6050 acceleration sensor and the GPS module, sends the data
 * to the BikeGuard360 server over WLAN and follows the configuration the
 * server returns (armed state, alarm threshold, report interval).
 *
 * - Sensor sampled at 50 Hz, the peak deviation from 1 g is reported
 * - When armed and the threshold is exceeded, a packet is sent immediately
 * - Packets that cannot be delivered are buffered and sent later as a batch
 * - While the server reports an open theft alarm, the buzzer sounds
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>

#if __has_include("config.h")
#include "config.h"
#else
#error "Copy include/config.example.h to include/config.h and adjust it"
#endif

#define FW_VERSION "0.3.1"

static const float GRAVITY = 9.80665f;
static const uint32_t SAMPLE_MS = 20;            // 50 Hz
static const uint32_t MIN_ALARM_SEND_MS = 5000;  // at most one extra packet per 5 s
static const size_t BUFFER_SIZE = 40;

Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Configuration received from the server
struct {
  bool armed = false;
  bool alarmActive = false;
  float motionThreshold = 0.35f;   // g
  uint32_t reportIntervalMs = 60000;
} cfg;

struct Reading {
  uint32_t epoch;                   // 0 = unknown (no GPS time yet)
  float ax, ay, az;                 // g, sample with the largest deviation
  bool hasFix;
  double lat, lon;
  float speed, hdop;
  uint8_t sats;
  uint8_t battery;
  int8_t rssi;
};

Reading buffer[BUFFER_SIZE];
size_t buffered = 0;

// Peak tracking between two reports
float peakDev = 0, peakX = 0, peakY = 0, peakZ = 1;
uint32_t lastSample = 0, lastReport = 0, lastAlarmSend = 0;

/* ------------------------------------------------------------------ helpers */

uint8_t batteryPercent() {
  // 1S Li-Ion: 3.3 V = 0 %, 4.2 V = 100 %, measured through a 1:2 divider
  float v = analogReadMilliVolts(PIN_BATTERY) * 2 / 1000.0f;
  float p = (v - 3.3f) / (4.2f - 3.3f) * 100.0f;
  return (uint8_t)constrain(p, 0.0f, 100.0f);
}

uint32_t gpsEpoch() {
  if (!gps.date.isValid() || !gps.time.isValid() || gps.date.year() < 2024) return 0;
  struct tm t = {};
  t.tm_year = gps.date.year() - 1900;
  t.tm_mon = gps.date.month() - 1;
  t.tm_mday = gps.date.day();
  t.tm_hour = gps.time.hour();
  t.tm_min = gps.time.minute();
  t.tm_sec = gps.time.second();
  setenv("TZ", "UTC0", 1);
  tzset();
  return (uint32_t)mktime(&t);
}

void connectWifi(uint32_t timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("WLAN: connecting to %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) delay(100);
  Serial.println(WiFi.status() == WL_CONNECTED ? "WLAN: connected" : "WLAN: not available");
}

/* ------------------------------------------------------------------ sensor */

void sampleSensor() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  float x = a.acceleration.x / GRAVITY;
  float y = a.acceleration.y / GRAVITY;
  float z = a.acceleration.z / GRAVITY;
  float dev = fabsf(sqrtf(x * x + y * y + z * z) - 1.0f);
  if (dev > peakDev) {
    peakDev = dev; peakX = x; peakY = y; peakZ = z;
  }
}

Reading takeReading() {
  Reading r = {};
  r.epoch = gpsEpoch();
  r.ax = peakX; r.ay = peakY; r.az = peakZ;
  r.hasFix = gps.location.isValid() && gps.location.age() < 10000;
  if (r.hasFix) {
    r.lat = gps.location.lat();
    r.lon = gps.location.lng();
    r.speed = gps.speed.isValid() ? gps.speed.kmph() : 0;
    r.hdop = gps.hdop.isValid() ? gps.hdop.hdop() : 0;
  }
  r.sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
  r.battery = batteryPercent();
  r.rssi = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  peakDev = 0; peakX = 0; peakY = 0; peakZ = 1;
  return r;
}

/* ------------------------------------------------------------------ server */

void toJson(JsonObject o, const Reading &r) {
  if (r.epoch) o["ts"] = r.epoch;
  JsonObject a = o["accel"].to<JsonObject>();
  a["x"] = r.ax; a["y"] = r.ay; a["z"] = r.az;
  if (r.hasFix) {
    JsonObject g = o["gps"].to<JsonObject>();
    g["lat"] = serialized(String(r.lat, 6));
    g["lon"] = serialized(String(r.lon, 6));
    g["speed"] = r.speed;
    g["sats"] = r.sats;
    g["hdop"] = r.hdop;
  }
  o["battery"] = r.battery;
  if (r.rssi) o["rssi"] = r.rssi;
  o["fw"] = FW_VERSION;
}

bool sendBuffered() {
  connectWifi(8000);
  if (WiFi.status() != WL_CONNECTED) return false;

  JsonDocument doc;
  JsonArray list = doc["readings"].to<JsonArray>();
  for (size_t i = 0; i < buffered; i++) toJson(list.add<JsonObject>(), buffer[i]);
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/device/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_KEY);
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code != 201) {
    Serial.printf("Server: HTTP %d\n", code);
    http.end();
    return false;
  }

  JsonDocument res;
  if (!deserializeJson(res, http.getString())) {
    cfg.armed = res["armed"] | cfg.armed;
    cfg.alarmActive = res["alarm_active"] | false;
    cfg.motionThreshold = res["motion_threshold"] | cfg.motionThreshold;
    cfg.reportIntervalMs = (res["report_interval_s"] | 60) * 1000UL;
    if (res["alarms"].size() > 0) Serial.println("Server: ALARM raised");
  }
  http.end();
  Serial.printf("Sent %u reading(s) - armed=%d alarm=%d next in %lus\n", (unsigned)buffered, cfg.armed,
                cfg.alarmActive, cfg.reportIntervalMs / 1000);
  buffered = 0;
  return true;
}

void report() {
  if (buffered == BUFFER_SIZE) {
    // Buffer full: drop the oldest reading
    memmove(buffer, buffer + 1, sizeof(Reading) * (BUFFER_SIZE - 1));
    buffered--;
  }
  buffer[buffered++] = takeReading();
  sendBuffered();
  lastReport = millis();
}

/* ------------------------------------------------------------------ main */

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  analogReadResolution(12);
  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  Serial.printf("\nBikeGuard360 firmware %s\n", FW_VERSION);
  if (!mpu.begin()) {
    Serial.println("MPU6050 not found - check wiring!");
    while (true) { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(150); }
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  connectWifi(15000);
  report();   // announce ourselves and fetch the configuration
}

void loop() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());

  uint32_t now = millis();
  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    sampleSensor();
  }

  // Report immediately when an armed bike is shaken
  bool tamper = cfg.armed && peakDev >= cfg.motionThreshold;
  if (tamper && now - lastAlarmSend >= MIN_ALARM_SEND_MS) {
    Serial.printf("Motion detected: %.2f g\n", peakDev);
    lastAlarmSend = now;
    report();
  } else if (now - lastReport >= cfg.reportIntervalMs) {
    report();
  }

  // LED: on = armed; buzzer beeps while an alarm is active
  digitalWrite(PIN_LED, cfg.armed);
  digitalWrite(PIN_BUZZER, cfg.alarmActive && (now / 250) % 2);
}
