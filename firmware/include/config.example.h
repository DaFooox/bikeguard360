// Copy this file to config.h and fill in your values.
// config.h is ignored by git, so your WLAN password stays private.
#pragma once

// WLAN
#define WIFI_SSID      "MeinWLAN"
#define WIFI_PASSWORD  "geheim"

// Server (no trailing slash). Use the LAN IP of the computer running the server.
#define SERVER_URL     "http://192.168.178.20:3000"

// Device key from the dashboard (Geräteeinstellungen → Geräteschlüssel)
#define DEVICE_KEY     "demo-key-stadtrad-0001"

// Pins
#define PIN_GPS_RX     16   // ESP32 RX2  <- GPS TX
#define PIN_GPS_TX     17   // ESP32 TX2  -> GPS RX
#define PIN_BATTERY    34   // ADC, battery voltage via 100k/100k divider
#define PIN_BUZZER     25   // piezo buzzer (via transistor)
#define PIN_LED        2    // on-board LED
// MPU6050 uses the default I2C pins: SDA 21, SCL 22
