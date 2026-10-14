# Spec: Blur & Layer Studio

Stand: 14.10.2026

## Ziel und Überblick

Blur & Layer Studio ist eine lokale Web-App für Kunstprojekte: Sie zerlegt ein Bild automatisch oder per Pinsel in Ebenen und gibt jeder Ebene eigene Unschärfe, Farbe, Schwarz-Weiß und Schatten – in Echtzeit auf der GPU. Ästhetisches Ziel sind starke Unschärfe und Überschneidungen, bei denen gezielte Fokuspunkte (Augen, Gesichtsmitte, Brust, Hände) schärfer bleiben dürfen.

Diese Spec ist die Arbeitsgrundlage für Claude Code. Die Buchstaben (a) bis (j) verweisen auf die ursprünglichen Anforderungen.

**Begriffe**

- **Bild**: jedes geladene Foto oder Bild.
- **Original**: die unveränderte Bilddatei; wird nie überschrieben.
- **Layer**: Original + Maske + Effekt-Stack + Transform. Mehrere Layer können sich dasselbe Original teilen.
- **Maske**: Graustufen-Alpha (0 = unsichtbar, 1 = voll sichtbar), immer weich speicherbar.
- **Fokuskarte**: Graustufenkarte pro Layer (1 = scharf, 0 = maximale Unschärfe). Steuert ortsabhängige Unschärfe.
- **Gruppe**: Verbund von Layern, z. B. das Ergebnis einer automatischen Aufteilung.
- **Effekt**: austauschbares GPU-Modul mit Parametern (Blur, Overlay, Schwarz-Weiß, …).

**Nicht-Ziele**: kein vollwertiger Photoshop-Ersatz, keine Cloud, kein Konto, keine Videobearbeitung in v1.

## Technologie-Stack

Alles läuft lokal im Browser: TypeScript-Frontend, Rendering mit WebGPU, ML-Modelle per ONNX Runtime Web in einem Web Worker. Entwicklung auf macOS; Zielbrowser Chrome (WebGPU stabil), Safari vorerst kein Ziel.

| Bereich | Wahl | Begründung |
| --- | --- | --- |
| Build | Vite + TypeScript (strict) | schnelle Hot-Reloads, auch für Shader |
| UI | React + Zustand + Radix-Primitives, eigenes CSS mit Design-Tokens | volle Kontrolle über den Designer-Look |
| Rendering | WebGPU + WGSL (Compute- und Render-Pässe), Fallback WebGL2 + GLSL nur für Kerneffekte | GPU-Echtzeit, Compute für große Blur-Radien |
| ML-Inferenz | onnxruntime-web mit WebGPU-Execution-Provider, im Worker | UI blockiert nicht |
| Vordergrund | BiRefNet (lite) oder vergleichbares Salient-Object-Modell | saubere Haarkanten |
| Personen-Details | MediaPipe Face Landmarker + Pose Landmarker | Fokuspunkte: Augen, Gesicht, Brust, Hände |
| Interaktive Auswahl | Segment Anything (leichte Variante, z. B. EfficientSAM / SAM 2 tiny) | Klick-Segmentierung, Objekt-Instanzen |
| Tiefe | Depth Anything V2 Small | relative Tiefenkarte für Ebenen (d) |
| Speicherung | IndexedDB / OPFS + Projektdatei als .zip | Originale und Masken bleiben erhalten |
| Tests | Vitest + Playwright (Golden-Image-Vergleiche) | Shader-Regressionen erkennen |

Modelle werden beim ersten Gebrauch geladen und lokal gecacht. **Lizenzen**: Es werden sowohl kommerziell nutzbare Modelle (Code *und* Gewichte z. B. unter MIT oder Apache-2.0) als auch nicht-kommerzielle Modelle eingebaut. Welche verwendet werden, entscheidet der Lizenzmodus (siehe unten). Claude Code prüft jede Lizenz vor dem Einbau an der Quelle und dokumentiert sie in `MODELS.md`.

### Lizenzmodus

Ein globaler Schalter legt fest, ob nur kommerziell nutzbare Modelle und Bibliotheken laufen oder alle. Standard ist „Kommerziell“, weil Bilder verkauft und ausgestellt werden.

| Aufgabe | Kommerziell nutzbar (nach bisherigem Stand) | Nur nicht-kommerziell (nach bisherigem Stand) |
| --- | --- | --- |
| Vordergrund | BiRefNet | BRIA RMBG-1.4 / RMBG-2.0 |
| Tiefe | Depth Anything V2 Small | Depth Anything V2 Base / Large |
| Interaktive Auswahl, Objekte | SAM / SAM 2, EfficientSAM | – |
| Fokuspunkte | MediaPipe Face/Pose Landmarker | – |
| Inpainting | LaMa | – |

- **Modell-Register**: Jedes Modell und jede ML-Bibliothek steht in `models/registry.json` mit `id`, Aufgabe, Laufort (Browser/Dienst), `license` (SPDX-Kennung oder Name), `commercialUse: true/false`, Quelle und Prüfdatum. Neue Modelle werden nur über das Register eingebunden.
- **Umschalter** in den Einstellungen und als Kurzanzeige in der oberen Leiste: „Kommerziell“ (Standard) / „Alle Modelle (nicht-kommerziell)“. Das Umschalten auf „Alle“ zeigt einmalig einen Hinweis zu den Lizenzfolgen.
- **Modellwahl pro Aufgabe**: In jedem Aufteilen-Dialog eine Auswahl der verfügbaren Modelle mit Lizenz-Badge („kommerziell“ / „NC“). Im Modus „Kommerziell“ sind NC-Modelle ausgegraut und werden nicht geladen.
- **Herkunft**: Jede Maske, Tiefenkarte und Lochfüllung speichert, welches Modell sie erzeugt hat. Layer mit NC-Herkunft tragen ein kleines Badge in der Ebenenliste.
- **Export-Warnung**: Enthält ein Export Ergebnisse eines NC-Modells, warnt der Export-Dialog und listet die betroffenen Layer. Optional: „Mit kommerziellen Modellen neu berechnen“ ersetzt diese Masken automatisch.
- **Projektdatei**: speichert den Lizenzmodus und die Herkunft; beim Öffnen im Modus „Kommerziell“ bleiben vorhandene NC-Masken erhalten, werden aber markiert.
- **Python-Dienst**: lädt NC-Modelle nur, wenn die Web-App den Modus „Alle“ meldet; `/health` listet je Modell die Lizenz.

## Lokaler Python-Dienst

Ein Python-Dienst läuft neben der Web-App auf dem Mac und liefert bessere Masken, Tiefenkarten und Lochfüllung als die Browser-Modelle. Ist er nicht gestartet, arbeitet die App mit den Browser-Modellen weiter.

- **Stack**: Python 3.12, `uv`, FastAPI + Uvicorn, PyTorch mit MPS (Apple-GPU), Fallback CPU.
- **Nur lokal**: bindet an `127.0.0.1:8765`; CORS nur für die Origin der Web-App.
- **Modelle**: BiRefNet in voller Größe und höherer Auflösung, SAM 2 (große Variante), Depth Anything V2 Small mit höherer Eingangsauflösung, LaMa für Inpainting; im Lizenzmodus „Alle“ zusätzlich RMBG-2.0 und Depth Anything V2 Large. Download beim ersten Start mit Fortschrittsanzeige, Cache unter `~/.cache/blur-layer-studio/`.
- **Anbindung**: In der Web-App eine Schnittstelle `MlBackend` mit zwei Implementierungen (`BrowserBackend`, `ServiceBackend`). Einstellung „ML-Modus“: Auto / Browser / Dienst. Auto nutzt den Dienst, sobald `/health` antwortet.
- **Start**: `npm run dev` startet Web-App und Dienst gemeinsam; einzeln mit `uv run ml-service`.
- **Austausch**: Bilder und Masken als PNG (Masken 16 Bit) per multipart; lange Aufgaben liefern eine Job-ID mit Fortschritt.

| Endpunkt | Eingang | Ausgang | Phase |
| --- | --- | --- | --- |
| `GET /health` | – | Gerät, geladene Modelle, Version | 2 |
| `POST /segment/foreground` | Bild | weiche Vordergrundmaske | 2 |
| `POST /depth` | Bild | Tiefenkarte (16 Bit) | 3 |
| `POST /segment/points` | Bild, Positiv-/Negativ-Punkte | Maske | 5 |
| `POST /segment/objects` | Bild | Liste von Instanzmasken | 6 |
| `POST /inpaint` | Bild, Maske | aufgefülltes Bild | 6 |

## Datenmodell

Das Projekt ist ein Baum aus Layern und Gruppen; alle Bearbeitungen sind nicht-destruktiv und verweisen nur auf unveränderliche Originale.

```ts
type Project = {
  id: string; name: string;
  canvas: { width: number; height: number; background: string };
  originals: Record<string, OriginalRef>;   // Hash -> Blob, nie verändert
  root: Group;
  history: HistoryState;
};

type Node = Layer | Group;

type Layer = {
  kind: 'layer'; id: string; name: string;
  originalId: string;            // Bildquelle
  mask: MaskRef;                 // weiche Alpha-Maske (8 oder 16 Bit)
  maskSource: 'auto' | 'depth' | 'brush' | 'full';
  focusMap?: FocusMapSpec;       // Fokuspunkte + gemalte Bereiche
  depth?: number;                // mittlere Tiefe 0..1 (aus d)
  transform: { x: number; y: number; scale: number; rotation: number };
  opacity: number; blendMode: BlendMode;
  visible: boolean; locked: boolean;
  effects: EffectInstance[];     // Reihenfolge = Ausführungsreihenfolge
  shadow?: ShadowConfig;         // erzeugt Schatten-Layer direkt darunter (e)
};

type Group = {
  kind: 'group'; id: string; name: string;
  children: Node[];              // Index 0 = ganz hinten
  editMode: 'group' | 'individual';   // (h)
  effects: EffectInstance[];     // auf das Gruppen-Composite angewendet
  opacity: number; blendMode: BlendMode; visible: boolean;
  origin?: { kind: 'auto-fg-bg' | 'depth-split' | 'sam-objects'; sourceLayerId: string };
};

type EffectInstance = {
  instanceId: string; effectId: string; effectVersion: string;
  enabled: boolean; strength: number;            // 0..1, Mischung mit Eingang
  params: Record<string, number | string | boolean | [number, number, number]>;
  region: 'whole' | 'focus-weighted' | 'inverse-focus';
};
```

**Regeln**

- Originale werden beim Import gehasht und unverändert gespeichert (g). Masken, Fokuskarten und Parameter sind die einzigen veränderlichen Daten.
- Jede Maskenänderung erzeugt eine neue Maskenversion; alte Versionen bleiben bis zum Aufräumen in der History.
- Gruppen im Modus `group`: ein geänderter Parameter wird auf alle Kinder geschrieben, die diesen Effekt haben. Modus `individual`: jedes Kind wird einzeln bearbeitet. Der Gruppen-Effekt-Stack wirkt zusätzlich auf das zusammengesetzte Ergebnis.
- Ein Kind kann einen Parameter „entkoppeln“ (Schloss-Symbol); dann überschreibt die Gruppenbearbeitung ihn nicht.

## Render-Pipeline auf der GPU

Jeder Layer wird unabhängig auf der GPU berechnet und gecacht; nur Layer, deren Parameter sich ändern, werden neu gerendert.

```
Original ──► Maske ──────────► Effekt-Stack ──────────► Compositor ──────► Ausgabe
(unverändert, (Kantenhärte,     (Blur, Overlay, S/W,     (hinten → vorn,    (Vorschau oder
 linear)       Versatz)          nach Fokuskarte)         mit Schatten)      Export in Kacheln)
                 ▲                  ▲          ▲
                 │ Masken           │ Fokus,   │ Shader
                 │                  │ Tiefe    │
           ┌─────┴──────────────────┴──┐   ┌───┴────────────┐
           │ ML-Worker (ONNX)          │   │ Effekt-Plugins │
           │ Segmentierung, Tiefe,     │   │ Ordner effects/│
           │ Landmarker                │   └────────────────┘
           └───────────────────────────┘
```

Die ML-Modelle liefern Masken, Fokus- und Tiefenkarten einmalig; danach läuft alles Interaktive rein im Shader.

- **Texturpool**: Zwischenergebnisse (Blur-Pyramiden, maskierte Layer) werden in einem Pool wiederverwendet; Caches pro Layer mit Hash aus Eingang + Parametern.
- **Zwei Auflösungen**: Vorschau in Bildschirmauflösung (max. 2048 px lange Kante), Export in voller Auflösung, gekachelt mit Überlappung = maximaler Effektradius.
- **Gruppen**: Eine Gruppe rendert ihre Kinder in eine eigene Textur, wendet ihren Effekt-Stack an und mischt das Ergebnis in den Eltern-Compositor.
- **Mischmodi** im Compositor: Normal, Multiplizieren, Negativ multiplizieren, Ineinanderkopieren, Weiches Licht, Aufhellen, Abdunkeln, Differenz – wichtig für Überschneidungen.
- **WebGL2-Fallback**: nur Gauß-Blur, Overlay, Schwarz-Weiß und Schatten; andere Effekte werden mit Hinweis deaktiviert.

## Segmentierung und Tiefenerkennung (b, d, h)

Ein Klick auf „Aufteilen“ macht aus einem Layer eine Gruppe; der Ursprungs-Layer bleibt ausgeblendet in der Gruppe erhalten und kann jederzeit wiederhergestellt werden.

**Modus 1 – Vordergrund/Hintergrund (b)**

1. Salient-Object-Modell erzeugt eine weiche Vordergrundmaske.
2. Ergebnis: Gruppe „Motiv“ mit zwei Layern, *Vordergrund* (Maske) und *Hintergrund* (invertierte Maske).
3. Der Hintergrund-Layer bekommt eine **Lochfüllung**: Bereiche unter dem Vordergrund werden per normalisierter Faltung (masked blur) aus der Umgebung aufgefüllt, damit beim Weichzeichnen keine Vordergrundfarben in den Hintergrund bluten und kein Halo entsteht. Später optional: Inpainting-Modell (z. B. LaMa).
4. Für Personen laufen zusätzlich Face- und Pose-Landmarker. Sie liefern Fokuspunkte (Augen, Gesichtsmitte, Brust, Hände) für die Fokuskarte.

**Modus 2 – Tiefenebenen (d)**

1. Depth Anything erzeugt eine relative Tiefenkarte (0 = nah, 1 = fern).
2. Aufteilung in N Ebenen (N = 2–8, Regler). Grenzen per Quantile oder k-Means auf den Tiefenwerten; der Nutzer kann die Grenzen in einem Histogramm verschieben.
3. Optional „objekttreu“: SAM-Instanzmasken werden mit der Tiefe kombiniert, sodass ein Objekt nicht quer durch zwei Ebenen geschnitten wird (jedes Objekt landet ganz in der Ebene seiner mittleren Tiefe).
4. Übergänge zwischen Ebenen sind weich überlappend (Regler „Ebenen-Überlappung“, 0–64 px), damit keine Lücken entstehen.
5. Ergebnis: Gruppe „Tiefenebenen“, jeder Layer mit `depth`-Wert. Ein **Tiefen-Preset** setzt Startwerte: Unschärfe und Dunst (Entsättigung, Aufhellung, Farbstich) steigen mit der Entfernung. Alles danach frei einstellbar.

**Modus 3 – Objekte (SAM, spätere Phase)**

Automatische Instanzmasken; jedes größere Objekt wird ein eigener Layer in der Gruppe „Objekte“.

**Gruppen (h)**

- Gruppen erscheinen in der Ebenenliste aufklappbar mit Miniatur der zusammengesetzten Gruppe.
- Umschalter „Gruppe / Einzeln“ (siehe Datenmodell). Kinder lassen sich aus der Gruppe ziehen, neu sortieren oder in eine neue Gruppe verschachteln.
- Ebenen-Ansichten zum Prüfen: Maske, Tiefenkarte, Fokuskarte (je als Overlay einblendbar).

**Laufzeit**: Inferenz im Worker auf einer Kopie mit max. 1024 px langer Kante; die Masken werden anschließend kantenbewusst (Guided Filter) auf volle Auflösung hochskaliert. Ergebnisse werden pro Original gecacht.

## Effekte (a, b, c, e)

Alle Effekte sind Plugins (siehe nächster Abschnitt); die folgenden werden mitgeliefert. Jeder Regler hat Zahleneingabe, Doppelklick = Standardwert, Shift-Ziehen = fein.

### Unschärfe (a, b)

| Parameter | Bereich | Wirkung |
| --- | --- | --- |
| Stärke | 0–300 px Radius (logarithmischer Regler) | Grundunschärfe des Layers bzw. ganzen Bildes |
| Art | Gauß, Linse (Bokeh, Scheibe/Hexagon), Bewegung, Zoom | Charakter der Unschärfe |
| Winkel | 0–360° | nur Bewegung |
| Fokus-Unschärfe | 0–100 % | Unschärfe an Fokuspunkten relativ zur Grundunschärfe (0 % = scharf) |
| Fokus-Weichheit | 0–100 % | wie weich die Fokuspunkte in die volle Unschärfe übergehen |
| Kantenbehandlung | Spiegeln / Klemmen / Transparent | Verhalten am Bildrand |

- **Ganzes Bild (a)**: Effekt auf die Wurzelgruppe oder einen ungeteilten Layer.
- **Vorder-/Hintergrund (b)**: je ein eigener Blur-Effekt auf den beiden Layern, Standard Vordergrund 10 px, Hintergrund 60 px.
- **Fokuskarte**: Radiale Gradienten um die Landmarker-Punkte (Augen, Gesichtsmitte, Brust, Hände), einzeln per Checkbox und mit eigenem Radius; zusätzlich mit dem Pinsel bemalbar. Pro Pixel gilt: Radius = lerp(Fokus-Unschärfe, Stärke, 1 − Fokuswert).
- **Umsetzung**: Für große Radien eine Blur-Pyramide (Dual-Kawase oder Mip-Kette mit Gauß), variable Unschärfe per Interpolation zwischen Pyramidenstufen. Linsenunschärfe als Scatter-/Gather-Compute-Shader. Alles mit vormultipliziertem Alpha, damit Ränder nicht dunkel werden.

### Kantenübergang (b)

| Parameter | Bereich | Wirkung |
| --- | --- | --- |
| Kantenhärte | hart 0 – sehr weich 100 | 0 = binäre Maske mit Antialiasing; 100 = Maske mit bis zu 150 px Weichzeichnung |
| Kantenversatz | −30 bis +30 px | Maske schrumpfen oder erweitern, bevor sie weich wird |
| Verlaufskurve | linear / weich (smoothstep) / steil | Form des Übergangs |

### Farb-Overlay und Schwarz-Weiß (c)

Zwei getrennte Effekte, beliebig kombinierbar und auf Vorder- oder Hintergrund anwendbar.

**Farb-Overlay**: Farbe (Farbwähler + Pipette), Deckkraft 0–100 % (sehr transparent bis sehr stark), Mischmodus (Normal, Multiplizieren, Negativ multiplizieren, Ineinanderkopieren, Weiches Licht, Farbe, Farbton), Kontrast −100 bis +100, optional Duotone (zwei Farben auf Schatten und Lichter).

**Schwarz-Weiß**: Stärke 0–100 % (Mischung mit Farbe), Kanalmischer R/G/B (Presets: neutral, Rotfilter, Gelbfilter, Grünfilter, Infrarot-Look), Kontrast −100 bis +100 (S-Kurve), Helligkeit, Schwarz- und Weißpunkt, optional Korn.

### Schatten (e)

Ein Schatten ist ein automatisch erzeugter, verknüpfter Layer direkt unter seinem Layer. Er leitet sich aus dessen Maske ab und aktualisiert sich bei Maskenänderungen.

| Parameter | Bereich | Wirkung |
| --- | --- | --- |
| Richtung | 0–360°, Schnellwahl links/rechts/oben/unten | Versatzrichtung |
| Entfernung | 0–500 px | Versatz |
| Weichheit | 0–200 px | Unschärfe des Schattens |
| Randausblendung | 0–100 % | wie stark die Ränder zusätzlich ausfaden (Maske schrumpfen + weicher Abfall) |
| Verlaufsstärke | 0–100 % | Deckkraft nimmt entlang der Richtung mit wachsender Entfernung vom Objekt ab |
| Deckkraft | 0–100 % | Gesamtstärke |
| Farbe, Mischmodus | frei; Standard Schwarz, Multiplizieren | Schattenton |
| Skalierung, Perspektive | 50–150 %, Neigung ±60° | optional: Schatten als „Bodenschatten“ |

Der Schatten-Layer hat selbst einen Effekt-Stack, kann also z. B. eingefärbt werden.

## Effekt-Plugin-System (i)

Jeder Effekt – auch die mitgelieferten – ist ein Ordner unter `effects/`. Ein neuer Effekt braucht keine Änderung am Kern: Ordner anlegen, die App lädt ihn, die UI erzeugt die Regler aus dem Manifest.

```
effects/
  gaussian-blur/
    manifest.json
    effect.wgsl        # Pflicht
    effect.glsl        # optional, WebGL2-Fallback
    effect.ts          # optional, für mehrstufige Pässe
    preview.jpg        # Miniatur im Effekt-Browser
```

```json
{
  "id": "echo-offset",
  "name": "Echo-Versatz",
  "version": "1.0.0",
  "category": "Überschneidung",
  "inputs": ["source", "mask", "focus", "depth"],
  "passes": 1,
  "params": [
    { "key": "copies", "label": "Kopien", "type": "int", "min": 1, "max": 12, "default": 3 },
    { "key": "distance", "label": "Abstand", "type": "float", "min": 0, "max": 400, "default": 40, "unit": "px", "scale": "log" },
    { "key": "angle", "label": "Richtung", "type": "angle", "default": 0 },
    { "key": "tint", "label": "Farbe", "type": "color", "default": [1, 1, 1] }
  ]
}
```

**Vertrag für Shader**

- Eingänge: Quelltextur (vormultipliziertes RGBA, linearer Farbraum), Maske, Fokuskarte, Tiefenkarte, Uniform-Block mit allen Parametern plus Auflösung und Skalierungsfaktor (Vorschau vs. Export).
- Ausgang: eine RGBA-Textur gleicher Größe. Der Kern mischt sie anschließend per `strength` und `region` mit dem Eingang.
- Parameter in Pixeln werden vom Kern mit dem Skalierungsfaktor umgerechnet, damit Vorschau und Export gleich aussehen.
- Parametertypen: `int`, `float`, `angle`, `bool`, `color`, `enum`, `point` (Position auf der Leinwand).

**Für Claude Code**: Lege `effects/README.md` mit einer Anleitung und einer Vorlage `effects/_template/` an. Damit kann der Nutzer später sagen „Erzeuge einen Effekt, der …“, und Claude Code legt nur einen neuen Ordner an. Ein Validator prüft Manifest und Shader-Kompilierung beim Laden und zeigt Fehler im UI, statt abzustürzen. Im Entwicklungsmodus laden Effekte bei Änderungen neu.

**Mitgelieferte Effekte v1**: Gauß-Blur, Linsenunschärfe, Bewegungsunschärfe, Zoom-Unschärfe, Farb-Overlay, Schwarz-Weiß, Schatten.

**Kandidaten für später** (passend zu Unschärfe und Überschneidungen): Echo-Versatz (versetzte Kopien), Doppelbelichtung, Chromatische Aberration, Film-Korn, Lichtschleier (Halation), Verschmieren entlang Konturen, Pixelsortierung, Glas-/Riffelglas-Verzerrung.

## Externe Bild-Layer und Masken-Pinsel (f, g)

### Weitere Bilder als Layer (f)

- Import per Drag & Drop oder Dateidialog (JPEG, PNG, WebP, HEIC falls der Browser es dekodiert). Das Bild wird ein normaler Layer mit allen Funktionen: Effekte, Schatten, Aufteilen in Ebenen.
- Transform: verschieben, skalieren, drehen, spiegeln; Optionen „Leinwand füllen“ und „Einpassen“.
- Reihenfolge: Buttons und Tastenkürzel „eine Ebene nach vorn/hinten“ (⌘] / ⌘[) sowie „ganz nach vorn/hinten“ (⇧⌘] / ⇧⌘[); Ziehen in der Ebenenliste. Ein Layer kann auch zwischen Layer einer Gruppe geschoben werden.
- Typischer Fall: Landschaft oder abstraktes Bild als neuer Hintergrund hinter einem freigestellten Vordergrund.

### Masken-Pinsel (g)

| Einstellung | Bereich |
| --- | --- |
| Größe | 1–800 px, Tastatur [ und ] |
| Kantenweichheit | 0–100 % |
| Fluss | 1–100 % (Aufbau bei mehrfachem Malen) |
| Modus | Hinzufügen / Entfernen (Alt-Taste schaltet um) |
| Glättung | 0–100 % gegen zittrige Striche |
| Stift | Druckempfindlichkeit über Pointer Events (Apple Pencil, Grafiktablett) |

- **Darstellung**: Die Markierung erscheint als Farbschleier mit ca. 40 % Deckkraft (Farbe wählbar) und weichem Rand, sodass der Original-Layer sichtbar bleibt.
- **Hilfen**: „Smarte Auswahl“ – Klick auf ein Objekt (SAM), danach mit dem Pinsel verfeinern; Positiv-/Negativ-Klicks.
- **Aktionen nach dem Markieren**
  - *Hervorheben*: Der markierte Bereich wird als neuer Layer direkt über dem Quell-Layer eingefügt. Der Quell-Layer bleibt vollständig; optional wird die Stelle im Quell-Layer per Lochfüllung aufgefüllt.
  - *Extrahieren*: Der Layer behält nur den markierten Bereich, der Rest wird ausgeblendet (Maske, nicht gelöscht).
- **Nicht-destruktiv**: Jede Aktion ist ein History-Eintrag. Originale bleiben immer erhalten; „Layer auf Original zurücksetzen“ stellt Maske und Effekte des Ausgangszustands wieder her.
- Der Pinsel funktioniert auch auf der Fokuskarte (schärfer/unschärfer malen).

## UI und Echtzeitvorschau (j)

Die UI ist eine ruhige, galerieartige Arbeitsfläche: Das Bild dominiert, Werkzeuge treten zurück. Jede Regleränderung ist in der Vorschau ohne spürbare Verzögerung sichtbar.

**Layout**

- **Oben**: Projektname, Rückgängig/Wiederholen, Vorher/Nachher (Split-Schieber auf der Leinwand), Zoom, Theme-Umschalter, Export.
- **Links**: schmale Werkzeugleiste – Verschieben, Pinsel, Smarte Auswahl, Fokuspunkt, Pipette, Hand/Zoom.
- **Mitte**: Leinwand mit neutralem Hintergrund (Dark: sehr dunkelgrau, Light: warmes Hellgrau), Ansichtsmodi: Ergebnis, Maske, Fokuskarte, Tiefenkarte.
- **Rechts**: Ebenenliste (Gruppen aufklappbar, Miniaturen, Sichtbarkeit, Deckkraft) und darunter der Inspektor des gewählten Layers: Effekt-Stack als einklappbare Karten, per Ziehen sortierbar, „+ Effekt“ öffnet einen Effekt-Browser mit Vorschaubildern.
- **Unten** (einblendbar): Hinweise und Fortschritt der ML-Modelle.

**Design**

- Design-Tokens als CSS-Variablen für Farben, Abstände, Radien, Schatten; Dark und Light vollständig, Standard = Systemeinstellung, manuell umschaltbar, Auswahl wird gespeichert.
- Eine Akzentfarbe, sonst neutrale Grautöne; Schrift z. B. Inter oder Geist, Zahlen tabellarisch.
- Eigene Regler: dünne Spur, Wert als editierbare Zahl, Füllung ab Standardwert, Skalen linear oder logarithmisch.
- Mikroanimationen ≤ 150 ms; `prefers-reduced-motion` respektieren.
- Mindestbreite 1280 px; Tablet ist kein Ziel für v1.

**Performance-Ziele**

| Situation | Ziel |
| --- | --- |
| Regler ziehen, Vorschau bis 2048 px lange Kante | ≥ 30 fps, Ziel 60 fps |
| Während des Ziehens bei sehr großen Radien | Vorschau automatisch auf halbe Auflösung, danach scharf nachrendern |
| Vordergrund-Segmentierung 1024 px | < 3 s auf aktuellem Mac, mit Fortschrittsanzeige |
| Export 24 MP mit 10 Layern | < 10 s, in Kacheln gerendert |

**Tastenkürzel**: ⌘Z / ⇧⌘Z, B Pinsel, V Verschieben, \ Vorher/Nachher, Leertaste Hand, ⌘0 Einpassen, ⌘E Export, Ziffern 1–4 für Ansichtsmodi.

## Speichern, Undo, Export

Projekte speichern sich automatisch lokal und lassen sich als eine Datei sichern; jede Bearbeitung ist rückgängig machbar.

- **Autosave** in IndexedDB/OPFS nach jeder Änderung (entprellt, 1 s). Projektübersicht beim Start mit Miniaturen.
- **Projektdatei** `.blurstudio` (= ZIP): `project.json` (Baum + Parameter), `originals/` (unveränderte Dateien), `masks/` (16-Bit-PNG), `focus/`, `depth/`, `cache/` (optional, verwerfbar).
- **Undo/Redo** über Command-Pattern; Reglerbewegungen werden zu einem Eintrag zusammengefasst. Maskenänderungen speichern nur geänderte Kacheln (256 × 256), damit die History klein bleibt. Mindestens 200 Schritte; eine History-Liste erlaubt Sprünge zu früheren Zuständen.
- **Export**: PNG, JPEG (Qualität), WebP; Größe 25–100 % oder feste Kantenlänge; Farbraum sRGB; Bildgröße bis 24 MP. Optional: einzelne Layer als PNG mit Transparenz, Tiefenkarte und Masken als PNG.
- **PSD-Export** (z. B. mit der Bibliothek ag-psd): jeder Layer als Ebene mit angewendeten Effekten, Gruppen als PSD-Gruppen, Mischmodi und Deckkraft übernommen, Masken als Ebenenmasken; optional die unbearbeiteten Originale als ausgeblendete Ebenen. Schatten-Layer werden eigene Ebenen.
- **Parallax-Vorschau**: Ansichtsmodus, in dem sich die Layer je nach Tiefe leicht mit Maus oder Trackpad verschieben. Regler für Stärke (0–100 %) und Achse (horizontal, vertikal, beide); Lochfüllung verhindert sichtbare Lücken. Reine Vorschau, verändert das Projekt nicht.

## Phasenplan mit Abnahmekriterien

Sieben Phasen (0–6); jede endet mit einer lauffähigen App. Das Plugin-System kommt bewusst in Phase 1, damit schon der erste Blur ein Plugin ist.

### Phase 0 – Gerüst

- [x] Vite + React + TS, WebGPU-Initialisierung mit verständlicher Meldung bzw. WebGL2-Fallback (nur Meldung, siehe DECISIONS.md)
- [x] Bild laden, Leinwand mit Zoom/Pan, Export als PNG
- [x] Design-Tokens, Dark/Light-Umschalter, Grundlayout mit leeren Panels
- [x] `CLAUDE.md` mit Architektur, Konventionen und Befehlen

### Phase 1 – Ganzes Bild (a, c, i)

- [x] Plugin-Lader mit Manifest-Validator und automatischer Regler-UI
- [x] Effekte Gauß-Blur, Farb-Overlay, Schwarz-Weiß als Plugins; Effekt-Stack sortierbar
- [x] Echtzeitvorschau ≥ 30 fps bei 2048 px; Vorher/Nachher
- [x] Undo/Redo, Autosave, Projektdatei speichern/öffnen
- [x] Abnahme: Ein vom Nutzer neu angelegter Effekt-Ordner erscheint ohne Codeänderung im Effekt-Browser

### Phase 2 – Vordergrund, Fokus, Schatten (b, e)

- [x] Python-Dienst mit `/health` und `/segment/foreground`; `MlBackend` mit Browser- und Dienst-Implementierung, Umschalter Auto / Browser / Dienst
- [x] Modell-Register, Lizenzmodus-Umschalter, Modellwahl pro Aufgabe, Herkunft und Export-Warnung
- [x] Vordergrund/Hintergrund-Aufteilung mit Lochfüllung, als Gruppe (BiRefNet und RMBG-2.0 wählbar) (Browser: BiRefNet lite 512 / RMBG-1.4; Dienst: BiRefNet / RMBG-2.0, siehe DECISIONS.md)
- [x] Kantenhärte-Regler von hart bis sehr weich, Kantenversatz
- [x] Fokuskarte aus Face/Pose-Landmarkern (Augen, Gesichtsmitte, Brust, Hände), Fokus-Unschärfe-Regler
- [x] Linsen-, Bewegungs- und Zoom-Unschärfe
- [x] Schatten-Layer mit allen Parametern aus Abschnitt Effekte
- [x] Abnahme: Portrait mit scharfen Augen, weich verlaufender Gesichtsunschärfe, stark unscharfem Hintergrund und Schatten nach rechts unten in unter 1 Minute einstellbar; kein sichtbarer Halo an der Kante
- [x] Abnahme: Dienst gestoppt → App fällt ohne Fehler auf Browser-Modelle zurück
- [x] Abnahme: Im Modus „Kommerziell“ wird kein NC-Modell geladen (prüfbar im Netzwerk-Log und in `/health`); ein Export mit RMBG-Maske zeigt die Warnung

### Phase 3 – Tiefenebenen und Gruppen (d, h)

- [x] Tiefenkarte (Browser und Dienst-Endpunkt `/depth`), Aufteilung in 2–8 Ebenen mit Histogramm-Grenzen und Überlappung
- [x] Tiefen-Preset (Unschärfe und Dunst nach Entfernung)
- [x] Gruppenmodus „Gruppe / Einzeln“, Parameter entkoppeln, verschachtelte Gruppen
- [x] Parallax-Vorschau
- [x] PSD-Export mit Ebenen, Gruppen, Masken und Mischmodi
- [x] Abnahme: Landschaftsfoto in 4 Ebenen zerlegt; Ändern der Gruppen-Unschärfe wirkt auf alle, ein entkoppelter Layer behält seinen Wert
- [x] Abnahme: exportierte PSD öffnet sich in einem Bildprogramm (z. B. Photopea) mit korrekter Ebenen- und Gruppenstruktur

### Phase 4 – Weitere Bilder (f)

- [ ] Import zusätzlicher Bilder als Layer, Transform, Ebenen-Reihenfolge per Tastenkürzel und Ziehen
- [ ] Abnahme: freigestellte Person vor neuem Landschaftshintergrund, Hintergrund schrittweise hinter/zwischen Tiefenebenen verschiebbar

### Phase 5 – Pinsel (g)

- [ ] Masken-Pinsel mit Weichheit, Fluss, Stiftdruck, halbtransparentem Schleier
- [ ] Smarte Auswahl (SAM) mit Positiv-/Negativ-Klicks
- [ ] Aktionen Hervorheben und Extrahieren; Pinsel auf Fokuskarte
- [ ] Abnahme: Hand markieren, als eigenen Layer hervorheben, schärfer stellen; danach per Undo vollständig zurück

### Phase 6 – Ausbau

- [ ] Effekte wie Echo-Versatz, Doppelbelichtung, Korn, Halation
- [ ] SAM-Objektaufteilung (Modus 3) über `/segment/objects`
- [ ] Inpainting-Lochfüllung mit LaMa über `/inpaint`

## Hinweise für Claude Code und offene Punkte

**Arbeitsweise**

1. Arbeite Phase für Phase; am Ende jeder Phase laufen Tests, Lint und ein Build, und die Abnahmekriterien werden einzeln geprüft.
2. Halte `CLAUDE.md` aktuell (Architektur, Ordnerstruktur, Befehle, bekannte Grenzen).
3. Rechne intern in linearem Farbraum mit vormultipliziertem Alpha; konvertiere nur bei Import/Export nach sRGB.
4. Für Shader Golden-Image-Tests mit kleinen Testbildern (Portrait, Landschaft, Objekt auf Tisch) und Toleranz.
5. Keine Netzwerkanfragen außer dem einmaligen Laden der Modelle; keine Telemetrie.
6. Bei unklaren Anforderungen: sinnvolle Standardwerte wählen, in `DECISIONS.md` notieren, weiterarbeiten.

**Vorgeschlagene Ordnerstruktur**

```
src/
  app/        # React-UI, Panels, Theme
  state/      # Zustand-Store, Commands, History
  render/     # WebGPU-Kern, Pässe, Compositor, Texturpool
  ml/         # Worker, Modell-Lader, Segmentierung, Tiefe, Landmarker
  effects/    # Plugin-Lader, Validator, Regler-Generator
  io/         # Import, Export, Projektdatei, PSD, Speicher
ml-service/   # Python-Dienst (FastAPI, uv-Projekt)
effects/      # Effekt-Plugins (je ein Ordner)
models/       # Modell-Manifest, MODELS.md
tests/
```

**Entscheidungen**

| Frage | Entscheidung | Folge für die Umsetzung |
| --- | --- | --- |
| Kommerzielle Nutzung | Ja, Bilder werden verkauft und ausgestellt | Standard-Lizenzmodus „Kommerziell“ |
| Nicht-kommerzielle Modelle | Ebenfalls einbauen, per Schalter wählbar | Lizenzmodus, Modell-Register, Herkunft und Export-Warnung (Phase 2) |
| Maximale Bildgröße | 24 MP reichen vorerst | Export und Performance-Ziele auf 24 MP ausgelegt |
| Browser | Chrome reicht vorerst | WebGPU ohne Safari-Sonderwege; WebGL2-Fallback bleibt minimal |
| Python-Dienst | Ja, einbauen | ab Phase 2, siehe Abschnitt Lokaler Python-Dienst |
| PSD-Export, Parallax-Vorschau | Ja, beides | beides in Phase 3 |
