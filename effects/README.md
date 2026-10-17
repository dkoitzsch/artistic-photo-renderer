# Effekt-Plugins

Jeder Effekt – auch die mitgelieferten – ist ein Ordner in `effects/`. Ein neuer Effekt braucht **keine Änderung am Kern**:
Ordner anlegen, die App lädt ihn (im Dev-Server sofort per Hot Reload), die Regler entstehen aus dem Manifest.
Ordner, die mit `_` beginnen (z. B. `_template/`), werden ignoriert.

```
effects/
  mein-effekt/
    manifest.json     # Pflicht: Beschreibung und Parameter
    effect.wgsl       # Pflicht, wenn der Effekt auf der GPU läuft ("webgpu")
    effect.ts         # optional: mehrstufige Pässe
    effect.worker.ts  # Pflicht bei Ausführung "browser-cpu" (Web Worker, ganze Ebene)
    effect.py         # Pflicht bei Ausführung "python" (lokaler Dienst)
    preview.jpg     # optional: Miniatur im Effekt-Browser (sonst Live-Vorschau am aktuellen Bild)
```

## Schnellstart

1. `effects/_template/` kopieren und umbenennen, z. B. nach `effects/echo-offset/`.
2. In `manifest.json` die `id` auf den Ordnernamen setzen (kebab-case), Name, Kategorie und Parameter anpassen.
3. In `effect.wgsl` die Funktion `fn effect(p: vec2i) -> vec4f` schreiben.
4. Im Effekt-Browser (Inspektor → „+ Effekt“) erscheint der Effekt. Fehler in Manifest oder Shader werden dort mit Zeilennummer angezeigt.

## manifest.json

| Feld               | Pflicht | Bedeutung                                                                                                                                                                                                                                                                                            |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | ja      | = Ordnername, kebab-case                                                                                                                                                                                                                                                                             |
| `name`, `category` | ja      | Anzeige im Effekt-Browser (gruppiert nach Kategorie)                                                                                                                                                                                                                                                 |
| `version`          | ja      | `1.0.0`; wird mit jeder Instanz im Projekt gespeichert                                                                                                                                                                                                                                               |
| `description`      | nein    | Kurztext im Effekt-Browser                                                                                                                                                                                                                                                                           |
| `inputs`           | ja      | Teilmenge von `source`, `mask`, `focus`, `depth` (dokumentiert, was der Shader liest)                                                                                                                                                                                                                |
| `passes`           | ja      | Anzahl Pässe (Information; mehrstufige Effekte steuern ihre Pässe in `effect.ts`)                                                                                                                                                                                                                    |
| `params`           | ja      | Parameterliste, siehe unten                                                                                                                                                                                                                                                                          |
| `reach`            | nein    | Reichweite in px (volle Auflösung) als Ausdruck über Parameter, z. B. `"radius"` oder `"distance + softness"`. Pflicht für alles, was Pixel aus der Umgebung liest – sonst entstehen Nähte im gekachelten Export. Erlaubt: Zahlen, Parameternamen, `+ - * /`, Klammern, `max`, `min`, `abs`, `sqrt`. |
| `presets`          | nein    | `[{ "name": "Rotfilter", "values": { "red": 90 } }]` – Auswahl in der Effektkarte                                                                                                                                                                                                                    |
| `implementations`  | nein    | Ausführungsort `{ "preview": …, "final": … }` aus `webgpu`, `browser-cpu`, `python`; Standard beide `webgpu`, fehlt `preview`, gilt `final`                                                                                                                                                          |
| `license`          | nein    | `{ "commercialUse": true, "notes": "Herkunft von Verfahren/Modellen/Daten" }`; Standard kommerziell nutzbar. Effekte mit `false` sind im Lizenzmodus „Kommerziell“ gesperrt                                                                                                                          |
| `cost`             | nein    | `realtime` (Standard), `interactive`, `slow`, `very-slow` – Hinweis im Effekt-Browser                                                                                                                                                                                                                |
| `randomized`       | nein    | `true`: der Kern ergänzt einen Parameter `seed` (Typ `seed`, Gruppe „Erweitert“), falls keiner existiert                                                                                                                                                                                             |
| `requires`         | nein    | benötigte Analysekarten: `luminance`, `edges`, `flow`, `depth`, `normals`, `segmentation`, `saliency`, `faces`                                                                                                                                                                                       |
| `visibleIf`        | nein    | `{ "param": "bedingung" }` – Parameter nur zeigen, wenn die Bedingung gilt: `"duotone"`, `"!duotone"`, `"mode=hue"`, `"grain!=0"`                                                                                                                                                                    |

### Parametertypen

| `type`    | Felder                                                    | Im Shader (`params.<key>`)                                              |
| --------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `int`     | `min`, `max`, `default`, optional `step`, `unit`, `scale` | `i32`                                                                   |
| `float`   | wie `int`                                                 | `f32`                                                                   |
| `angle`   | `default` (Grad)                                          | `f32` in **Radiant**                                                    |
| `bool`    | `default`                                                 | `u32` (0/1)                                                             |
| `color`   | `default` `[r, g, b]` sRGB 0..1                           | `vec3f` **linear**                                                      |
| `enum`    | `options: [{ value, label }]`, `default`                  | `u32` = Index der Option                                                |
| `point`   | `default` `[x, y]` in Leinwand-px                         | `vec2f`, skaliert                                                       |
| `seed`    | `default` ganze Zahl ≥ 0                                  | `u32`                                                                   |
| `palette` | `default` `[[r, g, b], …]` sRGB 0..1, 1–16 Farben         | `array<vec4f, 16>` **linear** + `<key>_count: u32`                      |
| `image`   | `default` `""` (Wert = ID eines Originals im Projekt)     | `u32` (1 = vorhanden); Bild in `src_b`, höchstens ein `image` je Effekt |

- `"group": "Erweitert"`: Parameter erscheinen in einer eingeklappten Gruppe.

- `"unit": "px"`: Der Kern multipliziert den Wert mit dem Skalierungsfaktor (Vorschau < 1, Export = 1), damit Vorschau und Export gleich aussehen. Andere Einheiten (`"%"`) dienen nur der Anzeige.
- `"scale": "log"`: logarithmischer Regler (gut für Radien).
- Reservierte Namen: `resolution`, `origin`, `canvas_size`, `scale`, `flags`.

## Shader-Vertrag (effect.wgsl)

Der Kern stellt jedem Shader ein generiertes Vorspiel voran:

```wgsl
struct Params {
  resolution: vec2f,   // Größe der Ausgabe in px
  origin: vec2f,       // Lage der Ausgabe auf der Leinwand (px bei aktuellem scale; ≠ 0 bei Export-Kacheln)
  canvas_size: vec2f,  // Leinwandgröße (px bei aktuellem scale)
  scale: f32,          // Pixel-Skalierung
  // … danach deine Parameter in Manifest-Reihenfolge
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> pass_data: PassData;   // v0, v1: vec4f, frei pro Pass
@group(0) @binding(2) var src: texture_2d<f32>;           // Eingang: linear, vormultipliziertes Alpha
@group(0) @binding(3) var mask_tex: texture_2d<f32>;      // r, Standard 1
@group(0) @binding(4) var focus_tex: texture_2d<f32>;     // r: 1 = scharf, Standard 1
@group(0) @binding(5) var depth_tex: texture_2d<f32>;     // r: 0 = nah, 1 = fern, Standard 0
@group(0) @binding(6) var linear_sampler: sampler;
@group(0) @binding(7) var dst: texture_storage_2d<rgba16float, write>;
```

Ab Phase 2 außerdem: Kernfeld `flags` (Bit 0 = Ebene hat eine Fokuskarte), Bindung 8 `src_b` (zweiter Eingang, sonst = `src`).

Hilfsfunktionen: `src_size()`, `load_src(p)`, `sample_src(uv)`, `load_mask(p)`, `load_focus(p)`, `load_depth(p)`,
`has_focus()`, `focus_sharpness(p, softness)` (1 = scharf; ohne Fokuskarte 0),
`canvas_pos(p)` (Position in Leinwand-px bei voller Auflösung – für ortsfeste Muster wie Korn),
`unpremultiply(c)`, `premultiply(c)`, `luminance(rgb)`, `hash21(vec2u)`, `srgb_to_linear(rgb)`, `linear_to_srgb(rgb)`.
`canvas_px(p)` (Leinwandposition in Render-px) und `sample_src_canvas(qa)` (bilinear an einer Leinwandposition): kachelgenau
für alles, was an verschobenen Positionen liest – Positionen in Leinwand-Koordinaten rechnen, nicht relativ zur Kachel. `oklab_from_linear(rgb)`, `linear_from_oklab(lab)`: wahrnehmungsnaher Farbraum.

**Zufall mit Seed** (für `"randomized": true`, Seed in `params.seed`): `rand_at(canvas_pos(p), params.seed, k)` liefert 0..1 je
Leinwand-Pixel und Kanal `k`; `rand_noise(cp, zellgröße, seed)` und `rand_fbm(cp, zellgröße, oktaven, seed)` liefern weiches
Rauschen. Alle hängen nur von Leinwandposition und Seed ab – Vorschau, Export-Kacheln und Endrender stimmen überein.
Die Namen des Vorspanns (`rand_*`, `load_*`, `hash21`, …) sind reserviert.
Für CPU-Effekte gibt es dieselben Funktionen in `src/effects/random.ts` (`randCell`, dazu `mulberry32` für Punktmengen).

**Regeln**

- Eingang und Ausgang sind **linear** und **vormultipliziert**. Für Farbmanipulationen erst `unpremultiply`, am Ende `premultiply`.
  Wahrnehmungsnahe Operationen (Kontrast, Mischmodi) auf `linear_to_srgb(...)`-Werten rechnen und zurückwandeln.
- Ausgabe hat dieselbe Größe wie der Eingang. `strength` (Mischung mit dem Eingang) und `region` wendet der Kern danach an.
- Einstufig (ohne `effect.ts`): `fn effect(p: vec2i) -> vec4f` definieren – der Kern erzeugt den Compute-Einstiegspunkt.

## Mehrstufige Effekte (effect.ts)

Mit `effect.ts` definiert `effect.wgsl` beliebige `@compute @workgroup_size(8, 8)`-Einstiegspunkte (gleiche Bindungen), und
`effect.ts` ruft sie in Reihenfolge auf:

```ts
import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const tmp = ctx.texture(ctx.width, ctx.height); // temporär, wird automatisch freigegeben
    ctx.run('pass_a', { src: ctx.source, dst: tmp, data: [1, 0] }); // data → pass_data.v0/v1
    ctx.run('pass_b', { src: tmp, dst: ctx.output }); // letzter Pass schreibt nach ctx.output
  },
});
```

`ctx.params` enthält die Shaderwerte (px skaliert, Radiant, linear), `ctx.raw` die gespeicherten Rohwerte.
Weitere Hilfen: `ctx.gaussian(src, dst, radius, edge)` (Kern-Gauß), `ctx.hasFocus`, `ctx.canvasSize` (Leinwand in Render-px,
wichtig für kachelsichere Entscheidungen), `ctx.run(…, { srcB })` für Pässe mit zwei Eingängen.
Beispiele: `effects/gaussian-blur/` (Pyramide, Fokus-Stapel), `effects/lens-blur/`, `effects/shadow/`.

### Tiefenkarte nutzen

Mit `depth` in `inputs` liefert `load_depth(p)` die Tiefe der Ebene (0 = nah, 1 = fern; ohne Tiefenkarte 0).
Beispiel: `effects/haze/` („Dunst“) mischt mit `byDepth` zusätzlich pro Pixel nach Entfernung.

### Analysekarten nutzen

Mit `"requires": ["luminance", "edges"]` erhält der Shader die Analysekarten der Ebene (berechnet aus ihrem Original,
gecacht, mit der Ebene platziert; bei Effekten auf Gruppen aus dem Effekt-Eingang):

- `load_luminance(p)` – wahrgenommene Helligkeit 0..1 (Bindung 9, `map_luminance`)
- `edge_strength(p)` – Kantenstärke 0..1 (Sobel, je Original-px), `edge_tangent(p)` – Einheitsvektor entlang der Kante
  (geglätteter Strukturtensor, σ = 2 px), `edge_coherence(p)` – 0..1 (Bindung 10, `map_edges`)

Effekte mit `edges` bekommen automatisch 8 px zusätzliche Reichweite für den gekachelten Export. Die Karten sind auch in
der Ansicht „Karten“ (Taste 5) sichtbar und als Effektmaske wählbar (Bereich der Helligkeit/Kantenstärke).

### Fokuskarte nutzen

Effekte, die an Fokuspunkten schwächer wirken sollen, nehmen `focus` in `inputs` auf und Parameter wie
`focusBlur` (Wirkung an den Punkten in % der Stärke) und `focusSoftness` (0…100 %). Pro Pixel:
`radius = mix(stärke, stärke · focusBlur / 100, focus_sharpness(p, focusSoftness / 100))`.

## Ausführung auf der CPU im Browser (effect.worker.ts)

Für globale oder sequenzielle Verfahren (Fehlerdiffusion, Pixel-Sorting, Triangulierung) mit
`"implementations": { "preview": "browser-cpu", "final": "browser-cpu" }`:

```ts
import { defineCpuEffect } from '../../src/effects/cpuApi';

export default defineCpuEffect({
  render(img, ctx) {
    // img: Float32Array RGBA (linear, vormultipliziert), ctx.width × ctx.height – ganze Ebene am Stück
    ctx.progress(0.5);
    const lum = ctx.luminance(); // Analysekarten wie im Shader/Dienst; ctx.edges()
    const r = ctx.rand(x, y, 0); // gleicher Zufall wie rand_at(canvas_pos(p), seed, 0) im Shader
    return img;
  },
});
```

**Ablauf:** Fehlt ein Ergebnis, zeigt die Vorschau zunächst den Eingang; der Worker rechnet im Hintergrund, danach
aktualisiert sich die Vorschau. Der Export rechnet solche Effekte in voller Auflösung am Stück (ohne Kacheln) und wartet
auf alle Ergebnisse. Laufende Berechnungen erscheinen in der unteren Leiste mit Fortschritt und „Abbrechen“.

## Ausführung im Python-Dienst (effect.py)

Mit `"implementations": { "preview": "webgpu", "final": "python" }` (oder `python` für beide) rechnet der lokale Dienst.
`effect.py` im selben Ordner definiert:

```python
def render(image, ctx):  # image: float32 (H, W, 4), linear, vormultipliziert → gleiches Format zurück
    ctx.progress(0.5)             # Fortschritt 0..1; bricht bei Abbruch ab
    lum = ctx.luminance()         # Analysekarten wie im Browser: ctx.luminance(), ctx.edges()
    noise = ctx.rand_cell(0)      # gleicher Zufall wie rand_cell im Shader (Seed: ctx.seed)
    return image
```

`ctx.params` (Projektwerte mit Standardwerten), `ctx.scale` (Render-px pro Leinwand-px), `ctx.origin`, `ctx.canvas_size`.
Ergebnisse werden über einen Hash aus Bild, Effekt, Version, Parametern und Lage gecacht.

## Prüfung

Beim Laden prüft der Kern Manifest (Pflichtfelder, Typen, Wertebereiche, `reach`, `visibleIf`, Presets) und kompiliert den Shader.
Fehler erscheinen im Effekt-Browser und auf der Effektkarte; die App läuft weiter, der fehlerhafte Effekt wird übersprungen.
