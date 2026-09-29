# BikeGuard360

**Diebstahlerkennung, Sofortalarm und GPS-Ortung für Fahrräder.**

BikeGuard360 ist ein am Fahrrad montierbares Gerät, das einen Diebstahlversuch selbstständig erkennt, den Eigentümer unmittelbar informiert und den Standort des Fahrrads anschließend fortlaufend verfügbar macht. Damit setzt das System nicht ausschließlich auf mechanische Abschreckung, sondern auf frühzeitige Meldung und Nachverfolgbarkeit.

---

## Inhalt

- [Kurzbeschreibung](#kurzbeschreibung)
- [Ist-Analyse](#ist-analyse)
- [Systemarchitektur](#systemarchitektur)
- [Schnellstart](#schnellstart)
- [Demo-Daten & Gerätesimulator](#demo-daten--gerätesimulator)
- [Weboberfläche](#weboberfläche)
- [Alarmlogik](#alarmlogik)
- [API](#api)
- [Datenbank](#datenbank)
- [Firmware (ESP32)](#firmware-esp32)
- [Konfiguration](#konfiguration)
- [Projektstruktur](#projektstruktur)
- [Tests](#tests)
- [Roadmap](#roadmap)

## Kurzbeschreibung

Kern des Systems ist ein Mikrocontroller vom Typ **ESP32**, an den ein **Beschleunigungs- bzw. Erschütterungssensor** sowie ein **GPS-Modul** angeschlossen sind. Registriert der Sensor bei scharf geschaltetem Gerät eine ungewöhnliche Erschütterung oder Bewegung, wertet das System dies als möglichen Diebstahlversuch.

Der ESP32 überträgt die erfassten Sensor- und Positionsdaten per **WLAN** an einen Server. Dieser wertet die Daten anhand definierter Schwellenwerte aus, speichert sie in einer Datenbank und löst im Alarmfall eine Benachrichtigung an den Nutzer aus. Über eine **Weboberfläche** kann der Eigentümer den aktuellen Standort, den Bewegungsverlauf und den Gerätestatus einsehen.

Das Projekt besteht aus vier aufeinander abgestimmten Teilleistungen:

| # | Teilleistung | Inhalt |
|---|---|---|
| 1 | **Hardware-Prototyp** | ESP32, Beschleunigungssensor, GPS-Modul, Stromversorgung und ein geeignetes Gehäuse |
| 2 | **Firmware** | Sensorauswertung, Scharf-/Unscharf-Logik, WLAN-Übertragung der Daten an den Server |
| 3 | **Server & Datenbank** | Node.js/Express mit SQLite: Datenannahme, Auswertung per Schwellenwert, Speicherung, Alarmierung |
| 4 | **Weboberfläche** | Anzeige von aktuellem Standort, Bewegungsverlauf und Gerätestatus für den Eigentümer |

## Ist-Analyse

Fahrraddiebstahl ist in Deutschland ein Massendelikt mit geringem Entdeckungsrisiko für die Täter.

| Kennzahl (2025) | Wert |
|---|---|
| Angezeigte Fahrraddiebstähle (PKS) | ca. **214.000** |
| Aufklärungsquote | ca. **11 %** (etwa jeder neunte Fall) |
| Von Versicherern entschädigte Räder | ca. **115.000** |
| Versicherte Schadenssumme | ca. **150 Mio. €** |
| Durchschnittlicher Schaden je Rad | **1.270 €** (Höchststand) |
| Geschätzter Gesamtschaden inkl. nicht versicherter Räder | **> 340 Mio. €** |

Da ein erheblicher Teil der Fälle nicht angezeigt wird, ist von einer deutlich höheren Dunkelziffer auszugehen. Für Betroffene bedeutet ein Diebstahl in der Regel den endgültigen Verlust des Fahrrads – genau hier setzt BikeGuard360 mit Alarmierung und Ortung an.

## Systemarchitektur

```
┌──────────────────────────┐   WLAN · HTTP POST (JSON)   ┌──────────────────────────────┐
│  Gerät am Fahrrad        │  ─────────────────────────▶ │  Server (Node.js / Express)  │
│  ─ ESP32                 │   Sensor- & GPS-Daten       │  ─ Geräte-API (API-Schlüssel)│
│  ─ MPU6050 (Beschl.)     │                             │  ─ Schwellenwert-Auswertung  │
│  ─ NEO-6M (GPS)          │ ◀─────────────────────────  │  ─ SQLite-Datenbank          │
│  ─ Summer                │   Konfiguration: scharf?,   │  ─ Benachrichtigungen        │
└──────────────────────────┘   Schwelle, Intervall       └──────────────┬───────────────┘
                                                                        │ REST + Server-Sent Events
                                             ┌──────────────────────────┼──────────────────────┐
                                             ▼                                                 ▼
                                   ┌────────────────────┐                        ┌──────────────────────────┐
                                   │  Weboberfläche     │                        │  Push (optional, ntfy)   │
                                   │  Karte, Verlauf,   │                        │  Browser-Benachrichtigung│
                                   │  Status, Alarme    │                        └──────────────────────────┘
                                   └────────────────────┘
```

**Ablauf im Alarmfall**

1. Der Eigentümer schaltet das Gerät im Dashboard scharf – der Server merkt sich den Abstellort.
2. Die Firmware misst die Beschleunigung mit 50 Hz. Überschreitet die Abweichung von 1 g die Schwelle, sendet sie **sofort** ein Datenpaket.
3. Der Server prüft das Paket: **Erschütterung** (Beschleunigung) und **Bewegung** (Entfernung vom Abstellort).
4. Bei Überschreitung legt er einen Alarm an, speichert eine Benachrichtigung und schickt sie live ans Dashboard (und optional als Push aufs Handy).
5. Die Antwort an das Gerät verkürzt das Meldeintervall auf 10 s und aktiviert den Summer – der Standort wird nun fortlaufend übertragen.

## Schnellstart

**Voraussetzungen:** Node.js ≥ 22.5 – sonst nichts. Die Datenbank nutzt das in Node.js eingebaute SQLite (`node:sqlite`), es muss also nichts kompiliert werden (keine Visual-Studio-Build-Tools unter Windows nötig).

```bash
npm install
npm run seed       # SQLite-Datenbank mit Demo-Daten anlegen (data/bikeguard360.db)
npm start          # Server auf http://localhost:3000
```

Dann <http://localhost:3000/login> öffnen und mit dem Demo-Zugang anmelden:

| E-Mail | Passwort |
|---|---|
| `demo@bikeguard360.de` | `demo1234` |

Für die Entwicklung startet `npm run dev` den Server mit automatischem Neustart bei Änderungen.

## Demo-Daten & Gerätesimulator

`npm run seed` erzeugt (reproduzierbar) eine Woche realistischer Daten in Berlin:

| Gerät | Seriennummer | Geräteschlüssel | Szenario |
|---|---|---|---|
| Stadtrad | BG360-0001 | `demo-key-stadtrad-0001` | Pendelt werktags zur Arbeit, ein Fehlalarm vor 3 Tagen – und **wird gerade gestohlen** (offene Alarme, Rad bewegt sich weg) |
| Rennrad | BG360-0002 | `demo-key-rennrad-0002` | Sonntagstour, seitdem scharf zu Hause; Akku fast leer (Alarm „Akku schwach“) |
| Lastenrad | BG360-0003 | `demo-key-lastenrad-0003` | Seit zwei Tagen offline |

Der **Gerätesimulator** verhält sich wie die echte Firmware und schickt Daten per HTTP an den Server – ideal, um Alarme live im Dashboard zu sehen:

```bash
npm run simulate                                  # Diebstahl-Szenario mit dem „Rennrad“
npm run simulate -- --scenario ride               # normale Fahrt
npm run simulate -- --scenario idle --interval 5  # nur Statusmeldungen
npm run simulate -- --key <geräteschlüssel> --url http://localhost:3000
```

## Weboberfläche

| Seite | Inhalt |
|---|---|
| `/` | Startseite mit Projektvorstellung |
| `/login`, `/register` | Anmeldung und Registrierung |
| `/dashboard` | Dashboard für den Eigentümer |

Das Dashboard zeigt:

- **Geräteliste** mit Online-Status, Scharf-Status, Akku und offenen Alarmen
- **Alarm-Banner** bei Diebstahl mit „Standort zeigen“, „Gesehen“ und „Entwarnung“
- **Scharf-/Unscharf-Schalter** (Unscharf schalten schließt offene Diebstahlalarme)
- **Statuskacheln**: Online-Status, Akku, WLAN-Signal, offene Alarme
- **Karte** (Leaflet + OpenStreetMap) mit aktuellem Standort, Bewegungsverlauf (1 h / 6 h / 24 h / 7 Tage), Abstellort und Alarm-Radius
- **Erschütterungsdiagramm** der letzten Messwerte mit Alarmschwelle
- **Alarmverlauf** und **Benachrichtigungen** (Glocke, optional Browser-Benachrichtigungen)
- **Geräteeinstellungen**: Name, Empfindlichkeit, Bewegungsradius, Geräteschlüssel anzeigen/kopieren/neu erzeugen, Gerät entfernen
- **Live-Aktualisierung** über Server-Sent Events – neue Positionen und Alarme erscheinen ohne Neuladen

## Alarmlogik

Die Auswertung erfolgt auf dem Server (`server/services/alarms.js`), die Schwellenwerte sind pro Gerät im Dashboard einstellbar.

| Alarm | Bedingung | Standard |
|---|---|---|
| **Erschütterung** (`motion`) | Gerät scharf und \|Beschleunigung − 1 g\| ≥ Schwelle | 0,35 g |
| **Bewegung** (`movement`) | Gerät scharf und Entfernung zum Abstellort > Radius | 30 m |
| **Akku schwach** (`low_battery`) | Akkustand fällt auf ≤ 15 % | – |

- Innerhalb von 5 Minuten wird derselbe Alarm nur **aktualisiert**, nicht neu ausgelöst – ein rüttelndes Rad erzeugt also keine Nachrichtenflut.
- Das **Meldeintervall** gibt der Server vor: 300 s unscharf, 60 s scharf, 10 s bei offenem Alarm.
- Alarme haben den Status `open` → `acknowledged` (gesehen) → `resolved` (erledigt).

## API

Alle Antworten sind JSON. Die Nutzer-API verwendet ein Session-Cookie (HttpOnly), die Geräte-API einen Geräteschlüssel.

### Geräte-API (ESP32)

Authentifizierung: `Authorization: Bearer <geräteschlüssel>` (alternativ `X-Device-Key`).

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/api/device/telemetry` | Messwert senden (einzeln oder `{ "readings": [...] }` als Stapel) |
| `GET` | `/api/device/config` | Aktuelle Konfiguration abrufen |

Beispiel:

```bash
curl -X POST http://localhost:3000/api/device/telemetry \
  -H "Authorization: Bearer demo-key-rennrad-0002" -H "Content-Type: application/json" \
  -d '{"accel":{"x":0.02,"y":-0.01,"z":0.99},"gps":{"lat":52.5402,"lon":13.4127,"speed":0,"sats":9,"hdop":1.1},"battery":80,"rssi":-61,"fw":"0.3.1"}'
```

Antwort:

```json
{ "accepted": 1, "alarms": [], "armed": true, "alarm_active": false,
  "motion_threshold": 0.25, "report_interval_s": 60, "server_time": "2026-09-29T09:00:00.000Z" }
```

Felder eines Messwerts: `ts` (ISO-Zeit oder Unix-Sekunden, optional), `accel.x/y/z` (g), `gps.lat/lon/speed/sats/hdop`, `battery` (%), `rssi` (dBm), `fw`.

### Nutzer-API

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/api/auth/register` | Registrieren (`email`, `name`, `password`) |
| `POST` | `/api/auth/login` | Anmelden (`email`, `password`) |
| `POST` | `/api/auth/logout` | Abmelden |
| `GET` | `/api/auth/me` | Angemeldeter Nutzer |
| `GET` | `/api/devices` | Eigene Geräte |
| `POST` | `/api/devices` | Gerät hinzufügen (`name`, `serial`) – liefert den Geräteschlüssel |
| `GET` | `/api/devices/:id` | Gerätedetails inkl. Geräteschlüssel |
| `PATCH` | `/api/devices/:id` | Ändern: `name`, `armed`, `motion_threshold`, `move_radius_m` |
| `DELETE` | `/api/devices/:id` | Gerät mit allen Daten entfernen |
| `POST` | `/api/devices/:id/regenerate-key` | Neuen Geräteschlüssel erzeugen |
| `GET` | `/api/devices/:id/track?from=&to=` | GPS-Verlauf (Standard: letzte 24 h) |
| `GET` | `/api/devices/:id/readings?limit=` | Letzte Rohmesswerte |
| `GET` | `/api/devices/:id/stats` | Kennzahlen der letzten 7 Tage |
| `GET` | `/api/alarms?device_id=&status=` | Alarme |
| `PATCH` | `/api/alarms/:id` | Status setzen (`acknowledged`, `resolved`) |
| `GET` | `/api/notifications` | Benachrichtigungen + Anzahl ungelesen |
| `POST` | `/api/notifications/read-all` | Alle als gelesen markieren |
| `GET` | `/api/events` | Live-Stream (Server-Sent Events): `device`, `position`, `alarm`, `notification` |
| `GET` | `/api/health` | Statusprüfung |

## Datenbank

SQLite über das in Node.js eingebaute Modul [`node:sqlite`](https://nodejs.org/api/sqlite.html) – ohne native Abhängigkeiten. Unter Node.js 22.5–22.12 ist dafür der Schalter `--experimental-sqlite` nötig; die npm-Skripte setzen ihn automatisch, daher den Server immer über `npm start` / `npm run seed` starten. Das Schema steht in [`server/schema.sql`](server/schema.sql) und wird beim Start automatisch angelegt.

| Tabelle | Inhalt |
|---|---|
| `users` | Nutzer (Passwort als scrypt-Hash) |
| `sessions` | Anmeldesitzungen |
| `devices` | Geräte, Schwellenwerte, Scharf-Status und Abstellort, letzter Zustand |
| `readings` | Alle empfangenen Messwerte (Beschleunigung, GPS, Akku, Signal) |
| `alarms` | Ausgelöste Alarme mit Status |
| `notifications` | Benachrichtigungen an den Nutzer |

## Firmware (ESP32)

Die Firmware liegt in [`firmware/`](firmware/) als [PlatformIO](https://platformio.org)-Projekt:

```bash
cd firmware
cp include/config.example.h include/config.h   # WLAN, Server-URL und Geräteschlüssel eintragen
pio run -t upload && pio device monitor
```

Sie tastet den MPU6050 mit 50 Hz ab, meldet die stärkste Erschütterung seit dem letzten Paket, sendet bei scharfem Gerät und Überschreitung der Schwelle sofort, puffert Pakete ohne WLAN und übernimmt Scharf-Status, Schwelle und Meldeintervall aus der Serverantwort. Bei aktivem Alarm ertönt der Summer.

Stückliste, Verdrahtung und Hinweise zum Gehäuse: [`hardware/README.md`](hardware/README.md).

## Konfiguration

Umgebungsvariablen (oder eine `.env`-Datei, siehe [`.env.example`](.env.example)):

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Webservers |
| `DB_PATH` | `./data/bikeguard360.db` | Pfad der SQLite-Datenbank |
| `SESSION_TTL_HOURS` | `168` | Gültigkeit einer Anmeldung |
| `OFFLINE_AFTER_MIN` | `15` | Ab wann ein Gerät als offline gilt |
| `TILE_URL` | OpenStreetMap | Kachel-Server der Karte, z. B. `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png` |
| `TILE_ATTRIBUTION` | OpenStreetMap-Hinweis | Quellenangabe unten rechts in der Karte (Pflicht beim jeweiligen Anbieter) |
| `NTFY_URL` | – | Optional: Alarme zusätzlich als Push über [ntfy](https://ntfy.sh) senden, z. B. `https://ntfy.sh/mein-geheimes-thema` |

## Projektstruktur

```
bikeguard360/
├── server/
│   ├── index.js            # Einstiegspunkt
│   ├── app.js              # Express-App, Routen
│   ├── config.js           # Konfiguration aus Umgebungsvariablen
│   ├── db.js, schema.sql   # SQLite
│   ├── middleware/auth.js  # Sitzungen und Geräteschlüssel
│   ├── routes/             # auth, devices, alarms, notifications, device-api, events
│   └── services/           # Alarmlogik, Benachrichtigungen, Live-Events, Hilfsfunktionen
├── public/                 # Weboberfläche: Startseite, Login, Dashboard
├── scripts/
│   ├── seed.js             # Datenbank mit Demo-Daten erzeugen
│   └── simulate.js         # ESP32-Gerätesimulator
├── firmware/               # ESP32-Firmware (PlatformIO)
├── hardware/               # Stückliste, Verdrahtung, Gehäuse
└── test/                   # API-Tests (node:test)
```

## Tests

```bash
npm test
```

Die Tests starten den Server mit einer In-Memory-Datenbank und prüfen Anmeldung, Zugriffsschutz, Geräteverwaltung, Datenannahme und die Alarmlogik.

## Roadmap

- [x] Server mit SQLite, Nutzerkonten und Geräteverwaltung
- [x] Datenannahme vom ESP32 mit Schwellenwert-Auswertung
- [x] Alarme und Benachrichtigungen (Dashboard, Browser, optional ntfy)
- [x] Dashboard mit Karte, Bewegungsverlauf, Diagramm und Gerätestatus
- [x] Demo-Daten und Gerätesimulator
- [x] ESP32-Firmware (Sensor, GPS, WLAN, Pufferung, Summer)
- [ ] Deep-Sleep mit Aufwecken über den Bewegungs-Interrupt des MPU6050
- [ ] Mobilfunk (LTE-M / NB-IoT) statt WLAN für die Ortung unterwegs
- [ ] HTTPS und Zertifikatsprüfung in der Firmware
- [ ] Hardware-Prototyp und 3D-gedrucktes Gehäuse
