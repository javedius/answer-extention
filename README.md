# Study Content Analyzer (Chrome Extension, MV3)

Learning assistant extension that analyzes page content and detects likely question blocks and answer controls.

## Features in MVP

- Floating draggable overlay on top of any page.
- Manual analysis via:
  - extension icon click,
  - `Alt+Shift+A` to toggle panel,
  - `Alt+Shift+S` to trigger analysis.
- Detects common answer controls:
  - radio / checkbox / text input,
  - select with options,
  - textarea.
- Extracts hints from:
  - image `alt`/`title`,
  - SVG `text`/`title`/`desc`.

## Project structure

- `manifest.json` - extension configuration.
- `src/background.js` - command and action handlers.
- `src/content.js` - page analysis and overlay UI.

## Run locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `gg-ex`.
5. Open any page with form controls and press `Alt+Shift+A`.

## Important note

This extension is designed for study assistance and content structuring.  
It does not auto-click, auto-fill, or submit answers.

## AI with LM Studio

The extension supports local AI analysis through LM Studio (OpenAI-compatible API).

Default connection:

- Base URL: `http://127.0.0.1:1234/v1`
- Endpoint used: `/chat/completions`
- Model:
  - if `lmStudioModel` is set in storage -> this model is used,
  - otherwise extension auto-selects first loaded model from `/models`.

To set custom settings in Chrome DevTools console:

```js
chrome.storage.local.set({
  lmStudioBaseUrl: "http://127.0.0.1:1234/v1",
  lmStudioModel: "",
  lmStudioApiKey: ""
});
```

Usage:

1. Start LM Studio local server and load at least one model.
2. Reload extension in `chrome://extensions`.
3. Open page and toggle panel (`Alt+Shift+A`).
4. Click **Collect**.
5. Click **AI Parse** to let LLM detect question/options from raw page context.

## Next steps

- Add optional OCR (`tesseract.js`) for image-only tasks.
- Add per-site selectors configuration in `chrome.storage`.
- Add export to JSON for collected question blocks.
