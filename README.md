# Method Bench

An open reversed-phase LC method-development simulator for teaching. Students make the decisions a chromatographer makes (column, gradient, pH, temperature, flow, detector), run injections that cost instrument time, read chromatograms that are not labelled for them, fit a retention model from their own scouting runs, and take a method through system suitability, calibration, quantitation of an unknown, and the validation characteristics of ICH Q2(R2).

It runs entirely in the browser. There is no server, no account and no tracking.

Two cases ship in version 0.9:

- **Green tea catechins.** Eight catechins and caffeine in a leaf extract with a label claim. Three C18 columns and a PFP phase in two formats.
- **Hemp cannabinoids.** Ten acidic and neutral cannabinoids in milled flower, with a total-THC compliance decision. Four stationary phases.

## What makes it different from a slider demo

- **The model is hidden and experiments cost something.** Peaks are not named. The student injects standards to identify them, and builds a retention model from two or more of their own runs. The true parameters appear only in a debrief, and opening the debrief is recorded.
- **The signal is integrated, not looked up.** A detector trace with noise, drift and tailing is synthesized, then a peak-detection routine that sees only the trace integrates it. Co-elution, a sloping baseline or a wide calibration range corrupt results the way they do on an instrument.
- **Every number says where it came from.** Each parameter is labelled reported, digitized, fitted or assumed, with its source. The application has a page that states what it cannot tell you.
- **It is checked against the literature in the open.** Published methods are re-run in the simulator and the differences are shown, including the ones that do not agree.
- **Each student gets their own unknown.** An assignment code fixes the sample and all noise. An instructor page regenerates the key. The notebook file reproduces every number on any machine.

## What it is not

A teaching instrument. It is not a substitute for commercial method-modelling software, it controls no instrument, and nothing in it should be used to justify a regulated method. Commercial tools for professional method development exist and are worth paying for. This project implements published science with openly licensed data and copies no vendor's code, data, interface or terminology.

Read `docs/MODEL.md` and `docs/DATA.md` before relying on any number. The short version: cannabinoid retention is built on published measurements; catechin retention is fitted to retention times from published methods because no open measurements of retention against solvent composition exist. A method left out of the fit is predicted with an rms error of 4 to 16 percent in retention time once its column strength is fitted, with single compounds off by up to 31 percent. Temperature selectivity is not modelled in either case.

## Run it

```sh
npm install
npm run dev        # development server
npm run test:run   # engine, data and scripted-student tests
npm run build      # static site in dist/
npm run e2e        # browser tests, accessibility scan, phone-width checks
```

The data set in `src/data/` is generated. To rebuild it from the transcribed tables:

```sh
node tools/fit-catechins.ts
node tools/fit-cannabinoid-ph.ts
node tools/build-data.ts
```

## Layout

| Path | What |
|---|---|
| `src/engine/` | Pure, deterministic numerics. No DOM. Retention, gradient migration, band broadening, detector, integration, calibration statistics, model fitting. |
| `src/lab/` | The teaching layer: cases, sample preparation, degradation, the notebook, quantitation and validation derived from it. |
| `src/data/` | Generated data set with a provenance record on every value. |
| `src/ui/` | Views. No framework. `src/ui/three/` holds the two WebGL views (three.js, loaded on demand): an operable drawing of a generic instrument (knobs for flow, gradient, injection volume, temperature and wavelength; a vial tray; column swap; an Inject button) with live front-panel readouts, and a colour-mapped comparison of runs that opens from an overlay into a waterfall. |
| `tools/` | Transcribed source tables, fitting scripts, the data build. |
| `tests/`, `e2e/` | Golden tests, literature reproduction, a scripted student, regression tests from two adversarial reviews, browser and accessibility tests. |
| `docs/` | Model, data provenance, instructor guide, decisions. |

## For instructors

See `docs/INSTRUCTOR.md`. In brief: hand out assignment codes, ask for the printed report and the notebook file, and use the Instructor tab for the key. The key is in the page source, as it must be for a static site, and a student can restart a notebook; the notebook file records every injection and every processing choice, which shows whether a result was earned.

## Contributing data

The most useful contribution is measured retention data. For catechins on C18, isocratic retention factors at three or four acetonitrile fractions and two temperatures would replace every fitted and assumed value in that case. The data schema (`src/engine/types.ts`, `RetentionParams`) takes measured values without code changes.

## Patents

Software patents exist in the general area of chromatographic method development, among them US 12,693,275 (Shimadzu) and US 9,958,423 (Biotage). This project controls no instrument, and its resolution survey follows the window-diagram method published by Laub and Purnell in 1975. That is the author's reading, not legal advice. If you plan to build a commercial product on this code, take advice.

## Licence

Code: MIT (`LICENSE`). Data, documentation and teaching text: CC BY 4.0 (`LICENSE-DATA.md`).

John Courie, 2026. Built with Claude.
