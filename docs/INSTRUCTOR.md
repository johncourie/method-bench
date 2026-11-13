# Instructor guide

## Setting an exercise

1. Open the Instructor tab and choose the case. Generate a list of assignment codes, or make up your own: any text works.
2. Give each student a code. The code fixes that student's unknown sample, its hidden situation, and all detector noise. The same code always gives the same sample.
3. Tell students which instrument to use if you want results to be comparable.
4. Ask for two things: the printed report (Report tab, print or save as PDF) and the notebook file (Setup tab, Download notebook).

The key table lists, for each code, the hidden situation, the true extraction recovery, and the true content of each analyte as the lot reached the student (after anything in its hidden history).

## Hidden situations

Each code lands on one of four situations per case, chosen by the code itself. Generate a batch and read the key if you want a particular mix. A situation is not announced to the student: finding it is the exercise.

Green tea: an unremarkable lot; a matrix compound that co-elutes exactly with EGCG under the starting gradient (so the purity check across the peak passes), shows as an extra band near 325 nm in the peak spectrum, has a different mass, and moves away when the gradient slope changes; a lot that was held warm, so EGCG has partly epimerized to GCG; an under-strength lot with added caffeine.

Hemp: an unremarkable lot; a lot whose total THC is over the limit only if THCA is counted; a lot stored in light, with THC partly oxidized to CBN; a lot containing d8-THC, which has the same mass as d9-THC and elutes beside it.

## Marking

A student's result will be lower than the true content by the extraction recovery (92 to 99%) unless they determine recovery by spiking and correct for it. Decide in advance whether you expect that.

Things the notebook shows that the report alone does not:

- The number of injections, the instrument time and the solvent used.
- Whether the debrief was opened, and after how many injections.
- Whether the student identified peaks by injecting standards or guessed.
- Every method they tried.

Load a student's notebook file on the Setup tab to see exactly what they saw: the file carries their processing choices (reference method, weighting, area or height, excluded points, integration threshold, suitability criteria) as well as every injection. The fingerprint on the report matches the fingerprint you get from the same file.

## What the tool cannot stop

This is a static web page. The instructor key is computed in the browser from the code, so a student who reads the source, or who simply opens the Instructor tab, can see it. The page asks them not to, and the notebook records what they actually did. A student can also start a fresh notebook under the same code, which clears the record that the debrief was opened, and the fingerprint is a checksum that ties a report to a file, not a seal. If the answer must be secret, mark the method and the reasoning rather than the number.

## Suggested exercises

Each fits one or two hours.

1. **Scouting.** Starting from the given method, identify every peak with as few injections as possible. Hand in the peak table and the injection count.
2. **Model and predict.** Run two scouting gradients, fit the retention model, predict a method with critical resolution of at least 2.0 and the shortest run time you can find, then inject it. Report predicted and observed retention times and explain the difference. (Measuring the column volume with the unretained marker, rather than using the estimate, is the point most students miss.)
3. **Selectivity.** Hemp case: find conditions that resolve d9-THC from d8-THC and CBDA from its neighbours on two different columns. Explain which variable did the work.
4. **Calibration.** Calibrate over a hundredfold range. Compare unweighted, 1/x and 1/x2 fits using the residual plot, and state which you would use for a minor analyte and why.
5. **Is the method stability-indicating?** Stress a standard and the sample under acid, base, oxidation, heat and light. Show whether degradation products are resolved from the analytes, using spectra and, where it helps, the mass detector.
6. **The lot decision.** Full exercise: develop, show suitability, validate what you can, quantify, and write one paragraph that accepts or rejects the lot and says how sure you are.

## Accessibility

Every chart has a table carrying the same information. All controls work from the keyboard; charts zoom with plus and minus and pan with the arrow keys. The pages are scanned automatically for WCAG 2.1 AA violations at desktop and phone widths in both themes as part of the test suite. An automated scan is not a substitute for testing with the people who will use it.
