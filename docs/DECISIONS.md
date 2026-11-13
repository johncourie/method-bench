# Decisions

Append-only. Newest last.

**2026-11-13. Standalone repository, own Pages site.** Chosen by the owner over a folder inside the existing teaching-tools site, so the tool can be cited and forked on its own.

**2026-11-13. Two cases in the first version.** Catechins for method development, cannabinoids for the stability-indicating and compliance exercise.

**2026-11-13. MIT for code, CC BY 4.0 for data and text.**

**2026-11-13. No non-commercial sources.** The best-known open LC simulator, its compound parameters, and the public column-selectivity database are all CC BY-NC-SA. None of their code or data is used. Consequence: the hydrophobic-subtraction model is not implemented, and column selectivity comes from per-column retention data instead.

**2026-11-13. Acetonitrile only.** No open data supports methanol for either compound class. Offering it would mean inventing selectivity.

**2026-11-13. The model is hidden; the student fits it.** The alternative, sliders that redraw a labelled chromatogram, teaches the response surface but not the practice of method development. Chosen: unlabelled chromatograms, injections that cost time, a model fitted from the student's own runs.

**2026-11-13. The trace is integrated by an algorithm that sees only the trace.** Peak tables are not derived from the engine's knowledge of where peaks are. This is what makes co-elution, drift and wide-range calibration behave realistically.

**2026-11-13. Linear solvent strength, no curvature.** A shared Neue-Kuss curvature term made the catechin leave-one-out error worse. The engine still supports it for future measured data.

**2026-11-13. Catechin parameters fitted jointly across seven published methods, then calibrated per column.** No measured retention against composition is open. The joint fit gives the only available estimate of S; per-column calibration reproduces each source method. Leave-one-method-out error is published in the application.

**2026-11-13. Generic column names in the interface.** The source column is named in each column's provenance note. Parameters fitted from one paper's methods should not be presented as a description of a commercial product.

**2026-11-13. Acidic-cannabinoid pH response digitized from a published figure.** It exists in no table. The digitization was validated against the same paper's tabulated values.

**2026-11-13. Where a source's legend and its plotted points disagree, the points are used** and the disagreement is recorded in the provenance note.

**2026-11-13. One unresolved literature discrepancy is shown, not hidden** (resolution of CBDA and CBG in Owolabi 2025, Section 2.3).

**2026-11-13. The instructor key is in the page.** A static site cannot keep it secret. The mitigation is the notebook file, which records every injection, and saying so plainly.

**2026-11-13. No generated imagery.**

**2026-11-13. Two adversarial reviews before release; findings fixed and pinned by tests** (`tests/review.test.ts`, `e2e/regressions.spec.ts`). The main ones: peak height and width are measured on the recorded signal, not a smoothed copy; detection limits under weighted regression use the response standard deviation at the lowest standard; thermal reactions apply only to a heat stress; processing choices are part of the notebook; a label names exactly one peak; notebook files are validated field by field.

**2026-11-13. No temperature selectivity.** Each case uses one enthalpy. The alternative, giving compounds different assumed values, would manufacture selectivity effects with no data behind them.

**2026-11-13. The truth stays log-linear, and the application says so.** The published cannabinoid data is linear over its range and curvature made the catechin fit worse. Inventing curvature to make the student's fit less perfect was rejected; the limit is disclosed on the Fit and predict tab.

**2026-11-13. The anomalous C18 column is not offered to students.** One source method implies retention several times higher than any other C18 in the set. It stays in the joint fit and in the literature checks.

**2026-11-13. Plate numbers are calibrated to one published table, and labelled as calibration.**

**2026-11-13. Proper unit symbols** (µ, °) in interface text. The house rule excludes dashes, curly quotes and emoji, not unit signs.

**2026-11-13. three.js for the visual layer, not a game engine.** The owner asked to move beyond flat pages toward something more like an instrument (three.js or Godot). three.js was chosen because the engine is TypeScript and runs unchanged beside it, the site stays static, the download stays small (three.js is fetched only when a drawing is shown), and the forms and tables remain as the accessible route. A Godot web export would have meant porting or bridging the engine and giving up keyboard and screen-reader access.

**2026-11-13. The instrument drawing is generic by design.** Modules are plain boxes with this project's own palette, name plates and readouts. It represents the class of instrument (reservoirs, pump, autosampler, column oven, detector), not a product. Panels show only what an operator sees; the inside of the column is never drawn, because that would hand the student the answer.

**2026-11-13. Colour in the run comparison always has a text twin.** Each trace carries its run number in the drawing and a row in the table under it.

**2026-11-13. The drawing is operable, and the form stays an equal route.** Knobs, buttons and the vial tray on the drawing change the same method the form edits; neither holds state of its own. The drawing covers the settings an instrument front panel would carry. The full gradient table, sample preparation, replicates and stress conditions stay in the form, which is also the keyboard and screen-reader route. Knobs turn by sideways drag or scroll so that a vertical swipe on a phone still scrolls the page.

**2026-11-13. Buffers do only what is certain.** A buffer choice was added for solvent A, on the drawing's reservoir and in the form. It affects whether pH is held, the UV background, and whether the mass detector may be used. Giving each buffer its own effect on selectivity was rejected: there is no open data for it here. The cannabinoid case now allows pH up to 5.5 so that leaving the formate range is possible; the retention data itself covers pH 3.0 to 3.8 and the case says so.

**2026-11-13. Moving parts show the order of events, not the chemistry.** The needle samples the chosen vial, the oven door opens when the oven is looked at or the column changes, and beads move through the tubing while a run is replayed, tinted by composition downstream of the pump. The tubing follows the real order of flow. Nothing is drawn inside the column. All of it is skipped under reduced motion.

**2026-11-13. The mark is three peaks that read as an M.** Eight concepts were generated as images to choose a direction; the one chosen was then drawn from scratch as vector by `tools/make-logo.ts`, as the sum of three Gaussians on a baseline. No generated image is shipped: the concept images stay out of the repository, and the earlier rule of no generated imagery in the tool itself stands.
