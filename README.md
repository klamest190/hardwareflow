# HardwareFlow

Dark-Mode System-Monitor als Desktop-App. Die Übersicht zeigt CPU, RAM, GPU,
Massenspeicher und den HardwareFlow Score (0–100). Netzwerk, Prozesse, Akku, Verlauf und
Einstellungen haben eigene Seiten. Die App läuft im Tray weiter, zeichnet eine Woche
Verlauf auf und warnt per Benachrichtigung.

Electron · React 19 · TypeScript · Tailwind CSS 4 · Recharts · Framer Motion · Lucide
Icons · `systeminformation`

## Befehle

```bash
npm install

npm run dev            # Desktop-App mit echten Messwerten + Vite-HMR
npm run dev:web        # nur Renderer im Browser, Werte simuliert
npm start              # Desktop-App aus dem Production-Build
npm run probe          # einmal Hardware auslesen und als JSON ausgeben
npm run probe -- --raw # Rohdaten anonymisiert ausgeben (Test-Fixture)
npm run selftest:app   # App starten, alle Seiten + Mini-Ansicht prüfen, beenden
npm run check          # lint + build + smoke
npm run icon           # App-Icon aus dem SVG in make-icon.mjs neu rendern
npm run package        # Installer nach release/ bauen
npm run selftest:packaged  # denselben Selbsttest gegen release/win-unpacked, plus Autostart
```

`HARDWAREFLOW_SCREENSHOTS=<Ordner> npm run selftest:app` legt zusätzlich von jeder Seite
und der Mini-Ansicht ein PNG der ganzen Seite ab. Der Selbsttest läuft mit einem eigenen
Profil im Temp-Ordner: Er kollidiert nicht mit einer laufenden HardwareFlow-Instanz und
schreibt nichts in den echten Verlauf. Er prüft außerdem, dass Pausieren den
PowerShell-Leser beendet, dass Leistungsindikatoren ankommen, dass Schließen in den Tray
legt und — gepackt — dass Autostart schaltbar ist.

Zwei Betriebsarten, im Header sichtbar beschriftet:

| Start | Quelle | Badge |
| --- | --- | --- |
| `npm run dev`, `npm start` | Messwerte aus dem Main-Prozess | **Live-Messung** |
| `npm run dev:web` (Browser) | Simulator | **Simulation** |

## Seiten

| Seite | Inhalt |
| --- | --- |
| Übersicht | Prozessor, HardwareFlow Score, Arbeitsspeicher, Grafik, Massenspeicher |
| Netzwerk | Durchsatz der letzten Minute, aktive Adapter, WLAN-Verbindung |
| Prozesse | Top 10 nach CPU und nach RAM, nach Programm gebündelt; Speicherort öffnen, beenden |
| Akku | Ladestand, Zustand gegenüber der Nennkapazität, Zyklen — nur mit Akku |
| Verlauf | 1 h / 24 h / 7 Tage, Warnmarken und -liste, Prognose fürs Systemlaufwerk, CSV-Export |
| Einstellungen | Autostart, Benachrichtigungen, Tray-Verhalten, Warnschwellen, Version |

Die Navigation ist ab `lg` eine Seitenleiste mit Live-Werten neben den Einträgen, darunter
eine horizontale Leiste. Reserve-Ring, Pause-Knopf und Warnungen stehen auf jeder Seite.
Die zuletzt geöffnete Seite wird gemerkt.

## Desktop

- **Tray:** Schließen versteckt das Fenster, Messung, Verlauf und Warnungen laufen weiter.
  Das Symbol zeigt CPU und RAM als zwei Balken in Statusfarben (alle 5 s,
  `electron/trayIcon.ts`), der Tooltip dieselben Werte in Zahlen. Das Menü öffnet
  Dashboard und Mini-Ansicht und schaltet die Einstellungen. Beenden nur über das Tray-Menü.
- **Mini-Ansicht:** 320 × 212 px, rahmenlos, immer im Vordergrund, unten rechts. Zeigt
  Reserve, CPU, RAM, GPU und Netzwerk bzw. die dringendste Warnung. Sie pausiert die
  Messung nie — das bleibt dem Dashboard vorbehalten.
- **Autostart:** nur in der installierten App (`app.isPackaged`). Im Entwicklungsmodus
  würde der Login-Eintrag auf die nackte `electron.exe` zeigen. Gestartet wird mit
  `--hidden` direkt in den Tray. Der Zustand wird aus Windows gelesen, nicht gespeichert.
- **Warnungen** (`src/lib/alerts.ts`): CPU-Temperatur für 60 s, GPU-Temperatur für 30 s,
  RAM für 60 s, Systemlaufwerk (Prozent oder GB) und Akku ohne Netzteil sofort. Die
  Schwellen stehen in den Einstellungen (Standard 95 °C / 87 °C / 95 % / 5 % bzw. 10 GB /
  15 %), werden beim Laden und über IPC auf ihren Bereich begrenzt und gelten für Banner,
  Mini-Ansicht und Benachrichtigungen gleich. Benachrichtigungen kommen pro Warnung
  höchstens alle 30 Minuten; das **Warnprotokoll** (`userData/alert-log.json`, 7 Tage,
  höchstens 500 Einträge) hält jede ausgelöste Warnung fest und steht im Verlauf.
- **Prozesse beenden:** per Programmname und PIDs. Der Main-Prozess liest die
  Prozesstabelle vorher neu und beendet nur PIDs, die noch zu diesem Programm gehören —
  eine inzwischen wiederverwendete PID trifft so nie ein fremdes Programm. Gesperrt sind
  Windows-Systemprozesse (`csrss`, `lsass`, `svchost`, `dwm`, `explorer` u. a.,
  `electron/processPolicy.ts`) und HardwareFlow selbst. „Speicherort öffnen“ nimmt nur
  existierende, absolute Pfade auf `.exe`.
- **Sicherheit:** Renderer ohne Node-Zugriff, Sandbox und Context-Isolation. Das gebaute
  `index.html` trägt eine Content-Security-Policy (`script-src 'self'`, keine Verbindungen
  nach außen); im Dev-Server fehlt sie, weil Vite Inline-Skripte für HMR braucht.
- **Installer:** NSIS mit Wahl des Zielordners, Desktop- und Startmenü-Verknüpfung.
  Kein Auto-Update — dafür fehlt ein Ort für Releases.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `electron/main.ts` | Fenster, Tray, Mini-Ansicht, IPC, Warnungen, Selbsttest |
| `electron/preload.ts` | Context-Bridge, Typen in `src/types/bridge.d.ts` |
| `electron/hardwareProbe.ts` | Gestaffeltes Polling über `systeminformation`, nur Cache |
| `electron/counterReader.ts` | PowerShell-Dauerprozess: Leistungsindikatoren, DXGI, Sensoren |
| `electron/probeMapping.ts` | Rohdaten → Domänenmodell, rein und gegen Fixtures getestet |
| `electron/processControl.ts` | Prozesse beenden, Speicherort öffnen; Sperrliste in `processPolicy.ts` |
| `electron/trayIcon.ts` | Tray-Symbol als Live-Balken, reines Pixelraster |
| `electron/historyStore.ts` | Minutenwerte und Warnprotokoll einer Woche in `userData/` |
| `electron/settings.ts` | Desktop-Einstellungen und Autostart |
| `electron/windowState.ts` | Fenstergeometrie merken, gegen die realen Displays geprüft |
| `src/lib/hardwareScore.ts` | HardwareFlow Score und Reserve |
| `src/lib/benchmarks.ts` | Leistungstabelle für CPUs und GPUs |
| `src/lib/history.ts` | Minuten-Buckets, Verdichtung, Laufwerksprognose, CSV, Warnprotokoll |
| `src/lib/alerts.ts` | Warnregeln mit Haltezeit, Schwellen und ihre Grenzen |
| `src/lib/pages.ts` | Seiten und Navigationseinträge |
| `src/services/hardwareService.ts` | Facade: Quellenwahl, Live-Fenster, Verlauf |
| `src/services/mockHardware.ts` | Simulator inkl. einer simulierten Woche Verlauf |
| `src/components/` | Karten, Navigation, Header, Warnbanner |
| `src/MiniView.tsx` | Mini-Ansicht — dasselbe Bundle, geladen mit `#mini` |
| `scripts/fixtures/` | Aufgezeichnete, anonymisierte Rohdaten echter Rechner |

## Gestaffeltes Polling

Ein vollständiger `systeminformation`-Durchlauf kostet unter Windows mehrere Sekunden,
weil die meisten Aufrufe WMI bzw. PowerShell starten. Deshalb pollt der Probe in Stufen,
jede mit einem Overlap-Schutz, damit ein hängender WMI-Aufruf sich nicht selbst aufstaut:

| Stufe | Intervall | Aufrufe |
| --- | --- | --- |
| fast | 1 s | `currentLoad`, `mem`, `cpuCurrentSpeed`, `time` |
| medium | 2 s | `graphics`, `cpuTemperature` |
| network | 2 s | `networkStats('*')` — allein 1,2–2,2 s |
| slow | 15 s | `fsSize`, `blockDevices`, `processes`, `networkInterfaces`, `wifiConnections`, `battery` |
| static | 5 min | `osInfo`, `cpu`, `memLayout`, `diskLayout` |
| counters | 2 s, eigener Prozess | Disk-I/O, GPU-Engines, DXGI-Adapter, LHM-Sensoren |

## Leistungsindikatoren und Sensoren

`systeminformation` liefert unter Windows weder Durchsatz pro Laufwerk noch die
Auslastung von Intel- oder AMD-Grafik. Beides gibt es als Leistungsindikatoren — aber
teuer: Auf dem Referenz-Notebook dauerten drei kalte WMI-Abfragen zusammen rund 98 s, in
einer warmen CIM-Sitzung danach ~0,3 s (Datenträger) und ~0,7 s (GPU-Engines mit Last).
Deshalb liest **ein** PowerShell-Prozess dauerhaft und schreibt alle 2 s eine JSON-Zeile
(`electron/counterReader.ts`):

- **Datenträger:** `Win32_PerfFormattedData_PerfDisk_PhysicalDisk`. Der Klassenname ist
  nicht lokalisiert (`Get-Counter '\PhysicalDisk(*)'` scheitert auf deutschem Windows), und
  der Instanzname `0 C:` nennt die Laufwerksbuchstaben. Alle Volumes einer Platte zeigen
  deren Durchsatz; Netzlaufwerke nie.
- **GPU:** `…_GPUEngine`, gefiltert auf Engines mit Last. Pro Engine-Typ über alle
  Prozesse summiert, die geschäftigste Engine ist die Auslastung des Adapters — wie im
  Task-Manager. Welche LUID zu welchem Adapter gehört, sagt DXGI (per `Add-Type`
  kompiliert, ~3 s beim Start); der „Microsoft Basic Render Driver“ wird ignoriert.
  nvidia-smi hat Vorrang, die Zähler füllen den Rest — die Intel-iGPU und eine schlafende
  dGPU zeigen damit 0 % statt `n/v`.
- **Sensoren:** Läuft LibreHardwareMonitor oder OpenHardwareMonitor (als Administrator),
  kommen CPU-Temperatur (Package-Sensor, sonst heißester Kern), CPU-Leistung und
  Lüfterdrehzahlen aus deren WMI-Namespace. Mitgeliefert wird keins von beiden — sie
  brauchen einen Kernel-Treiber. Ohne sie sagt die Prozessor-Karte, wie man die Werte
  bekommt.

Der Prozess startet beim Warm-up, endet beim Pausieren, startet bei Absturz mit Backoff
neu (5 s bis 60 s) und beendet sich selbst, wenn der Electron-Prozess verschwindet.

Gesendet wird auf jedem fast-Tick, zusammengesetzt aus dem jeweils letzten Stand jeder
Stufe.

**Pause hält die Messung an, nicht nur die Anzeige.** Der Pause-Knopf stoppt die Timer
im Main-Prozess. Ein Tick, der beim Pausieren noch in WMI hängt, wird verworfen, statt
nachträglich noch eine Messung zu senden.

## Tests gegen echte Hardware

Fast alle bisherigen Fehler steckten in der Übersetzung der Rohdaten: ein Netzlaufwerk
als lokaler Speicher, der Hersteller doppelt im Namen, „2.5 Gigabit“ als 5 GbE erkannt.
Deshalb ist das Mapping (`probeMapping.ts`) frei von I/O und läuft im Smoke-Test gegen
aufgezeichnete Rohdaten:

```bash
npm run probe -- --raw > scripts/fixtures/<rechner>.json
```

Hostname, Seriennummern, MAC- und IP-Adressen, SSIDs und der Benutzername in Pfaden
werden dabei ersetzt.

Zwei Fixtures desselben Notebooks: `notebook-rtx4070.json` ohne Leistungsindikatoren
(GPU schläft) und `notebook-rtx4070-counters.json` mit ihnen (Disk-I/O, DXGI-Adapter,
GPU-Engines). Sensorwerte von LibreHardwareMonitor prüft der Smoke-Test mit
konstruierten Daten, weil LHM auf dem Referenzrechner nicht läuft. Die erste Fixture
stammt von einem Notebook mit Core Ultra 7 155H, schlafender
RTX 4070 Laptop (Optimus), gemapptem Netzlaufwerk, VPN-Adapter, Wi-Fi 7 und gealtertem
Akku. Der Smoke-Test prüft daran unter anderem, dass die schlafende GPU `n/v` meldet
statt 0 %, die Freigabe nicht in die Summe zählt und der TAP-Adapter als virtuell gilt.

## Netzlaufwerke

Windows blendet gemappte Freigaben in `fsSize()` neben echten Volumes ein. Sie stehen
darum unter „Netzlaufwerke“ getrennt von den lokalen Volumes und zählen weder in die
Kapazitäts-Summe noch in den Score. Erkannt werden sie über
`blockDevices().physical === 'Network'`.

## Was Windows nicht herausgibt

Jedes gemessene Feld im Modell ist `| null`, und die UI zeigt dafür ein `n/v` mit
Erklärung im Tooltip — kein Platzhalter-Null. Auf einem typischen Windows-Notebook
fehlen (per `npm run probe` nachprüfbar):

- **CPU-Temperatur, Lüfter, CPU-Leistung** — ohne LibreHardwareMonitor meldet Windows
  keinen Wert. Die CPU-Hitzewarnung greift dann nie.
- **Datei-Cache im RAM** — `buffcache` ist unter Windows 0.
- **Disk-I/O und iGPU-Auslastung in den ersten Sekunden** — die Leistungsindikatoren
  brauchen nach dem Start einige Sekunden (DXGI-Helfer kompilieren, erste WMI-Abfrage),
  auf einem frisch gestarteten Rechner auch länger.
- **Nenn-Turbotakt** — manche CPUs (Intel Core Ultra) melden ihren Basistakt als
  `speedMax`. Angezeigt wird der höchste beobachtete Takt; der Score nutzt ihn nicht.
- **GPU-Auslastung über nvidia-smi im Leerlauf** — eine schlafende Optimus-dGPU meldet
  N/A; die Leistungsindikatoren springen dann ein.
- **Akku-Ladezyklen** — Windows meldet meist 0, daraus wird `n/v`.
- **Netzwerk-Durchsatz beim Start** — `networkStats` braucht zwei Zählerstände; der
  erste Wert kommt nach etwa zwei Sekunden.

## Der Score

`computeHardwareScore` bewertet, was die Maschine **ist** — CPU, GPU, RAM, Speicher und
Ausstattung. Er hängt nicht an der Last und bleibt bei jedem Tick gleich. Was die Maschine
gerade **übrig hat**, zeigt getrennt davon der Reserve-Ring im Header
(`computeHeadroom`: 100 − gewichtete Last der letzten 10 s).

| Baustein | Gewicht | 100 Punkte bei |
| --- | --- | --- |
| CPU-Leistung | 35 % | Leistungsindex 60 000 (Ryzen 9 7950X, Core i9-14900K) |
| Grafik | 30 % | Leistungsindex 36 000 (RTX 4080 / 5080) |
| Arbeitsspeicher | 15 % | 64 GB, +5 für DDR5 |
| Massenspeicher | 10 % | NVMe mit 4 TB |
| Ausstattung | 10 % | 10 GbE, 2.5 GbE, Wi-Fi 7/6E, ECC, 16+ Kerne, 64 GB+, 16 GB+ VRAM, 4 TB+ NVMe, Multi-GPU |

CPU, GPU und RAM steigen mit der Wurzel, nicht linear: Von 8 auf 16 GB ist ein anderer
Rechner, von 48 auf 64 GB nicht. So landet ein starkes Notebook hoch statt in der Mitte,
und 100 erreicht nur aktuelle Spitzenhardware. Das Referenz-Notebook der Fixture kommt
auf 74, die simulierte Workstation auf 99.

| Band | ab |
| --- | --- |
| Oberklasse | 85 |
| Leistungsstark | 70 |
| Solide | 55 |
| Einstieg | 40 |
| Veraltet | 0 |

**Leistungstabelle.** Threads und VRAM sagen wenig über Tempo: Ein 8-Kern-Ryzen 7 9800X3D
schlägt einen 24-Thread-Xeon von 2017, und eine Radeon 890M ist keine Intel UHD. Der Score
schlägt das Modell deshalb in `benchmarks.ts` nach — gerundete Richtwerte auf einer
PassMark-ähnlichen Skala, keine Messung dieses Geräts. Unbekannte Modelle werden aus
Threads × Basistakt bzw. VRAM geschätzt und im Dashboard als „geschätzt“ markiert. Gezählt
wird die stärkste GPU, nicht die zuerst gelistete, damit eine schlafende dGPU nicht hinter
die iGPU fällt.

## Verlauf

Der Main-Prozess fasst jede Messung zu Minutenwerten zusammen (Mittel und Spitze der CPU,
RAM, GPU, Temperaturspitzen, Netzwerk, Füllstand des Systemlaufwerks). Er speichert eine
Woche, alle fünf Minuten und beim Beenden, über eine temporäre Datei mit Umbenennung. Ein
Stromausfall beim Schreiben lässt so die alte Woche stehen. Für 24 h und 7 Tage werden die
Minuten auf 10 bzw. 60 Minuten verdichtet.

**CSV-Export:** der gewählte Zeitraum als Minutenwerte, mit Semikolon, Dezimalkomma und
BOM — so öffnet Excel auf einem deutschen System die Datei direkt richtig.

Die **Laufwerksprognose** ist eine lineare Regression über den freien Platz auf C:. Sie
sagt erst nach 6 Stunden Verlauf etwas und ignoriert Schwankungen unter 200 MB pro Tag,
damit ein einzelner großer Download nicht das Ende der Platte ankündigt.

## Farben und Hervorhebung

Die Modulfarben (`src/lib/palette.ts`) sind validierte Dark-Mode-Slots, geprüft gegen die
Kartenfläche `#14161c`: Blau CPU, Aqua RAM, Violett GPU, Gelb Speicher, Orange Netzwerk,
Magenta Akku. Wo mehrere in einem Diagramm stehen (Verlauf), gilt die Reihenfolge
CPU → RAM → GPU. Sie besteht alle Nachbarschaftsprüfungen, auch für Farbfehlsichtigkeit.
CPU direkt neben GPU besteht sie nicht. Upload im Netzwerkdiagramm ist eine dünne graue
Linie, also über Form und Gewicht unterscheidbar, nicht nur über die Farbe.

Die Status-Palette (`lib/status.ts`) ist davon getrennt und wird nie als Serienfarbe
verwendet. Werte und Labels tragen Ink-Tokens, nie die Datenfarbe.

Die Hardware-Karten tragen einen Neon-Akzent, der aus der einen Custom Property
`--hf-accent` gemischt wird. Score- und Verlaufskarte sind bewusst `quiet`.

Bewegung respektiert `prefers-reduced-motion`: Framer Motion global über
`MotionConfig reducedMotion="user"`, der Gauge über `useReducedMotion()`, die
CSS-Übergänge über eine Media-Query.

## Hinweis für Editor-Terminals

Editoren, die selbst auf Electron laufen (VS Code, Antigravity), setzen in ihren
Terminals `ELECTRON_RUN_AS_NODE=1`. Erbt die App diese Variable, startet die Binary als
reines Node und der Main-Prozess stirbt sofort. Alle Startskripte gehen deshalb über
`scripts/electron-env.mjs`, das die Variable entfernt — Electron bitte nicht direkt
über `npx electron .` starten.
