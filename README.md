# HardwareFlow

Dark-Mode System-Monitor als Desktop-App: CPU, RAM, GPU und Massenspeicher auf einen
Blick, plus ein gewichteter HardwareFlow Score (0–100) als Gauge.

Electron · React 19 · TypeScript · Tailwind CSS 4 · Recharts · Framer Motion · Lucide
Icons · `systeminformation`

## Befehle

```bash
npm install

npm run dev            # Desktop-App mit echten Messwerten + Vite-HMR
npm run dev:web        # nur Renderer im Browser, Werte simuliert
npm start              # Desktop-App aus dem Production-Build
npm run probe          # einmal Hardware auslesen und als JSON ausgeben
npm run selftest:app   # App starten, gerenderten Text und Konsole prüfen, beenden
npm run check          # lint + build + smoke
npm run icon           # App-Icon aus dem SVG in make-icon.mjs neu rendern
npm run package        # Installer nach release/ bauen
```

Zwei Betriebsarten, im Header sichtbar beschriftet:

| Start | Quelle | Badge |
| --- | --- | --- |
| `npm run dev`, `npm start` | Messwerte aus dem Main-Prozess | **Live-Messung** |
| `npm run dev:web` (Browser) | Simulator | **Simulation** |

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `electron/main.ts` | Fenster, IPC, Lebenszyklus; Renderer ohne Node-Zugriff |
| `electron/preload.ts` | Context-Bridge: `getReading`, `setPaused`, `onReading`, `onProbeError` |
| `electron/hardwareProbe.ts` | Der eigentliche Hardware-Zugriff über `systeminformation` |
| `electron/windowState.ts` | Fenstergeometrie merken, gegen die realen Displays geprüft |
| `electron/probeReport.ts` | Diagnose-CLI hinter `npm run probe` |
| `src/types/hardware.ts` | Domänenmodell für alles, was das Dashboard anzeigt |
| `src/services/hardwareService.ts` | Facade: Quellenwahl, Verlaufsfenster, Score |
| `src/services/mockHardware.ts` | Simulator für den Browser-Modus |
| `src/hooks/useHardwareMonitor.ts` | Abo auf den Snapshot-Stream inkl. Pause |
| `src/lib/` | Formatierung, Status-Palette und Schwellwerte |
| `src/components/*Card.tsx` | Die Module: CPU, RAM, GPU, Storage, Score |
| `src/components/ui/` | Panel-Shell, Meter, Stat, animierte Zahl, `n/v`-Marker |
| `scripts/make-icon.mjs` | Rendert das App-Icon über Electron aus einem Inline-SVG |

Die UI kennt nur `subscribeHardware()` aus der Facade. Welche Quelle dahinter liegt,
entscheidet allein `window.hardwareflow !== undefined`; die Komponenten lesen
`snapshot.source` nur, um ihn zu beschriften.

## Gestaffeltes Polling

Ein vollständiger `systeminformation`-Durchlauf kostet unter Windows rund 4–7 s, weil
die meisten Aufrufe WMI bzw. PowerShell starten. Deshalb pollt der Probe in Stufen,
jede mit einem Overlap-Schutz, damit ein hängender WMI-Aufruf sich nicht selbst
aufstaut:

| Stufe | Intervall | Aufrufe |
| --- | --- | --- |
| fast | 1 s | `currentLoad`, `mem`, `cpuCurrentSpeed`, `time` |
| medium | 2 s | `graphics`, `cpuTemperature` |
| slow | 15 s | `fsSize`, `blockDevices`, `processes` |
| static | 5 min | `osInfo`, `cpu`, `memLayout`, `diskLayout` |

Gesendet wird auf jedem fast-Tick, zusammengesetzt aus dem jeweils letzten Stand jeder
Stufe.

**Pause hält die Messung an, nicht nur die Anzeige.** Der Pause-Knopf schickt
`setPaused` in den Main-Prozess und stoppt dort die Timer — sonst liefe WMI weiter,
während das Dashboard eingefroren dasteht. Das Verlaufsfenster wird beim Fortsetzen
wieder hereingereicht, damit die Kurve nicht bei einer leeren Achse neu beginnt.

## Netzlaufwerke

Windows blendet gemappte Freigaben in `fsSize()` neben echten Volumes ein. Sie stehen
darum unter „Netzlaufwerke" getrennt von den lokalen Volumes, zählen nicht in die
Kapazitäts-Summe und nicht in den Score: der Füllstand eines Fileservers sagt nichts
über diese Maschine und lässt sich lokal auch nicht ändern. Erkannt werden sie über
`blockDevices().physical === 'Network'`.

## Was Windows nicht herausgibt

Jedes gemessene Feld im Modell ist `| null`, und die UI zeigt dafür ein `n/v` mit
Erklärung im Tooltip — kein Platzhalter-Null. Auf einem typischen Windows-Notebook
fehlen (per `npm run probe` nachprüfbar):

- **CPU-Temperatur** — ohne Hilfstreiber (LibreHardwareMonitor o. ä.) meldet Windows
  keinen Wert.
- **Datei-Cache im RAM** — `buffcache` ist unter Windows 0; die Cache-Fläche im
  Speicherbalken entfällt dann statt als Null-Segment zu erscheinen.
- **Disk-I/O pro Volume** — `disksIO` und `fsStats` liefern unter Windows `null`.
  Deshalb zeigt die Storage-Karte keine Durchsatzwerte, statt sie zu erfinden.
- **Nenn-Turbotakt** — manche CPUs (Intel Core Ultra) melden ihren Basistakt als
  `speedMax`. Der Probe hebt den Wert deshalb auf den höchsten je beobachteten Takt,
  gekennzeichnet als „beobachtet". Der Wert wird über die Laufzeit genauer.
- **GPU-Auslastung im Leerlauf** — eine Optimus-dGPU meldet `utilization.gpu` als
  N/A, solange sie schläft, während VRAM, Temperatur und Takt weiterhin kommen.

Was Windows entgegen der ersten Annahme **doch** herausgibt, und was die App
inzwischen nutzt: den Volume-Namen (`blockDevices().label`, z. B. `OS`) und die
Zuordnung Volume → Datenträger über `blockDevices().device`
(`\\.\PHYSICALDRIVE0`), die sich mit `diskLayout()` verbinden lässt. Daher trägt
jedes lokale Volume sein echtes NVMe/SSD/HDD-Badge.

## Der Score

`computePerformanceScore` kombiniert vier Kapazitäts-Terme mit einem Reserve-Term:

| Baustein | Gewicht | 100 Punkte bei |
| --- | --- | --- |
| CPU-Leistung | 28 % | 24 Threads (62 P.) und 5 GHz Spitzentakt (38 P.) |
| Arbeitsspeicher | 20 % | 48 GB installiert, minus Swap-Druck |
| Grafik | 15 % | 12 GB VRAM; iGPU auf 34 gedeckelt |
| Speicher-Reserve | 12 % | 50 % frei über alle **lokalen** Volumes, Bonus für NVMe |
| Aktuelle Reserve | 25 % | `100 −` gewichtete Live-Last (CPU 50 / RAM 30 / GPU 20) |

Kapazität dominiert mit 75 %, damit der Score eine Eigenschaft der Maschine bleibt und
nicht bei jedem Tick das Band wechselt. Die Referenzpunkte liegen auf dem oberen Ende
aktueller Consumer-Hardware, nicht am Workstation-Maximum — ein starkes Notebook soll
hoch landen, nicht mittelmäßig.

Nicht auslesbare Werte fallen auf neutrale 50 zurück, nicht auf 0, und sagen das in
ihrer Detailzeile: ein stummer Sensor ist keine langsame Maschine. Fehlt die
GPU-Auslastung, tragen CPU und RAM den Reserve-Term allein.

## Farben und Hervorhebung

Die vier Subsystem-Farben (Blau CPU, Aqua RAM, Violett GPU, Gelb Storage) sind
validierte Dark-Mode-Slots und gegen die Kartenfläche `#14161c` geprüft
(Helligkeitsband, Chroma-Untergrenze, Farbfehlsichtigkeits-Abstand, 3:1-Kontrast). Die
Status-Palette (`lib/status.ts`) ist davon getrennt und wird nie als Serienfarbe
verwendet — eine Farbe bedeutet auf diesem Dashboard immer genau eine Sache. Werte und
Labels tragen Ink-Tokens, nie die Datenfarbe.

Die vier Hardware-Karten tragen einen Neon-Akzent: farbiger Rahmen, Außen-Bloom,
leuchtender Icon-Chip und ein sehr schwacher Eck-Verlauf hinter dem Inhalt. Alle
Abstufungen mischt `index.css` aus der einen Custom Property `--hf-accent`, die
`Card.tsx` setzt — die Farbe eines Moduls steht damit an genau einer Stelle. Die
Score-Karte bekommt `emphasis="quiet"`: mit fünf Glows wäre nichts mehr hervorgehoben.

Bewegung respektiert `prefers-reduced-motion`: Framer Motion global über
`MotionConfig reducedMotion="user"`, der Gauge über `useReducedMotion()`, die
CSS-Übergänge über eine Media-Query.

## Hinweis für Editor-Terminals

Editoren, die selbst auf Electron laufen (VS Code, Antigravity), setzen in ihren
Terminals `ELECTRON_RUN_AS_NODE=1`. Erbt die App diese Variable, startet die Binary als
reines Node und der Main-Prozess stirbt sofort. Alle Startskripte gehen deshalb über
`scripts/electron-env.mjs`, das die Variable entfernt — Electron bitte nicht direkt
über `npx electron .` starten.
