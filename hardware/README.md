# Hardware-Prototyp

## Stückliste

| Bauteil | Beispiel | Aufgabe |
|---|---|---|
| Mikrocontroller | ESP32 DevKit V1 (ESP32-WROOM-32) | Steuerung, WLAN |
| Beschleunigungssensor | MPU6050 (GY-521) | Erschütterung / Bewegung erkennen |
| GPS-Modul | u-blox NEO-6M (GY-GPS6MV2) mit Keramikantenne | Standortbestimmung |
| Akku | 18650 Li-Ion, 3,7 V, ≥ 2600 mAh | Stromversorgung |
| Lade-/Schutzmodul | TP4056 mit Schutzschaltung (USB-C) | Laden, Tiefentladeschutz |
| Spannungsregler | HT7333 / MCP1700 (3,3 V LDO) | 3,3 V für ESP32 und Sensoren |
| Spannungsteiler | 2 × 100 kΩ | Akkuspannung messen |
| Piezo-Summer | aktiver Summer 3–5 V + NPN-Transistor (BC547) + 1 kΩ | akustische Abschreckung |
| Schalter | Kippschalter | Hauptschalter |
| Gehäuse | IP65-Kunststoffgehäuse ca. 100 × 60 × 25 mm oder 3D-Druck (PETG/ASA) | Schutz vor Witterung |
| Befestigung | Flaschenhalter-Adapter oder Schellen, Sicherheitsschrauben | Montage am Rahmen |

## Verdrahtung

```
MPU6050        ESP32            NEO-6M GPS      ESP32
-------        -----            ----------      -----
VCC   ───────  3V3              VCC   ────────  3V3
GND   ───────  GND              GND   ────────  GND
SDA   ───────  GPIO 21          TX    ────────  GPIO 16 (RX2)
SCL   ───────  GPIO 22          RX    ────────  GPIO 17 (TX2)

Akku / Messung                    Summer
--------------                    ------
18650 ─ TP4056 ─ Schalter ─ LDO ─ 3V3        GPIO 25 ─ 1 kΩ ─ Basis BC547
Akku+ ─ 100 kΩ ─┬─ GPIO 34                   Kollektor ─ Summer(−), Summer(+) ─ 3V3
                └─ 100 kΩ ─ GND              Emitter ─ GND
```

Die Pins sind in `firmware/include/config.h` einstellbar.

## Hinweise zum Gehäuse

- **Montage verdeckt**, z. B. unter dem Sattel, im Rahmenrohr oder als Flaschenhalter getarnt – ein sichtbarer Tracker wird zuerst entfernt.
- **GPS-Antenne nach oben** ausrichten und nicht mit Metall abdecken.
- **Sensor fest verschrauben**, damit Erschütterungen des Rahmens unverfälscht ankommen.
- **Dichtung / IP65**, Kabeldurchführung für USB-Ladebuchse mit Gummikappe.
- **Sicherheitsschrauben** (z. B. Torx mit Stift) erschweren das schnelle Abschrauben.

## Energie

Im Dauerbetrieb (WLAN + GPS aktiv) liegt der Verbrauch bei ca. 120–180 mA, ein 2600-mAh-Akku hält damit etwa 15–20 Stunden. Für den Alltagseinsatz ist Deep-Sleep mit Aufwecken über den Bewegungs-Interrupt des MPU6050 (INT → GPIO 33) vorgesehen (siehe Roadmap).
