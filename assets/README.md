# Game assets and provenance

## Artwork

The ocean backdrop and six sea-creature images in `art/` were generated for this project on 2026-11-17 using the built-in OpenAI image generation tool. No Krillion.io images were supplied as image inputs. The generation prompts are recorded in [ART-PROMPTS.md](ART-PROMPTS.md), and file hashes and dimensions are in [sources.json](sources.json). The sky is drawn with CSS.

The earlier prototype used five backgrounds and ten tier images downloaded from Krillion.io. Those images have been removed from the runtime and from this repository's intended initial commit. Their local comparison copies and earlier provenance manifest are in the ignored `outputs/reference-art-before-replacement/` directory, which is not part of a build or deployment.

Gold wardrobe variants reuse the corresponding newly generated sprites with a CSS color filter. Character IDs remain stable so existing local saves still work.

## Fonts

- `fonts/VT323-Regular.ttf` is from the Google Fonts repository.
- `fonts/Sarabun-Regular.ttf` and `fonts/Sarabun-Bold.ttf` provide Thai text.
- Both font families are distributed with their corresponding SIL Open Font License text in `fonts/VT323-OFL.txt` and `fonts/Sarabun-OFL.txt`.

## Sound reference schedules

`audio-cues.json` contains numeric schedules for 16 sound cues observed in the public Krillion.io DescentAudio module on 2026-11-17. The Web Audio implementation is separate, but the schedules are still based on the reference and should be reviewed before public release. The inspected module contained event-driven tone/noise synthesis; no continuous music loop was observed in that module.
