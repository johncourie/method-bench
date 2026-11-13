# Data and provenance

Every value in `src/data/*.json` carries a provenance record: a basis, a reference key, and usually a locus and a note. The application shows these under Model and limits. This file explains how each group of values was obtained and what is weak about it.

Basis words:

- **reported**: printed in the source.
- **digitized**: read from a published figure by the method described below.
- **fitted**: computed for this project from reported numbers.
- **assumed**: a typical value with no measurement behind it.

Rules followed: only openly licensed sources (CC BY or public domain) were transcribed. Two exceptions use isolated facts from sources that are not Creative Commons, and are flagged below. No vendor software, database or application note was used as a data source. Nothing was taken from the open simulators and column database that are under non-commercial licences.

The transcriptions live in `tools/catechin-methods.ts` and `tools/cannabinoid-data.ts`. The build is reproducible: `node tools/fit-catechins.ts && node tools/fit-cannabinoid-ph.ts && node tools/build-data.ts`.

## Cannabinoids

### Retention against acetonitrile, four columns: reported

Owolabi et al., Molecules 2025, 30, 758 (CC BY 4.0). Four 150 x 2.1 mm, 2.7 um superficially porous columns at 30 degC, isocratic acetonitrile with 0.02% formic acid.

- Retention factors at 70.0% acetonitrile: Tables 1 and 2.
- Slope of log k against acetonitrile volume fraction: legends of Figures 1 and 2. Units were confirmed by digitizing the figures (per unit fraction, not per percent).
- `ln kw` is the published k at 70% extended to zero with the published slope. It is an extrapolation parameter, not a measurement at 0% acetonitrile. The data covers about 57.5 to 80%; the application flags runs outside 55 to 85%.

Three problems in the source, and what was done:

1. The legend of Figure 1, panel D (amide column, neutral cannabinoids) repeats the slopes of panel A. The plotted points differ. Slopes for that panel come from the plotted points (basis: digitized).
2. Figure 2, panel A gives -3.97 for THCA; the three visible points give -4.14. The points are used.
3. Section 2.3 reports a resolution of 1.48 for CBDA and CBG in the final two-column method. The same paper's tables and Figure 4 give those two compounds a selectivity of about 1.18 under those conditions, which cannot give so small a resolution at the plate numbers the paper reports. The simulator follows the tables. The discrepancy is shown in the application and is not resolved.

The columns are given generic names in the application. The source columns are named in each column's provenance note.

### pH response of the acidic cannabinoids: digitized

Owolabi 2025, Figure 4, exists only as a figure. Its points were located by fitting marker discs of exact series colour on the published image, with axes calibrated on all labelled gridlines. The same code applied to Figures 1 and 2 reproduces the tabulated k at 70% to a mean of 0.0006 and a maximum of 0.0033 log units over 69 points, so the stated uncertainty of 0.003 log units for a fully visible marker is measured, not guessed. Points: `tools/data/figure4_pH.json`.

`tools/fit-cannabinoid-ph.ts` fits an apparent pKa per acid per column (residuals up to 0.013 log units). Weaknesses:

- Each series spans pH 2.97 to 3.38 (to 3.80 on the amide column) at one acetonitrile content. The fitted pKa is an apparent value at that composition on the aqueous pH scale. How it moves with composition is unknown and is taken as zero.
- The retention of the anion cannot be determined from so narrow a range. It is assumed to be 3% of the neutral form.
- Tables 1 and 2 were measured in 0.02% formic acid, whose pH the paper does not report. Requiring the tables to agree with the pH series gives pH 3.02 (median of ten series, range 2.88 to 3.49). That value is used to convert the tabulated k to the neutral-form k.

Beyond pH 4 the model is an extrapolation.

### Temperature: one value, no selectivity

Analakkattillam et al., Sci Rep 2022, 12, 12453 (CC BY 4.0), Table 3, gives retention of CBD and d9-THC at 20, 25 and 30 degC on a different C18. The implied enthalpies are small: -2.3 and -3.6 kJ/mol, about 0.3 to 0.45% in retention per degree, which is less than many chromatographers would expect and rests on a robustness table. Their mean, -3 kJ/mol, is used for every cannabinoid. Two numbers from another column are no basis for temperature selectivity, so none is modelled.

### UV response: fitted to reported responses

- Shape for the neutral cannabinoids: three Gaussian bands fitted to the reported CBD peak area at 214, 228, 230, 240 and 280 nm (Sci Rep 2022, Table 1b).
- Relative magnitude at 220 nm for all ten compounds: calibration slopes in Mandrioli et al., Molecules 2019, 24, 2113 (CC BY 4.0), converted from mass to molar.
- Band positions for CBN and the acids, and the absolute scale (log eps 4.57 for CBD at 207 nm): Hazekamp et al., J Liq Chromatogr 2005, as reproduced in a Leiden University thesis. **This source is not Creative Commons.** Only band positions and one molar absorptivity are used, as published physical constants; no table or figure is reproduced. If that is not acceptable for a particular use, replace the absolute scale with any value: it changes peak heights and nothing else.

### Decarboxylation: reported

Wang et al., Cannabis Cannabinoid Res 2016, 1, 262 (CC BY 4.0), Table 2: first-order rate constants at 80 degC and activation energies for THCA, CBDA and CBGA. Measured on dried extract in a vacuum oven, not in solution. The table heads the constants "per second" while the text speaks of minutes; per second is used because it gives the half-lives the paper describes. They are applied only to a heat stress: carried down to room temperature they would predict a THCA half-life of days to weeks, which the data does not support. All other cannabinoid reactions (acid conversion of CBD, oxidation of THC to CBN, formation of quinone degradants) are real pathways with assumed rates. The quinone degradant is one stand-in peak with an assumed retention and spectrum.

### Checks

Shown in the application, each with a note saying whether the published number was used to set the model. Not used in any fit: the slope of log k against acetonitrile for CBD on an unrelated C18 (-3.77 against -3.86 here), and a published gradient on a different C18, predicted within a few percent with only the column's strength fitted. Used in calibration, so not evidence: plate numbers on the C18 column. Not reproduced: the CBDA and CBG resolution described above.

## Catechins and methylxanthines

### Retention: fitted, because nothing better is open

No open source reports retention factors against solvent composition, or against temperature, for the tea catechins. What exists is single methods with retention times. Seven published C18 methods (acetonitrile, acidified water) were used:

| Key | Column in the source | Analytes |
|---|---|---|
| heliyon2024 (fit only, not offered to students) | 250 x 4.0 mm, 5 um | 11 |
| molecules2021-3485 (Table S1) | 250 x 4.6 mm, 4 um superficially porous | 9 |
| pedan2018 | 150 x 3.0 mm, 3.5 um | 11 |
| xiao2021 | 100 x 2.1 mm, 1.7 um | 12 |
| jin2019 | 100 x 2.1 mm, 1.8 um | 9 |
| chen2018 | 100 x 2.1 mm, 1.8 um | 8 |
| foods2026 | 50 x 4.6 mm, 2.7 um superficially porous | 3 |

The Heliyon paper is CC BY-NC-ND; only its method conditions and retention times, which are facts, are used. All others are CC BY.

Model: `ln k = ln kw_i - S_i phi + delta_m`, with `ln kw` and `S` belonging to the compound and one strength term per column. `tools/fit-catechins.ts` fits all of it jointly (12 compounds, 7 methods, 63 retention times, 30 parameters) on relative retention-time error.

- Fit quality: 5.3% rms in retention time.
- **Leave one method out** (refit without it, then fit one parameter, its column strength, to the held-out retention times): 4.4, 6.7, 7.4, 9.3, 15.0 and 15.8% rms, with single compounds off by up to 31% and 96 to 100% of pair orders right. This is the accuracy of a prediction on a C18 the model has not seen, and it is after one parameter is fitted to that column.
- For each of the three C18 columns offered to students, `ln kw` is then adjusted per compound so that the source method is reproduced. Agreement with that method is therefore calibration, and the application says so. `S` stays at its jointly fitted value.

Weaknesses that matter:

- `S` is identified only because the methods elute each compound at different compositions on different columns. Column and composition effects are partly confounded. One column (heliyon2024) comes out about four to seven times more retentive than the rest, which is not credible for a C18 phase and more likely reflects something unreported in that method. It is kept in the joint fit, where its compositions help identify S, and shown as a literature check, but it is not the reference for the fit and is not offered to students.
- No source reports dwell volume or column dead time. Dwell is assumed by instrument class and porosity by particle class. Errors in these go straight into the fitted parameters.
- Temperature dependence is assumed (-15 kJ/mol for every compound), so temperature selectivity is not modelled.
- A shared curvature term (Neue-Kuss) made the leave-one-out error worse and was dropped.
- Two sources were examined and not used because their elution orders are implausible or their tables undefined; one more reports a different order for EGCG and EC than the other six, and is kept.

### PFP phase: fitted from two gradients

Cabrera et al., Molecules 2021, 26, 3485 (CC BY 4.0) reports the same nine compounds on a pentafluorophenyl phase under two different gradients and column formats (Table 1 and Supplementary Table S2). Two retention times determine `ln kw` and `S` for each compound exactly, so there is no residual to judge the fit by. The two methods differ in formic acid concentration (2% and 0.1%), which the model ignores.

Gallic acid and theobromine have no published retention on this phase. They are placed using the mean shift of the other nine from C18 to PFP (assumed).

### UV response

Reported: gallic acid, catechin, epicatechin and EGCG (Kaeswurm et al., Molecules 2021, 26, 4656, CC BY 4.0). The others are scaled from calibration slopes at 280 nm in Cabrera 2021, Table S1, relative to catechin. Applied to epicatechin and EGCG, whose values are reported, the scaling rule gives 3764 against 3981 and 11280 against 10735, so it is good to about 5%. Band positions for the scaled compounds, all band widths and the short-wavelength band are assumed.

### Ionization

Gallic acid: aqueous pKa 4.40 (PubChem, CID 370). EGCG and ECG: 7.6 (experimental values quoted in Law et al. 2017, CC BY). Epimers are given the same value. Shift with acetonitrile and anion retention are assumed.

### Degradation

Activation energies for the EGCG and GCG epimerization are published (Wang, Zhou, Wen, J Agric Food Chem 2006; not open access, three numbers from the abstract are cited). The rate constants themselves, and every other catechin reaction, are assumed. The directions are real: epimerization on heating, loss in base and under oxidation, hydrolysis of the gallate esters in acid.

### Matrix compound X and the oxidation stand-in

Matrix compound X is invented for the co-elution exercise, with a hydroxycinnamate-like spectrum so that the purity check and the mass detector can find it. The catechin oxidation product is one stand-in peak for what is really a family of dimers and quinones. Neither is a measured compound, and both are labelled as such in their provenance.

### Peak tailing

No data. Each compound has a fixed tail constant from a spread assigned by name, giving symmetry factors of about 1.03 to 1.10.

## Columns and instruments

Dimensions follow the sources. Porosity, plate-height coefficients, pressure limits, dwell volumes, extra-column variance, detector noise and stray light are typical values (assumed). The superficially porous plate-height coefficients and the HPLC's extra-column variance were adjusted to one published table of plate numbers (see `docs/MODEL.md`, section 6).

## Masses

Formula and molecular weight from PubChem by CID. Monoisotopic masses were calculated from the formula with NIST isotope masses, because PubChem's property service was unavailable when the data was gathered.

## What would improve this most

1. Isocratic retention factors for the catechins on one C18 at three or four acetonitrile fractions and two temperatures. A day's work on an instrument, and it replaces every fitted and assumed retention value in that case.
2. The same with methanol, which would let the simulator offer a second organic modifier honestly.
3. Molar absorptivities for the gallate esters and for d8-THC and CBC from an open source.
4. A pH series for the acidic cannabinoids that reaches pH 5 or 6.
