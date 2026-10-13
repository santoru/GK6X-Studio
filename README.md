# GK6X Studio

A keymap and lighting editor for GK6X keyboards (GK61 family) that runs entirely in the browser. It talks to the
keyboard directly over [WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API): no driver, no install,
no backend, no build step, no dependencies.

Unofficial. The protocol is ported from [pixeltris/GK6X](https://github.com/pixeltris/GK6X).

## Features

- VIA-style keymap editor for Layers 1–3, plus Base with a confirmation before writing.
- Click a key, then pick a keycode, or press a key on any keyboard. Modifier combos like Ctrl+C and media,
  lighting, mouse and layer keys are supported.
- Per-layer lighting: paint per-key colours, or pick one of 12 effects (rainbow wave, ripple, radar, rain…) with
  your colour and speed and a live preview. Effects are generated from each keyboard's own key layout.
- Writes only what changed. Export and import profiles as JSON.

## Privacy

Everything runs locally in your browser. The app makes no network requests. Profiles are kept in your
browser's local storage and only reach the keyboard when you click **Write**.

## Requirements

Chrome or Edge on desktop, which have WebHID. Safari and Firefox aren't supported.

## Run locally

```sh
python3 -m http.server 8642 --bind 127.0.0.1
```

Open http://127.0.0.1:8642, click **Connect keyboard** and pick the keyboard. A server is needed only because
browsers don't load JavaScript modules from `file://`.

## Deploy (GitHub Pages)

1. Push to GitHub.
2. Under **Settings → Pages**, set the source to **GitHub Actions**.
3. Every push to `main` runs the tests and deploys. `.github/workflows/pages.yml` adds a version to every
   asset URL, so cached old files never mix with a new deploy.

## Safety

- Only commands proven by pixeltris/GK6X are sent. Unknown opcodes are never used.
- Writing is enabled only when the keyboard's model ID and firmware ID match the bundled data.
- Lighting is left untouched until you choose something for a layer.
- After a write, the keyboard switches to Layer 1, so it never lands on a layer without letters.
- **••• → Show packet log** shows every byte sent and received.

## Limits

- The keyboard can't be read back, so the app tracks what it last wrote. At first it assumes the layout in
  `js/preset.js`.
- Fn is fixed in firmware. Fn layers, macros, Base lighting and reactive (per-keypress) lighting aren't
  supported.
- Effect previews are approximate.

## Development

| Path | Purpose |
|---|---|
| `js/protocol.js` | HID packets, CRC, handshake, writes |
| `js/keycodes.js` | Key action values and labels |
| `js/lighting.js` | Lighting encoding and preview |
| `js/effects.js` | Generated lighting effects |
| `js/preset.js` | Default keymap |
| `js/app.js` | UI |
| `js/models.js` | Key matrix and LED layout per model, generated. Don't edit |

- `node --test` runs the tests (Node 22+, no packages).
- `python3 -I tools/gen_data.py <GK6X/Build/Data> [filter]` regenerates `js/models.js` from a pixeltris/GK6X
  checkout. The default filter `61` keeps the GK61 family.

## Credits

Protocol research and data extraction by [pixeltris/GK6X](https://github.com/pixeltris/GK6X), MIT licensed.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
