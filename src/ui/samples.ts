// Sample notebooks shipped with the site, for a quick look at a finished piece of work.

import type { App } from "./app.ts";

export const SAMPLES: ReadonlyArray<{ id: string; title: string; about: string }> = [
  { id: "hemp-full-exercise", title: "Hemp: a complete exercise", about: "39 injections. Six-level calibration, six replicates, a blank, six sample preparations, nine spiked samples, three stressed standards and eight deliberate variations. Open Quantitation, Suitability and validation, and Report." },
  { id: "greentea-scouting-and-fit", title: "Green tea: scouting and model fitting", about: "9 injections. An unretained marker, two scouting gradients with every peak named, single standards, and a predicted method. Open Fit and predict and tick runs 2 and 3." },
  { id: "greentea-coeluting-interferent", title: "Green tea: a hidden co-eluting interferent", about: "16 injections. The same lot quantified under the starting gradient, where EGCG reads about 10% high, and under a shallower one, where the interferent separates. Open Compare runs and Quantitation." },
];

/** Fetch a sample notebook and make it the current one. Throws with a readable message on failure. */
export async function loadSample(app: App, id: string): Promise<void> {
  if (!SAMPLES.some((s) => s.id === id)) throw new Error("There is no sample notebook by that name.");
  const res = await fetch(`./examples/${id}.json`);
  if (!res.ok) throw new Error("The sample notebook could not be fetched.");
  app.importSession(await res.text());
}
