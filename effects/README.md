# Effekt-Plugins

Jeder Effekt – auch die mitgelieferten – ist ein Ordner in `effects/`. Ein neuer Effekt braucht **keine Änderung am Kern**:
Ordner anlegen, die App lädt ihn (im Dev-Server sofort per Hot Reload), die Regler entstehen aus dem Manifest.
Ordner, die mit `_` beginnen (z. B. `_template/`), werden ignoriert.

```
effects/
  mein-effekt/
    manifest.json   # Pflicht: Beschreibung und Parameter
    effect.wgsl     # Pflicht: Shader
    effect.ts       # optional: mehrstufige Pässe
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
| `visibleIf`        | nein    | `{ "param": "bedingung" }` – Parameter nur zeigen, wenn die Bedingung gilt: `"duotone"`, `"!duotone"`, `"mode=hue"`, `"grain!=0"`                                                                                                                                                                    |

### Parametertypen

| `type`  | Felder                                                    | Im Shader (`params.<key>`) |
| ------- | --------------------------------------------------------- | -------------------------- |
| `int`   | `min`, `max`, `default`, optional `step`, `unit`, `scale` | `i32`                      |
| `float` | wie `int`                                                 | `f32`                      |
| `angle` | `default` (Grad)                                          | `f32` in **Radiant**       |
| `bool`  | `default`                                                 | `u32` (0/1)                |
| `color` | `default` `[r, g, b]` sRGB 0..1                           | `vec3f` **linear**         |
| `enum`  | `options: [{ value, label }]`, `default`                  | `u32` = Index der Option   |
| `point` | `default` `[x, y]` in Leinwand-px                         | `vec2f`, skaliert          |

- `"unit": "px"`: Der Kern multipliziert den Wert mit dem Skalierungsfaktor (Vorschau < 1, Export = 1), damit Vorschau und Export gleich aussehen. Andere Einheiten (`"%"`) dienen nur der Anzeige.
- `"scale": "log"`: logarithmischer Regler (gut für Radien).
- Reservierte Namen: `resolution`, `origin`, `canvas_size`, `scale`.

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

Hilfsfunktionen: `src_size()`, `load_src(p)`, `sample_src(uv)`, `load_mask(p)`, `load_focus(p)`, `load_depth(p)`,
`canvas_pos(p)` (Position in Leinwand-px bei voller Auflösung – für ortsfeste Muster wie Korn),
`unpremultiply(c)`, `premultiply(c)`, `luminance(rgb)`, `hash21(vec2u)`, `srgb_to_linear(rgb)`, `linear_to_srgb(rgb)`.

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
Beispiel: `effects/gaussian-blur/`.

## Prüfung

Beim Laden prüft der Kern Manifest (Pflichtfelder, Typen, Wertebereiche, `reach`, `visibleIf`, Presets) und kompiliert den Shader.
Fehler erscheinen im Effekt-Browser und auf der Effektkarte; die App läuft weiter, der fehlerhafte Effekt wird übersprungen.
