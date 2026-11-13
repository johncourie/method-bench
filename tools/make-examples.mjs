// Builds the sample notebooks in public/examples/ by driving the built app in a browser,
// so each file is exactly what the app itself would save. Peaks are named from the true
// peak list, standing in for a student who identified them with single standards.
// Run: npm run build && npx vite preview --port 5184 --strictPort &   then   node tools/make-examples.mjs
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const out = new URL("../public/examples/", import.meta.url);
const browser = await chromium.launch();

async function build(name, caseId, code, instrument, student, script) {
  const page = await browser.newPage();
  await page.goto("http://localhost:5184/");
  const json = await page.evaluate(
    ({ caseId, code, instrument, student, script }) => {
      const app = window.methodBench;
      app.reset(caseId, code, instrument, student);
      const c = app.lab.case;
      const all = (x) => Object.fromEntries(c.analytes.map((id) => [id, x]));
      const base = structuredClone(c.defaultMethod);
      const api = {
        c,
        base,
        all,
        with: (m, change) => ({ ...structuredClone(m), ...change }),
        inject: (method, spec, diluent = c.diluentPhi) => {
          const r = app.lab.inject(method, spec, diluent);
          const ex = app.lab.execute(r);
          for (const p of ex.integration.peaks) {
            const near = ex.result.peaks.filter((t) => t.eluted && t.area > 0).sort((a, b) => Math.abs(a.tR - p.tR) - Math.abs(b.tR - p.tR))[0];
            const s = near && app.catalog.solutes.get(near.soluteId);
            if (near && s && !s.hidden && Math.abs(near.tR - p.tR) < 0.15) app.lab.label(r.id, p.tR, near.soluteId);
          }
          return r;
        },
        std: (levels, prep = 1, stress) => ({ kind: "standard", levels, prep, ...(stress ? { stress } : {}) }),
        sample: (prep, extra = {}) => ({ kind: "unknown", prep, mg: c.product.prepMg, ml: c.product.prepMl, dilution: 1, ...extra }),
        analysis: app.lab.session.analysis,
      };
      new Function("api", script)(api);
      return { json: app.exportSession(), runs: app.lab.session.runs.length, ledger: app.lab.ledger() };
    },
    { caseId, code, instrument, student, script },
  );
  writeFileSync(new URL(name, out), json.json);
  console.log(`${name}: ${json.runs} injections, ${(json.ledger.minutes / 60).toFixed(1)} h, ${(json.json.length / 1024).toFixed(0)} KB`);
  await page.close();
}

// 1. A complete hemp exercise: calibration, replicates, blank, preparations, spikes, stress, robustness.
await build("hemp-full-exercise.json", "cannabis", "SAMPLE-HEMP-1", "uhplc", "Sample notebook", `
  const m = api.with(api.base, { columnId: "cb-c18sp", runTimeMin: 13 });
  for (const x of [2, 5, 10, 25, 50, 100]) api.inject(m, api.std(api.all(x)));
  let ref;
  for (let i = 0; i < 6; i++) ref = api.inject(m, api.std(api.all(25)));
  api.inject(m, { kind: "blank" });
  for (let prep = 1; prep <= 6; prep++) api.inject(m, api.sample(prep));
  for (const add of [10, 20, 30]) for (let k = 0; k < 3; k++) api.inject(m, api.sample(1, { spike: { cbd: add, d9thc: add / 10 } }));
  api.inject(m, api.std(api.all(25), 1, { agent: "heat", hours: 1, tempC: 100 }));
  api.inject(m, api.std(api.all(25), 1, { agent: "acid", hours: 24, tempC: 60 }));
  api.inject(m, api.std(api.all(25), 1, { agent: "peroxide", hours: 24, tempC: 25 }));
  for (const change of [{ tempC: 25 }, { tempC: 35 }, { flowMlMin: 0.27 }, { flowMlMin: 0.33 }, { pH: 2.9 }, { pH: 3.1 }, { program: [{ t: 0, phi: 0.68 }] }, { program: [{ t: 0, phi: 0.72 }] }]) api.inject(api.with(m, change), api.std(api.all(25)));
  Object.assign(api.analysis, { refRun: ref.id, solute: "cbd", weighting: "1/x" });
`);

// 2. Green tea scouting: marker, two gradients, single standards for identification, a predicted method.
await build("greentea-scouting-and-fit.json", "greentea", "SAMPLE-TEA-1", "hplc", "Sample notebook", `
  const grad = (tg) => api.with(api.base, { program: [{ t: 0, phi: 0.05 }, { t: tg, phi: 0.4 }], runTimeMin: tg + 8 });
  api.inject(grad(20), api.std({ uracil: 20 }));
  api.inject(grad(20), api.std(api.all(50)));
  api.inject(grad(60), api.std(api.all(50)));
  for (const id of ["caf", "egcg", "ec", "ecg"]) api.inject(grad(20), api.std({ [id]: 50 }));
  api.inject(api.with(api.base, { program: [{ t: 0, phi: 0.08 }, { t: 24, phi: 0.3 }], runTimeMin: 32 }), api.std(api.all(50)));
  api.inject(grad(20), api.sample(1));
`);

// 3. Green tea lot with the hidden co-eluting interferent: the starting gradient reads EGCG high, a shallower one separates it.
const interferent = await (async () => {
  const page = await browser.newPage();
  await page.goto("http://localhost:5184/");
  const code = await page.evaluate(() => {
    const app = window.methodBench;
    for (let i = 1; i < 500; i++) {
      app.reset("greentea", "SAMPLE-TEA-X" + i, "hplc", "");
      const ex = app.lab.execute(app.lab.inject(app.lab.case.defaultMethod, { kind: "unknown", prep: 1, mg: 25, ml: 50, dilution: 1 }, 0.05));
      if (ex.result.peaks.some((p) => p.soluteId === "gtx")) return "SAMPLE-TEA-X" + i;
    }
    return null;
  });
  await page.close();
  return code;
})();
await build("greentea-coeluting-interferent.json", "greentea", interferent, "hplc", "Sample notebook", `
  const start = api.base;
  const shallow = api.with(api.base, { program: [{ t: 0, phi: 0.05 }, { t: 60, phi: 0.4 }], runTimeMin: 68 });
  let ref;
  for (const m of [start, shallow]) {
    for (const x of [10, 50, 100, 200, 300]) api.inject(m, api.std({ egcg: x, caf: x / 5, ecg: x / 4 }));
    api.inject(m, { kind: "blank" });
    for (const prep of [1, 2]) ref = api.inject(m, api.sample(prep));
  }
  Object.assign(api.analysis, { refRun: ref.id, solute: "egcg", weighting: "1/x" });
`);
console.log("interferent code:", interferent);
await browser.close();
