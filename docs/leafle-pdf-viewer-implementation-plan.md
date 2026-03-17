# Leafle PDF Viewer Migration Plan

## Purpose

This document is a repo-specific implementation plan for upgrading Leafle’s current hand-rolled PDF.js renderer into a professional-grade PDF viewer based on the official PDF.js viewer architecture.

The current implementation renders each page manually to a canvas, creates a simplified text layer, and fully rebuilds the document on load and zoom. That architecture is the root cause of the current UX problems:

- links are visible but not clickable
- there are no proper hover states for PDF links and interactive annotations
- zoom is slow because the entire document is reloaded and rerendered
- text selection and copy/paste feel awkward and visually messy
- the app does not behave like a real PDF viewer such as Overleaf’s richer viewer mode or the stock PDF.js viewer

The goal is to keep the existing React + Vite shell and live-update workflow, while replacing the manual rendering stack with the official PDF.js viewer stack.

---

## High-level target architecture

### Keep

- React + Vite application shell
- existing toolbar and app chrome, adapted as needed
- current `/api/meta` endpoint shape
- current websocket-based PDF update signal, improved where necessary
- serving a locally built PDF from the Vite dev server

### Replace

Replace the current custom `canvas + custom textLayer + full rerender` pipeline with:

- official PDF.js viewer/page-view architecture
- official PDF.js text layer styling and behavior
- official PDF.js annotation layer for links and hover interactions
- viewer-managed scale updates instead of full document reloads on zoom
- lazy/visible-page rendering instead of eager rendering of every page

### Result we want

After the migration, the viewer should support:

- clickable external links
- clickable internal PDF links/bookmarks if present
- proper hover affordances for links
- substantially smoother zoom and fit-width behavior
- better text selection and copy/paste behavior
- preserved view position across PDF recompiles
- a structure that can later support search, page navigation, thumbnails, outline, and sync features

---

## Diagnosis of the current implementation

### Current rendering flow in `src/App.tsx`

The current code does the following:

1. calls `pdfjsLib.getDocument()`
2. waits for the full document to load
3. loops through every page in the document
4. renders every page to a canvas
5. renders a simplified text layer using `TextLayer`
6. stores all rendered pages in memory
7. replaces the whole viewer DOM in one go

This means the app is functioning as a minimal display-layer renderer, not a full viewer.

### Why links do not work

The current code never renders an annotation layer.

PDF links, many interactive hotspots, and annotation hitboxes are not part of the canvas image and are not provided by the text layer. They come from the annotation layer. Because Leafle only renders the canvas plus text layer, the link is visible visually but there is no clickable DOM overlay for it.

### Why hover states do not exist

For the same reason, there are no annotation DOM nodes such as link anchors, so there is nothing for the browser to hover over in the proper way. The top interactive layer is effectively the text-selection overlay, not a real annotation layer.

### Why zoom is slow

The current `zoomIn`, `zoomOut`, and `fitWidth` paths all call back into `loadPdf()`. That causes a new full-document load and rerender instead of a viewer scale update.

This is the wrong abstraction. Zoom should update viewer scale, not behave like a full document reload.

### Why text selection looks bad

The current CSS is only a lightweight approximation of the official PDF.js text layer CSS. It lacks the full selection/highlight behavior and the exact layout/styling assumptions used by the stock viewer. The result is that the browser paints selection rectangles across many tiny absolutely positioned transparent spans, which produces ugly overlap and awkward selection behavior.

### Why the app feels less polished than Overleaf or the stock viewer

Because it is missing the higher-level viewer services and viewer CSS:

- no annotation layer
- no link service
- no viewer/page-view controller
- no visible-page rendering strategy
- no official text and annotation layer styling
- no real zoom model

---

## Implementation strategy

Do **not** continue to patch the current architecture incrementally.

Instead, perform a controlled migration in which the React app keeps ownership of the shell, but PDF.js owns the actual viewer internals.

The migration should be done in phases so that each phase remains testable.

---

## Phase 1: Prepare the repo for a viewer-layer integration

### Goal

Create a clean internal boundary between:

- application shell / toolbar / live-reload orchestration
- PDF viewer implementation details

### Work to do

1. Introduce a dedicated viewer module area under `src/`, for example:
   - `src/pdf/` or `src/viewer/`
2. Move PDF-specific logic out of `App.tsx`
3. Keep `App.tsx` responsible only for:
   - toolbar state and button handlers
   - file label display
   - live-update events
   - mounting the viewer container
4. Create a viewer controller or hook responsible for:
   - initializing the official PDF.js viewer
   - loading/unloading a document
   - updating scale
   - preserving/restoring position on true reloads

### Desired outcome

`App.tsx` becomes orchestration-only. The viewer implementation becomes isolated and replaceable.

---

## Phase 2: Stop hand-building pages and adopt the official PDF.js viewer model

### Goal

Replace manual page rendering with the official viewer/page-view architecture.

### Work to do

1. Remove the current manual per-page loop that calls `getPage()` and `renderPage()` for every page.
2. Stop creating page wrappers, canvases, and text-layer DOM manually in application code.
3. Initialize the official PDF.js viewer components instead.
4. Ensure the viewer manages page views, scale, and rendering lifecycle.
5. Keep one stable viewer container element in the DOM rather than replacing all children manually after every load.

### Constraints

- React should not try to own every page node.
- React should provide a mount point and let the viewer manage its internal DOM.
- Avoid trying to make the viewer fully declarative in React.

### Desired outcome

The PDF document is controlled by PDF.js viewer internals rather than a custom render loop.

---

## Phase 3: Add the missing annotation layer and link handling

### Goal

Make links and annotation interactions work properly.

### Work to do

1. Ensure the viewer is configured to create annotation layers for pages.
2. Wire in the PDF.js link service so annotations and internal navigation work correctly.
3. Make sure the annotation layer is stacked correctly relative to the canvas and text layer.
4. Verify that:
   - external URLs open correctly
   - internal links navigate correctly if present in the PDF
   - hover states and pointer behavior appear on link regions
5. Ensure text selection still works in combination with the annotation layer.

### Important note

Do not try to fake this with custom hitboxes or regex-based link extraction from text content. The correct solution is to use the annotation layer.

---

## Phase 4: Replace custom CSS with official viewer-layer CSS

### Goal

Bring selection, text-layer, annotation-layer, and page styling closer to stock PDF.js behavior.

### Work to do

1. Stop relying on the current custom `.textLayer` styling as the main source of truth.
2. Import the official PDF.js viewer CSS assets required for:
   - core page view styling
   - text layer styling
   - annotation layer styling
3. Retain only app-shell-specific styling in `src/index.css`, such as:
   - toolbar
   - outer background
   - panel styling
   - spacing around the viewer container
4. Carefully reconcile class names so app-level styling does not accidentally override viewer-layer rules.
5. Remove custom rules that conflict with the stock viewer, especially around:
   - `.textLayer`
   - `.textLayer span`
   - selection styling
   - layer positioning
   - pointer events

### Desired outcome

Text selection should look substantially better, and links/annotations should have the correct DOM and hover behavior.

---

## Phase 5: Redesign zoom so it changes scale instead of reloading the document

### Goal

Make zoom fast and viewer-native.

### Work to do

1. Separate two concepts clearly:
   - **document reload** because the PDF file changed on disk
   - **viewer scale update** because the user pressed zoom in/out or fit width
2. Remove the current pattern where zoom calls `loadPdf()` with a cache-busting timestamp.
3. Keep the document loaded while changing viewer scale.
4. Make `zoomIn`, `zoomOut`, and `fitWidth` update viewer scale only.
5. Ensure `fitWidth` uses the viewer’s scaling facilities rather than remeasuring and fully rebuilding the document manually.
6. Preserve current zoom level across document reloads when the underlying PDF recompiles, unless there is a deliberate reason to reset it.

### Desired outcome

Zoom becomes materially more responsive because it is no longer implemented as a full document fetch + rerender path.

---

## Phase 6: Render visible pages lazily instead of rendering the full document eagerly

### Goal

Improve performance and memory behavior.

### Work to do

1. Stop forcing an eager render of all pages at load time.
2. Let the viewer render visible or near-visible pages according to its internal scheduling.
3. Avoid holding unnecessary canvases for all pages at once where possible.
4. Verify behavior with:
   - short PDFs
     n - long PDFs
   - large pages and high zoom scales
5. Confirm that scrolling stays smooth even on longer documents.

### Desired outcome

The viewer should feel much lighter on initial load, on zoom, and on long documents.

---

## Phase 7: Improve live-reload semantics for compiled PDFs

### Goal

Keep the current “PDF updates when LaTeX recompiles” workflow, but make the update path safer and cleaner.

### Work to do

1. Keep the existing websocket event idea from the Vite plugin.
2. Debounce or stabilize update notifications so a single LaTeX build does not cause unnecessary repeated reload attempts.
3. On PDF update:
   - capture current view state
   - reload the document
   - restore approximate location in the new document
4. Ensure stale renders or stale reload attempts are cancelled or ignored safely.
5. Preserve scale across reloads.
6. Continue to show the loading/empty state only when there has not yet been a successful document render.

### Desired outcome

Recompiles should feel stable and preserve working context instead of jarringly resetting the whole viewer.

---

## Phase 8: Make the PDF endpoint more viewer-friendly

### Goal

Serve the PDF in a way that aligns with viewer expectations.

### Work to do

1. Upgrade the Vite middleware serving `/pdf/current.pdf` so it behaves more like a real file server.
2. Add support for:
   - `Content-Length`
   - `Accept-Ranges: bytes`
   - byte-range requests where practical
   - correct content type and no-store cache semantics
3. Ensure the route behaves cleanly for repeated reads and reloads.
4. Keep the dev experience simple; do not introduce unnecessary backend complexity.

### Desired outcome

The viewer can fetch the PDF more efficiently, and the serving layer is closer to what real PDF viewers expect.

---

## Phase 9: Preserve and restore view state robustly

### Goal

Keep the user at roughly the same place after recompiles or controlled reloads.

### Work to do

1. Keep the current concept of capturing page number + relative vertical position.
2. Refactor it so it works with the official viewer’s page model instead of custom DOM assumptions.
3. Preserve:
   - current page
   - approximate vertical position within the page
   - current scale / fit mode
4. On document reload, restore state only after the viewer is ready.
5. Handle the case where the old page no longer exists or the document structure changes materially.

### Desired outcome

PDF recompiles should keep the user near the same location and zoom level.

---

## Phase 10: Leave room for future viewer features

### Goal

Do the migration in a way that makes later upgrades easy.

### Future-friendly features to preserve optionality for

- search / find controller
- page number box
- outline / table of contents
- thumbnail sidebar
- keyboard shortcuts for navigation and zoom
- source-to-PDF sync or SyncTeX-inspired navigation later
- dark-mode viewer polish at the app-shell level
- presentation mode or fit-page mode

### Important principle

Do not overbuild these now. Just avoid architectural choices that would block them later.

---

## File-by-file implementation plan

## `src/App.tsx`

### Current role

Contains both shell UI and the entire viewer/rendering engine.

### What to change

Refactor heavily.

### New responsibilities

- render toolbar
- render outer viewer container
- trigger viewer actions such as zoom, fit width, or open PDF
- subscribe to PDF update events
- pass viewer state and callbacks between the shell and the viewer module

### Remove from this file

- manual per-page rendering loop
- manual `renderPage()` implementation
- custom page DOM creation
- custom text-layer construction logic
- direct canvas orchestration

### Keep conceptually

- file label fetch from `/api/meta`
- `pdfVersion` or equivalent document version signal
- view-state preservation concept, but delegated into the viewer module

---

## `src/index.css`

### Current role

Mixes app-shell styling with low-level viewer/text-layer styling.

### What to change

Split concerns.

### Keep here

- theme variables
- toolbar styles
- container spacing
- loading/empty-state styles
- outer page background / shell chrome

### Remove or minimize here

- low-level `.textLayer` rules
- text span rules
- selection rules that compete with the stock viewer
- any custom layer positioning that conflicts with official viewer CSS

### Add

- only the minimum shell-level overrides needed to visually integrate the official viewer

---

## `src/main.tsx`

### Current role

Bootstraps the React app.

### What to change

Likely minimal changes only.

### Notes

Keep an eye on dev-mode behavior under `StrictMode`. If initialization logic is sensitive to double-invocation in development, make the viewer initialization idempotent and cleanup-safe.

---

## `vite.config.ts`

### Current role

Provides:

- `/api/meta`
- `/pdf/current.pdf`
- websocket notifications when the PDF file changes

### What to change

Improve, do not discard.

### Keep

- the core plugin idea
- `mainTex` metadata endpoint
- custom websocket event on PDF updates

### Improve

- serve the PDF more like a real file endpoint
- consider range support
- debounce or stabilize change detection
- make change handling resilient to rapid consecutive writes during LaTeX builds

### Do not do

- do not turn this into an overengineered backend
- do not abandon the clean Vite-dev-server workflow

---

## `package.json`

### What to change

Add or update dependencies only as needed for the official viewer-layer integration.

### Requirements

- keep `pdfjs-dist`
- avoid introducing unnecessary extra viewer abstraction libraries unless there is a compelling reason
- if a PDF.js version change is needed for compatibility with the viewer-layer approach, document why before changing it

---

## New files / modules to introduce

Claude should likely introduce a small viewer module structure, for example:

- `src/pdf/LeaflePdfViewer.ts` or `.tsx`
- `src/pdf/useLeaflePdfViewer.ts`
- `src/pdf/viewerState.ts`
- `src/pdf/viewerStyles.css` or imported official viewer CSS bridge file

The exact names can vary, but the separation of responsibilities should be explicit.

---

## Interaction design requirements

These are product requirements, not optional nice-to-haves.

### Links

- external PDF links must be clickable
- hover cursor and hover affordance should appear
- internal links should work if present

### Zoom

- zoom in/out should not cause a full document reload
- fit width should feel instant enough for daily use
- zoom should preserve location sensibly

### Selection

- text selection should visually resemble a real PDF viewer more closely
- copy/paste should behave as well as PDF.js reasonably allows
- selection should not be blocked by incorrect layer ordering

### Reloads

- recompiling the PDF should update the viewer
- the user should stay near the same location in the document
- scale should persist across recompiles

### Performance

- initial render should feel lighter
- long PDFs should remain usable
- page scrolling should stay smooth

---

## Recommended delivery workflow for Claude Code

Claude should be instructed to work in the following sequence:

1. inspect the repo and understand the current architecture
2. produce a short implementation plan before editing
3. perform the migration in small, reviewable steps
4. run checks after meaningful milestones
5. summarize every changed file and why it changed
6. stop only once the viewer is working end-to-end

### Commands Claude should run during the task

Claude should use the project’s actual commands where possible, including at least:

- install dependencies if needed
- type-check / build
- lint
- run the dev server only if necessary to verify integration

If there are missing project commands, Claude should explain that clearly and use the next best verification path.

---

## Acceptance criteria

The migration is complete only when all of the following are true:

1. PDF links are clickable.
2. Hover feedback exists on links/interactive annotations.
3. Zoom no longer triggers a full document reload.
4. The viewer no longer eagerly rerenders the whole document for every zoom step.
5. Text selection is materially improved versus the current implementation.
6. Live PDF recompiles still work.
7. View position and scale are preserved across recompiles.
8. The React app shell remains clean and maintainable.
9. The viewer code is modular enough for future features.
10. The repo builds successfully after the migration.

---

## QA checklist

Claude should manually verify all of the following after implementation:

### Core interaction

- open the viewer and confirm the first PDF renders
- click an external link in a test PDF
- hover a link and verify pointer/hover behavior
- test any internal document links if available
- drag to select text across a single line
- drag to select text across multiple lines
- copy selected text into a text editor and inspect output

### Zoom and navigation

- zoom in repeatedly and confirm no full reload occurs
- zoom out repeatedly and confirm stability
- use fit width and confirm it behaves like a scale change, not a full reload
- scroll through a longer document and watch for performance issues

### Reload behavior

- trigger a new PDF build
- confirm the websocket update reloads the document
- confirm scale is preserved
- confirm approximate scroll position is preserved

### Stability

- run build / lint / type-check
- inspect console for viewer-layer errors
- inspect for obvious CSS conflicts

---

## Non-goals for this migration

Do **not** expand scope into the following unless absolutely required by the migration:

- commercial PDF SDK adoption
- full-text search UI
- thumbnails sidebar
- document outline sidebar
- SyncTeX or source-to-PDF reverse sync
- mobile layout redesign
- major visual redesign of the toolbar

The objective is to fix the viewer architecture first.

---

## Risks and implementation notes

### Risk 1: React vs imperative viewer lifecycle

The official viewer model is not naturally “React-ish”. The fix is not to fight this, but to wrap it cleanly. React should own the mount point and toolbar state; the viewer module should own the imperative viewer lifecycle.

### Risk 2: CSS conflicts

The current custom CSS may conflict with the official viewer CSS. Claude should remove or minimize conflicting layer-related rules rather than trying to outsmart the official CSS.

### Risk 3: Dev-mode double initialization

Because the app uses `StrictMode`, initialization code must be cleanup-safe and idempotent in development.

### Risk 4: Range support complexity

If full byte-range support becomes awkward inside the Vite dev middleware, Claude should still improve serving behavior sensibly and document any remaining limitation rather than blocking the migration.

### Risk 5: Selection will improve, but not become mathematically perfect

PDF.js text selection is inherently delicate in browsers. The goal is to move from a simplified custom integration to the official viewer-layer behavior, not to promise perfection beyond what PDF.js itself supports.

---

## What success looks like

Leafle should feel like a real PDF viewer inside a custom React shell.

Concretely:

- the viewer should feel closer to Overleaf or the stock PDF.js experience
- links should behave like links
- zoom should feel like zoom, not reload
- text selection should feel much less broken
- recompiles should preserve context instead of resetting the experience

This migration should also leave the codebase in a shape where future viewer features are straightforward instead of painful.
