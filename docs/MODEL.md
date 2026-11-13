# Model

What the engine computes, the equation behind each part, and where the equation was checked. Status words:

- **Verified**: read at the cited source while building this project.
- **Secondary**: read in a named source that restates the original.
- **Standard**: a textbook relation implemented from general knowledge and tested here against a closed-form result; the original paper was not opened.
- **Heuristic**: a plausible shape with no published model behind it. Labelled as such in the application.

Units inside the engine: time in min, volume in mL (injection in uL), length in mm, particle size in um, temperature in degC (K in thermodynamic terms), composition `phi` as organic volume fraction, pressure in bar, absorbance in mAU.

## 1. Retention against composition

`ln k = ln kw - S phi` (linear solvent strength). **Verified**: den Uijl, Schoenmakers, Pirok, van Bommel, J Sep Sci 2021, 44, 88, Eq. 6 (CC BY).

The engine carries the Neue-Kuss form, `ln k = ln kw + 2 ln(1 + S2 phi) - S1 phi / (1 + S2 phi)` (**verified**, same review, Eq. 11; note that the review swaps the labels S1 and S2 between its text and that equation). With `S2 = 0` it reduces to the linear model. All shipped data uses `S2 = 0`: a shared curvature term was tried in the catechin fit and made it worse (`tools/fit-catechins.ts --s2=`).

Code: `src/engine/retention.ts`.

## 2. Temperature

`ln k(T) = ln k(Tref) - (dH / R)(1/T - 1/Tref)`, with `dH` allowed to depend linearly on `phi`. **Standard** (van 't Hoff). Golden test: `tests/engine.test.ts`, "van 't Hoff".

## 3. Ionization

For a monoprotic acid, `k = k_HA (1 + r x) / (1 + x)`, `x = 10^(pH - pKa')`, `r = k_A / k_HA`. This is the mole-fraction-weighted mean of the two forms. **Standard** (Horvath, Melander, Molnar, Anal Chem 1977). `pH` is the pH of the aqueous component before mixing, and `pKa'` is an apparent value on that scale. The engine allows `pKa'` to shift linearly with `phi`; no correlation for that shift could be verified, so shipped values are either assumed (gallic acid, the catechin phenols) or zero (acidic cannabinoids, whose apparent pKa was fitted at one composition per column).

## 4. Migration and band width under any programme

State: `x`, the band centre as a fraction of column length, and `v`, its spatial variance.

```
dx/dt = u,                    u = 1 / (t0 (1 + k(phi_local)))
phi_local = programme(t - tD - x t0)
dv/dt = u h + 2 v du/dx,      du/dx = (k / (1 + k)^2) (d ln k / d phi) (d phi / d tau)
sigma_t = sqrt(v) t0 (1 + k_elution)
```

The first line is the general gradient retention integral (**verified** in integral form: den Uijl 2021, Eq. 3). The variance equation adds plate dispersion and the velocity gradient along the band, which is what compresses a band in a rising gradient. It is derived here and tested against two closed forms:

- Isocratic: `tR = t0 (1 + k)`, `sigma = tR / sqrt(N)`.
- Linear gradient, LSS, no dwell: the band compression factor `G^2 = (1 + p + p^2/3) / (1 + p)^2`, `p = k0 b / (1 + k0)`, `b = S (d phi/dt) t0`. **Secondary**: Hao, Liu, Shen, Se Pu 2021 (CC BY), restating Poppe, Paanakker, Bronckhorst 1981. The numerical result agrees to better than 1%.

Retention time alone is also computed exactly for LSS by integrating segment by segment (`lssProgramTime`) and by quadrature for any model (`programTime`); the three solvers are tested against each other and against the closed-form single-gradient solution with dwell.

Injection: the plug occupies `Vinj / V0` of the column shortened by `1 + k` in the sample diluent, with variance `width^2 / 12` (ideal plug; **secondary**, Stoll and Broeckhoven, LCGC 2021, who note that real injectors behave worse). This gives on-column focusing in weak diluent and band broadening in strong diluent.

Code: `src/engine/gradient.ts`, `src/engine/simulate.ts`.

## 5. Mobile phase

Viscosity: `ln eta = phi (a_o + b_o/T) + (1 - phi)(a_w + b_w/T) + phi (1 - phi)(a_x + b_x/T)`. **Heuristic coefficients**: chosen here to reproduce pure-solvent viscosities at 25 and 60 degC and the known mixture maxima at 25 degC. No open table of mixture viscosity against composition and temperature was obtained, and the widely used correlation in an existing open simulator is under a non-commercial licence, so it was not used. Viscosity affects only pressure and diffusion.

Diffusion: Wilke-Chang, `D = 7.4e-8 sqrt(psi M) T / (eta V^0.6)` in cm2/s. **Secondary** (Chen, Mass Spectrom 2019). Association factors 2.6 (water), 1.9 (methanol), 1.0 (acetonitrile); sources disagree on the acetonitrile value. Solute molar volume is estimated as 0.95 cm3/mol per g/mol.

Background absorbance of solvent B: an exponential tail from the UV cutoff. **Heuristic**.

Buffers in solvent A (`BUFFERS` in `src/engine/tunables.ts`): formate, acetate and phosphate, each with the pH ranges it buffers (about one unit either side of a pKa: 3.75, 4.76, and 2.15 and 7.20), a low-wavelength absorbance, and whether it is volatile. **Standard** for the pKa values, the one-unit rule and the non-volatility of phosphate; **heuristic** for the absorbance magnitudes and for the run-to-run pH scatter (0.01 inside the range, 0.12 outside). Three effects follow: a method that sends phosphate to the mass detector is refused; outside the buffer's range the pH at the column wanders between runs, which shows as irreproducible retention of ionizable compounds; and because the buffer is in A only, a gradient at low wavelength drifts downward as A is replaced. The buffer has no other effect on retention: buffer-specific selectivity and ionic strength are not modelled.

## 6. Efficiency and pressure

Reduced van Deemter, `h = A + B/nu + C nu`, `nu = u_e d_p / D_m`. **Standard**. Coefficients are typical values by particle class (fully porous 1.0, 2.5, 0.08; superficially porous 0.7, 2.0, 0.05); no open coefficient set for superficially porous particles was found. The superficially porous coefficients, the peak-tailing spread and the HPLC's extra-column term were then adjusted so that plate numbers measured from the simulated peak table (5.54 (tR / w_h)^2) fall within about 10% of the seven published values for neutral cannabinoids on the C18 column (Owolabi 2025, Supplementary Table S4). That is calibration to one table, not a prediction.

Dead volume: total porosity times the empty-tube volume (0.62 fully porous, 0.52 superficially porous; assumed).

Pressure: Kozeny-Carman, `dP = 180 eta u L (1 - e)^2 / (e^3 d_p^2)` with interstitial porosity 0.40, plus a small system term. **Standard**.

Extra-column: a fixed volume variance per instrument divided by flow squared, added to the column variance; the detector time constant adds an exponential tail. **Secondary** (LCGC 2021). The HPLC instrument's value (25 uL2) is part of the calibration to Owolabi 2025, Supplementary Table S4 described above; it is an estimate for that kind of instrument, not a measurement of one.

## 7. Peak shape

Exponentially modified Gaussian, evaluated through the scaled complementary error function for stability. **Secondary** (Kalambet 2011, via a restatement). Each solute has a tail constant proportional to its Gaussian width.

Mass overload adds tail and moves the apex earlier. **Heuristic**: right direction and order of magnitude, no isotherm model.

## 8. Detectors

UV: `area = eps b n / F`. Spectra are sums of Gaussian bands. Total absorbance passes through a stray-light term, `A_obs = -log10((10^-A + s) / (1 + s))`, which bends the response above about 1.5 AU. **Standard**. Noise has a fast white part that scales with the square root of the data rate, a slow part with a few seconds' memory (lamp, cell, pump ripple), and a random walk; all grow as the mobile phase absorbs. The slow part matters: with white noise alone, area precision near the quantitation limit comes out several times better than on a real instrument. Its size is assumed. A small solvent-front disturbance appears at the dead time, larger when the sample diluent differs from the eluent (**heuristic**). Seeded, so every re-run of a notebook gives the same trace.

Each injection also carries autosampler imprecision (0.3% RSD) and small run-to-run variation in flow (0.07%) and oven temperature (0.1 degC), which is what makes replicate retention times scatter. Typical values, assumed.

MS (single quadrupole, selected ion): response proportional to moles for ions within 0.5 Da of the selected m/z, with counting noise, a run-to-run source variation of 4% RSD, and saturation at high count rates. Isomers respond on the same channel. A co-eluting matrix compound can suppress response. Response factors, source variation and the saturation level are assumed; adducts, in-source fragmentation and ionization chemistry are not modelled.

## 9. Integration and peak metrics

`src/engine/integrate.ts` works on the sampled trace only. Peaks are found on a lightly smoothed copy (about a quarter of a second): a morphological baseline, clusters standing above it, each cluster extended until the trace has settled back to the baseline, a straight baseline under each cluster, apexes separated by real valleys, perpendicular drops at valleys. Height and widths are then measured on the recorded signal, smoothed only over a window that scales with the peak's own width, with the small broadening from that smoothing removed. A peak that the run starts or ends inside is flagged as cut off.

Definitions follow the harmonized pharmacopoeial chromatography chapter (**verified** in the Pharmacopoeial Discussion Group sign-off text for G-20 Chromatography, 2021, with its 2023 correction; the current USP <621> and Ph. Eur. 2.2.46 texts themselves were not read):

- Resolution `Rs = 1.18 (tR2 - tR1) / (w_h1 + w_h2)`
- Plate number `N = 5.54 (tR / w_h)^2`
- Symmetry factor `As = w_0.05 / (2 f)`
- Signal to noise `S/N = 2 H / h`

The engine takes `h` as six times a robust standard deviation of the baseline about its trend over the whole run, not the range over twenty peak widths that the chapter specifies. In a gradient run the plate number is only apparent and is not judged against a suitability criterion.

## 10. Calibration statistics

Unweighted and weighted (1/x, 1/x2) least squares, residual standard deviation, standard errors, and the standard inverse-prediction interval for an unknown from `m` replicate responses. **Standard**; worked example in `tests/engine.test.ts`. Detection and quantitation limits `3.3 sigma / S` and `10 sigma / S` (**verified**: ICH Q2(R2), EMA Step 5 text, section 3.2.3). `sigma` is the residual standard deviation for an unweighted fit. For a weighted fit the residual standard deviation is in weighted units, so it is converted to response units at the lowest standard, `s / sqrt(w(x_low))`.

## 11. The student's fit

`src/engine/fit.ts` fits `ln kw` and `S` per named peak to retention times from two or more runs by Gauss-Newton on retention time, using the exact LSS solver, the instrument's dwell volume and a column volume the student supplies. The survey map evaluates the critical resolution of the fitted peaks over gradient time and starting composition. This is the window-diagram idea (Laub and Purnell, 1975) applied to a fitted LSS model. It sees only peaks the student named. A fit is refused when the runs do not put the peak at clearly different compositions, when the peak elutes at the column dead time, or when the result is not a possible retention model.

Because the simulator's own retention model is log-linear, a two-run fit predicts a third run almost exactly once the column volume is right. On an instrument, curvature of ln k against composition makes such predictions worse far from the fitted conditions. The application says this on the Fit and predict tab.

## What is not modelled

Temperature selectivity (one enthalpy per case), curvature of ln k against composition, analyte travel inside a large plug of strong sample solvent (the application warns when an injection is in that region), stationary-phase ageing and batch variation, slow equilibration and pH hysteresis, buffer capacity and ionic strength, viscous fingering from sample solvent, system peaks, carry-over, adsorption on hardware, temperature gradients in the column, frictional heating, pump mixing volume beyond a pure delay, and anything about ion-source behaviour beyond a response factor.
