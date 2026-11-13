# Method Bench: project rules

Static browser application. Strict TypeScript, Vite, Vitest, Playwright, no framework. One runtime dependency, three.js, loaded on demand for the instrument drawing and the run comparison (`src/ui/three/`).

## Rules that do not bend

- `src/engine/` is pure and deterministic. No DOM, no dates, no unseeded randomness. Every constant lives in `tunables.ts` or in the data set, with a source.
- The student-facing side never reads engine truth. Peak tables come from `integrate()` on the trace; quantitation and validation come from `src/lab/analysis.ts`, which sees only integrated peaks and the names the student assigned. The only places truth is shown are the debrief and the Instructor tab.
- Every number in `src/data/*.json` has a provenance record. `src/data` is generated: change `tools/`, then rebuild. Never hand-edit the JSON.
- Do not add data or code from sources under non-commercial or unclear licences. Do not name or imitate commercial method-development software. See `docs/DECISIONS.md`.
- A physical claim in the UI or docs must be true of the code. If a value is assumed, the UI says assumed.
- Golden tests before UI. A new engine behaviour gets a closed-form or literature test first.
- The WebGL views are an addition, never the only way in. Every setting on the instrument drawing is in the form beside it, every trace in the comparison is in the table under it, and the page works with WebGL off. Nothing inside the column is drawn: the drawing shows only what an operator could see.
- The instrument drawing is a generic instrument of its class. No maker's shapes, colours, panel layouts, names or badges.
- Accessibility is tested, not asserted: `npm run e2e` scans every tab at two widths in both themes. Every chart has a table with the same content. Nothing is conveyed by colour alone.
- Student-facing text: no em or en dashes, no curly quotes, no emoji, no exclamation marks, no "not X but Y".

## Commands

`npm run typecheck`, `npm run test:run`, `npm run build`, `npm run e2e`. Data: `node tools/fit-catechins.ts && node tools/fit-cannabinoid-ph.ts && node tools/build-data.ts`. Quick look at where things elute: `node tools/peek.ts`.

## Where things are

See the table in `README.md`. Decisions and their reasons: `docs/DECISIONS.md`, append-only.
