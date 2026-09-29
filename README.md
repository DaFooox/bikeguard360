# BikeGuard360

**Diebstahlerkennung, Sofortalarm und GPS-Ortung für Fahrräder.**

BikeGuard360 ist ein am Fahrrad montierbares Gerät, das einen Diebstahlversuch selbstständig erkennt, den Eigentümer unmittelbar informiert und den Standort des Fahrrads anschließend fortlaufend verfügbar macht. Damit setzt das System nicht ausschließlich auf mechanische Abschreckung, sondern auf frühzeitige Meldung und Nachverfolgbarkeit.

---

## Inhalt

- [Kurzbeschreibung](#kurzbeschreibung)
- [Ist-Analyse](#ist-analyse)
- [Systemarchitektur](#systemarchitektur)
- [Projektstruktur](#projektstruktur)
- [Schnellstart](#schnellstart)
- [API](#api)
- [Roadmap](#roadmap)

## Kurzbeschreibung

Kern des Systems ist ein Mikrocontroller vom Typ **ESP32**, an den ein **Beschleunigungs- bzw. Erschütterungssensor** sowie ein **GPS-Modul** angeschlossen sind. Registriert der Sensor bei scharf geschaltetem Gerät eine ungewöhnliche Erschütterung oder Bewegung, wertet das System dies als möglichen Diebstahlversuch.

Der ESP32 überträgt die erfassten Sensor- und Positionsdaten per **WLAN** an einen Server. Dieser wertet die Daten anhand definierter Schwellenwerte aus, speichert sie in einer Datenbank und löst im Alarmfall eine Benachrichtigung an den Nutzer aus. Über eine **Weboberfläche** kann der Eigentümer den aktuellen Standort, den Bewegungsverlauf und den Gerätestatus einsehen.

Das Projekt besteht aus vier aufeinander abgestimmten Teilleistungen:

| # | Teilleistung | Inhalt |
|---|---|---|
| 1 | **Hardware-Prototyp** | ESP32, Beschleunigungssensor, GPS-Modul, Stromversorgung und ein geeignetes Gehäuse |
| 2 | **Firmware** | Sensorauswertung, Scharf-/Unscharf-Logik, WLAN-Übertragung der Daten an den Server |
| 3 | **Server & Datenbank** | Node.js-Anwendung: Datenannahme, Auswertung per Schwellenwert, Speicherung, Alarmierung |
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
┌──────────────────────────┐        WLAN / HTTP        ┌─────────────────────────┐
│  Gerät am Fahrrad        │  ───────────────────────▶ │  Server (Node.js)       │
│  ─ ESP32                 │   Sensor- & GPS-Daten     │  ─ Schwellenwert-Prüfung│
│  ─ Beschleunigungssensor │                           │  ─ Datenbank            │
│  ─ GPS-Modul             │                           │  ─ Alarm-Benachricht.   │
└──────────────────────────┘                           └────────────┬────────────┘
                                                                    │
                                        ┌───────────────────────────┼──────────────┐
                                        ▼                                          ▼
                              ┌───────────────────┐                    ┌────────────────────┐
                              │  Weboberfläche    │                    │  Benachrichtigung  │
                              │  Standort, Verlauf│                    │  an den Eigentümer │
                              │  Gerätestatus     │                    └────────────────────┘
                              └───────────────────┘
```

**Ablauf im Alarmfall**

1. Das Gerät ist scharf geschaltet, der Sensor überwacht Bewegungen.
2. Eine ungewöhnliche Erschütterung wird registriert.
3. Der ESP32 sendet Sensorwerte und GPS-Position an den Server.
4. Der Server prüft die Werte gegen definierte Schwellenwerte und speichert sie.
5. Bei Überschreitung wird der Nutzer benachrichtigt; Standort und Verlauf sind in der Weboberfläche abrufbar.

## Projektstruktur

```
bikeguard360/
├── public/             # Weboberfläche (statische Dateien)
│   ├── index.html      # Startseite
│   ├── css/style.css
│   └── js/main.js
├── server/
│   └── index.js        # Express-Server (Node.js)
├── package.json
└── README.md
```

## Schnellstart

**Voraussetzungen:** Node.js ≥ 18

```bash
npm install
npm start          # startet den Server auf http://localhost:3000
npm run dev        # Entwicklung mit automatischem Neustart
```

Der Port kann über die Umgebungsvariable `PORT` angepasst werden.

## API

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/health` | Statusprüfung des Servers |

Geplante Endpunkte (siehe Roadmap): Datenannahme vom ESP32, Abruf von Standort/Verlauf, Gerätestatus und Scharfschaltung.

## Roadmap

- [x] Projektgerüst mit Node.js/Express und Startseite
- [ ] Endpunkt zur Annahme von Sensor- und GPS-Daten vom ESP32
- [ ] Datenbankanbindung und Schwellenwert-Auswertung
- [ ] Alarm-Benachrichtigung an den Nutzer
- [ ] Dashboard mit Karte, Bewegungsverlauf und Gerätestatus
- [ ] Nutzer-Authentifizierung und Geräteverwaltung
- [ ] ESP32-Firmware
- [ ] Hardware-Prototyp und Gehäuse
