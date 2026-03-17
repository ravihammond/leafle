# CLAUDE.md

## What this repo is

This repo implements `leafle`: a local CLI for live-previewing LaTeX papers in the browser.

It is intentionally split into two halves:

1. **CLI/runtime orchestration**
   - `bin/leafle.mjs`
   - Starts `latexmk`
   - Creates/uses an external cache dir under `~/.cache/leafle/...`
   - Starts the Vite dev server programmatically
   - Passes runtime state via env vars:
     - `TEXVIEW_CACHE_DIR`
     - `TEXVIEW_PDF_NAME`
     - `TEXVIEW_MAIN_TEX`

2. **Browser viewer**
   - `vite.config.ts`
   - `src/App.tsx`
   - `src/main.tsx`
   - `src/index.css`
   - Uses React + Vite + PDF.js
   - Serves the current built PDF through Vite middleware
   - Reloads the PDF **in place** via a custom websocket event
   - Must preserve user context better than naive browser refreshes

This repo is a reusable external tool. It must stay independent from any specific Overleaf or paper repo.

---

## Primary product goal

The experience should feel like a polished dev server:

- one command: `leafle main.tex`
- fast startup
- clean terminal output
- browser viewer at localhost
- no full-page refreshes for PDF updates
- no BrowserSync-style popups or “connected” notifications
- no scroll reset on every update
- no generated files written into the paper repo
- robust enough for repeated daily use

---

## Non-negotiable behaviour

When changing this repo, preserve these invariants unless the user explicitly asks to change them:

1. **No repo pollution**
   - Generated PDFs, `.aux`, `.bbl`, logs, etc. should stay outside the target LaTeX repo.
   - The target paper repo should remain clean.

2. **External tool design**
   - `leafle` is installed/linked once and run from arbitrary LaTeX repos.
   - Do not redesign this into something that requires adding app code into each paper repo.

3. **PDF delivery contract**
   - The Vite dev server must expose:
     - `/api/meta`
     - `/pdf/current.pdf`

4. **Live update contract**
   - The server must emit a custom websocket event:
     - `leafle:pdf-updated`

5. **Viewer UX**
   - Reload the PDF in place.
   - Avoid full-page reloads.
   - Preserve scroll position as well as reasonably possible.
   - Preserve zoom as well as reasonably possible.

6. **Local-only default**
   - Default host should remain local-only unless explicitly asked otherwise.

---

## File map

### `bin/leafle.mjs`

Owns:

- CLI argument parsing
- validation of `<main.tex>`
- cache dir creation
- `latexmk` child process
- Vite server startup through the JS API
- terminal output
- shutdown handling
- optional browser opening

### `vite.config.ts`

Owns:

- React plugin
- custom Vite middleware for `/api/meta`
- custom Vite middleware for `/pdf/current.pdf`
- filesystem watching/polling of the built PDF
- sending `leafle:pdf-updated` websocket events

### `src/App.tsx`

Owns:

- PDF.js worker setup
- loading `/api/meta`
- loading `/pdf/current.pdf`
- rendering pages to canvases
- preserving/restoring view state
- viewer toolbar
- status pill text and tone

### `src/index.css`

Owns:

- visual polish
- dark app shell
- sticky toolbar
- page spacing and viewer layout

---

## Commands

Use these during development:

```bash
npm install
npm run build
npm run lint
npm link
```
