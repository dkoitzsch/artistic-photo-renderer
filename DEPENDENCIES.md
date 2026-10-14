# Bibliotheken und Lizenzen

Geprüft an der Quelle (npm-Metadaten und LICENSE-Datei im Quell-Repository). Modelle und ML-Bibliotheken stehen
gesondert in `models/registry.json` und `MODELS.md` (ab Phase 2).

## Laufzeit (im ausgelieferten Bundle)

| Paket                      | Version | Lizenz                  | Quelle                                   | Geprüft    |
| -------------------------- | ------- | ----------------------- | ---------------------------------------- | ---------- |
| react, react-dom           | 19.3.0  | MIT                     | github.com/facebook/react                | 2026-10-14 |
| zustand                    | 5.0.15  | MIT                     | github.com/pmndrs/zustand                | 2026-10-14 |
| @radix-ui/react-dialog     | 1.3.1   | MIT                     | github.com/radix-ui/primitives (LICENSE) | 2026-10-14 |
| fflate                     | 0.8.3   | MIT                     | github.com/101arrowz/fflate (LICENSE)    | 2026-10-14 |
| @fontsource-variable/inter | 5.3.0   | OFL-1.1 (Schrift Inter) | github.com/fontsource/fontsource         | 2026-10-14 |
| ag-psd                     | 31.0.3  | MIT                     | github.com/Agamnentzar/ag-psd (LICENSE)  | 2026-10-14 |

## Entwicklung (nicht im Bundle)

| Paket                                                                     | Version                                 | Lizenz       |
| ------------------------------------------------------------------------- | --------------------------------------- | ------------ |
| vite, @vitejs/plugin-react, vitest                                        | 8.3.4, 6.1.2, 5.0.4                     | MIT          |
| typescript                                                                | 6.0.3                                   | Apache-2.0   |
| @webgpu/types                                                             | 0.1.74                                  | BSD-3-Clause |
| @playwright/test                                                          | 1.64.0                                  | Apache-2.0   |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals | 10.12.0, 10.0.1, 8.71.2, 7.1.1, 17.13.0 | MIT          |
| prettier                                                                  | 3.9.10                                  | MIT          |
| pngjs                                                                     | 7.0.0                                   | MIT          |

Nur zur einmaligen Prüfung (nicht installiert, nicht im Repo): psd-tools (MIT) über `uv run --with psd-tools`.

Alle Lizenzen erlauben kommerzielle Nutzung.
