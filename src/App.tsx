import React, { useMemo, useRef, useState } from "react";
import { parseCSV, computeStates, selectFunctions, Codebook } from "./engine";
import plantCodebook from "./data/codebook_plant.json";
import geologyCodebook from "./data/codebook_geology.json";
import surfaces from "./data/surfaces.json";

type PresetKey = "plant" | "geology";

const PRESETS: Record<PresetKey, { label: string; channels: string[]; sampleCSV: string; note?: string; codebook: Codebook }> = {
  plant: {
    label: "Plant (lum, transpiration, bio_potential, temp)",
    channels: ["lum", "transpiration", "bio_potential", "temp"],
    sampleCSV: `lum,transpiration,bio_potential,temp
150,0.018,0.24,82
160,0.019,0.245,83
170,0.021,0.252,84
180,0.018,0.248,86
190,0.022,0.260,88
200,0.020,0.255,85
210,0.024,0.268,83
`,
    note: "Drifting light + moderate transpiration + gentle temp drift.",
    codebook: plantCodebook as Codebook,
  },
  geology: {
    label: "Geology (seismic, tilt, gas_flux, temp)",
    channels: ["seismic", "tilt", "gas_flux", "temp"],
    sampleCSV: `seismic,tilt,gas_flux,temp
0.005,0.02,400,85
0.006,0.02,405,86
0.009,0.03,420,88
0.004,0.02,398,84
0.012,0.04,460,90
0.003,0.02,390,83
`,
    note: "Seismic variance + flux/temperature coupling.",
    codebook: geologyCodebook as Codebook,
  },
};

export default function App() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preset, setPreset] = useState<PresetKey>("geology");
  const [rawCSV, setRawCSV] = useState(PRESETS["geology"].sampleCSV);
  const [engaged, setEngaged] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PRESETS["geology"].channels.map((c) => [c, true]))
  );
  const [status, setStatus] = useState("Ready. Choose a preset or paste data, then Generate.");
  const [narrative, setNarrative] = useState<string[]>([]);
  const [showAnnotated, setShowAnnotated] = useState(false);

  const activeCodebook = PRESETS[preset].codebook;

  const rows = useMemo(() => {
    const parsed = parseCSV(rawCSV);
    const keys = Object.keys(parsed[0] || {});
    const hasHeader = keys.some((k) => isNaN(Number(k)));
    if (!hasHeader) return parsed;
    const cols = keys.filter((k) => engaged[k]);
    return parsed.map((r) => Object.fromEntries(cols.map((k) => [k, (r as any)[k]])));
  }, [rawCSV, engaged]);

  const states = useMemo(() => {
    if (rows.length === 0) return [] as any[];
    return computeStates(rows as any, activeCodebook);
  }, [rows, activeCodebook]);

  const intents = useMemo(() => states.map((s) => selectFunctions(s, activeCodebook)), [states, activeCodebook]);

  function pickSurface(fn: string, NCV: any) {
    const candidates = (surfaces as any[]).filter(
      (s) => s.binds.function === fn && (!s.binds.mood || s.binds.mood === NCV.mood) && (!s.binds.pov || s.binds.pov === NCV.pov)
    );
    if (candidates.length) return candidates[0].text as string;
    const fallback = (surfaces as any[]).find((s) => s.binds.function === fn);
    return fallback ? (fallback.text as string) : "";
  }

  function onGenerate() {
    if (rows.length === 0) {
      setStatus("No data detected. Paste CSV or use a preset.");
      return;
    }
    const out: string[] = [];
    out.push("Opening: Two figures enter a field of signals. They agree on a destination they cannot yet name.");
    states.forEach((st, i) => {
      const list = intents[i] || [];
      list.forEach((intent) => {
        const line = pickSurface(intent.fn, (st as any).NCV);
        if (line) out.push(line);
      });
    });
    out.push("Closing: They reach the agreed place, carrying what changed them.");
    setNarrative(out);
    setStatus(`Generated ${out.length} lines.`);
  }

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-8">
      <header className="space-y-2 pb-6 border-b border-hair">
        <h1 className="text-3xl font-bold tracking-tight">Cage‑Board — Narrative</h1>
        <p className="text-sm text-neutral-600 max-w-2xl">
          Deterministic story assembly from biodata/geodata using mythic atoms. No ML.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">1) Load data</h2>

            <div className="space-y-2">
              <label className="text-sm font-medium">Profile</label>
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setPreset(k);
                      setRawCSV(PRESETS[k].sampleCSV);
                      setEngaged(Object.fromEntries(PRESETS[k].channels.map((c) => [c, true])));
                    }}
                    className={\`px-3 py-1.5 rounded-full border \${preset === k ? "bg-ink text-white border-ink" : "border-hair hover:bg-hair/30"}\`}
                  >
                    {PRESETS[k].label}
                  </button>
                ))}
                <span className="text-xs text-neutral-500">{PRESETS[preset].note}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Engaged channels</label>
              <div className="flex flex-wrap gap-3">
                {PRESETS[preset].channels.map((ch) => (
                  <label key={ch} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!engaged[ch]}
                      onChange={(e) => setEngaged((old) => ({ ...old, [ch]: e.target.checked }))}
                    />
                    <span>{ch}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                Only engaged columns (by header name) are used from your CSV. If your CSV has no headers, numeric columns are used as-is.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const txt = await f.text();
                  setRawCSV(txt);
                }}
              />
              <button className="px-3 py-2 rounded-full border border-hair hover:bg-hair/30" onClick={() => fileRef.current?.click()}>
                Upload CSV/TXT
              </button>
              <button className="px-3 py-2 rounded-full border border-hair hover:bg-hair/30" onClick={() => setRawCSV(PRESETS[preset].sampleCSV)}>
                Use preset sample
              </button>
              <button className="px-3 py-2 rounded-full border border-hair hover:bg-hair/30" onClick={() => setRawCSV("")}>
                Clear
              </button>
            </div>

            <textarea
              value={rawCSV}
              onChange={(e) => setRawCSV(e.target.value)}
              placeholder="Paste CSV here..."
              className="w-full h-40 p-3 rounded-xl border border-hair font-mono text-sm"
            />
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold">2) Generate narrative</h2>
            <div className="flex items-center gap-3">
              <button onClick={onGenerate} className="px-4 py-2 rounded-full text-white bg-ink hover:opacity-90">
                Generate
              </button>
              <div className="text-xs text-neutral-500">{status}</div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAnnotated} onChange={(e)=>setShowAnnotated(e.target.checked)} />
              <span>Show annotated view (debug)</span>
            </label>
          </div>
        </div>

        <aside className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl border border-hair overflow-hidden">
            <img
              src="https://preview.redd.it/0ognknnu89h91.jpg?width=640&crop=smart&auto=webp&s=595b290b9a6fd4a1c89fd8e2da66d653c0ad4d75"
              alt="Graphic score vibe"
              className="w-full h-40 object-cover"
            />
            <div className="p-4 space-y-2">
              <h3 className="font-semibold">Narrative atoms</h3>
              <p className="text-sm text-neutral-700">
                Story is assembled from tiny mythic atoms (mythemes → functions → roles → surfaces). Data drives selection; authors control the library.
              </p>
              <p className="text-sm text-neutral-700">
                Deterministic: same data → same story. Toggle annotated mode to see control variables per step.
              </p>
            </div>
          </div>
        </aside>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">3) Output</h2>
        {narrative.length === 0 ? (
          <div className="rounded-xl border border-hair p-4 bg-white text-sm">
            Ready. Click <b>Generate</b> to compose.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3 leading-relaxed text-lg">
              {narrative.map((line, i) => <p key={i}>{line}</p>)}
            </div>
            {showAnnotated && (
              <div className="rounded-2xl border border-hair p-3 bg-white text-sm">
                <div className="font-semibold mb-2">Annotated</div>
                {states.map((s:any, i:number)=> (
                  <div key={i} className="mb-2 border-b border-hair pb-2">
                    <div className="text-xs text-neutral-500">Step {i+1}</div>
                    <div>NCV.mood: <b>{s.NCV?.mood}</b>, NCV.pace: <b>{s.NCV?.pace}</b>, NCV.pov: <b>{s.NCV?.pov}</b>, NCV.symbolic: <b>{s.NCV?.symbolic}</b></div>
                    <div className="text-neutral-600">{(intents[i]||[]).map(x=>x.fn).join(", ")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="pt-8 text-xs text-neutral-500 border-t border-hair">
        Universal ontology → entity codebook → deterministic selection. No ML/LLMs.
      </footer>
    </div>
  );
}
