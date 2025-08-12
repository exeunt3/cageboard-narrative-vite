
import React, { useMemo, useRef, useState } from "react";
import { parseCSV, computeStates, selectFunctions, Codebook } from "./engine";
import plantCodebook from "./data/codebook_plant.json";
import geologyCodebook from "./data/codebook_geology.json";
import surfaces from "./data/surfaces.json";

/** ------------------------------------
 *  App wiring
 *  -----------------------------------*/

type PresetKey = "plant" | "geology";

const PRESETS: Record<
  PresetKey,
  { label: string; channels: string[]; sampleCSV: string; note?: string; codebook: Codebook }
> = {
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
    codebook: plantCodebook as unknown as Codebook,
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
    codebook: geologyCodebook as unknown as Codebook,
  },
};

/** ------------------------------------
 *  Regimes, bridges, and beat palettes
 *  -----------------------------------*/

type Regime = "horror" | "trickster" | "thriller" | "fairytale" | "shamanic";

const REGIME_LIST: Regime[] = ["horror", "trickster", "thriller", "fairytale", "shamanic"];

/** Which pivots are allowed when tone changes */
const ALLOWED_BRIDGES: Partial<Record<`${Regime}->${Regime}`, string>> = {
  "horror->shamanic": "bridge.underworld_mouth",
  "thriller->trickster": "bridge.unreliable_ally",
  "fairytale->horror": "bridge.taboo_broken",
  "trickster->shamanic": "bridge.taboo_place_opens",
  "thriller->horror": "bridge.dark_turn",
  "horror->thriller": "bridge.fight_or_flee",
  "fairytale->trickster": "bridge.rule_bent",
  "trickster->fairytale": "bridge.bargain_matures",
};

/** Beat palette per regime — function IDs (we render to text later) */
const PALETTE: Record<
  Regime,
  {
    movement: string[];
    environment: string[];
    challenge: string[];
    support: string[];
    maintenance: string[];
    reflection: string[];
  }
> = {
  horror: {
    movement: ["fn.road_walk", "fn.trail_cut", "fn.descend"],
    environment: ["fn.noise_far", "fn.light_fails", "fn.smell_metallic"],
    challenge: ["fn.stalked", "fn.wrong_place", "fn.near_miss"],
    support: ["fn.find_marker"],
    maintenance: ["fn.repack", "fn.eat"],
    reflection: ["fn.breath_held"],
  },
  trickster: {
    movement: ["fn.road_walk", "fn.trail_cut", "fn.crossing"],
    environment: ["fn.sign_confusing", "fn.double_identity"],
    challenge: ["fn.misdirection", "fn.lost_item", "fn.bad_bargain"],
    support: ["fn.find_marker", "fn.stranger_hint"],
    maintenance: ["fn.repack", "fn.eat"],
    reflection: ["fn.joke_turns"],
  },
  thriller: {
    movement: ["fn.ascend", "fn.descend", "fn.road_walk"],
    environment: ["fn.noise_close", "fn.weather_shift", "fn.light_change"],
    challenge: ["fn.chase", "fn.obstacle", "fn.cross_danger"],
    support: ["fn.aid_sign", "fn.memory_map"],
    maintenance: ["fn.repair_boot", "fn.eat"],
    reflection: ["fn.count_distance"],
  },
  fairytale: {
    movement: ["fn.trail_cut", "fn.crossing", "fn.road_walk"],
    environment: ["fn.feast_smell", "fn.lanterns", "fn.strange_music"],
    challenge: ["fn.rule_presented", "fn.giant_block", "fn.trial_riddle"],
    support: ["fn.helper_offers", "fn.gift_small"],
    maintenance: ["fn.repack", "fn.eat"],
    reflection: ["fn.promise_made"],
  },
  shamanic: {
    movement: ["fn.descend", "fn.crossing", "fn.road_walk"],
    environment: ["fn.breath_current", "fn.stone_names", "fn.bone_orchard"],
    challenge: ["fn.ordeal_dark", "fn.name_turns", "fn.river_black"],
    support: ["fn.guide_sign", "fn.memory_map"],
    maintenance: ["fn.repack", "fn.eat"],
    reflection: ["fn.naming", "fn.pattern_seen"],
  },
};

/** Bridge functions map to sentences later */
const BRIDGE_FNS: Record<string, string> = {
  "bridge.underworld_mouth": "A seam opens in the hillside, breathing cold air. They look at each other and step in.",
  "bridge.unreliable_ally": "The helpful voice on the radio crackles and contradicts itself. They realize it has been leading them in circles.",
  "bridge.taboo_broken": "The feast’s host asks them to eat in silence; Jill laughs. Every lantern goes out at once.",
  "bridge.taboo_place_opens": "The prank goes too far; a door in the ground that was never there swings open.",
  "bridge.dark_turn": "The shortcut isn’t empty. Shapes move between the columns; they pick up speed.",
  "bridge.fight_or_flee": "The stalker shows himself at last; they sprint and do not look back.",
  "bridge.rule_bent": "The path sign points one way, but the small footprints go the other.",
  "bridge.bargain_matures": "The trick they played earlier finds its balance; a basket sits waiting with their lost map inside.",
};

/** ------------------------------------
 *  Local fallback surfaces (runs even if surfaces.json is sparse)
 *  -----------------------------------*/
const SURFACES_FALLBACK: Record<string, string[]> = {
  // movement
  "fn.road_walk": [
    "They follow the service road skirting the river.",
    "They stay on the hardpack, keeping the turbines behind them.",
  ],
  "fn.trail_cut": [
    "They leave the road and step onto a narrow trail through fir and alder.",
    "They slip past the fence and take a maintenance path toward higher ground.",
  ],
  "fn.ascend": ["The grade steepens. They take it in short, even climbs."],
  "fn.descend": ["The trail drops into a draw; rocks slide underfoot."],
  "fn.crossing": ["They wade a cold braid of the river, boots slung by their laces."],

  // environment
  "fn.noise_far": ["Somewhere upslope, something moves when they move; then stops."],
  "fn.noise_close": ["A clatter nearby makes them freeze. When it quiets, they move again."],
  "fn.light_fails": ["Cloud cover thickens. Flashlights make narrow cones in the trees."],
  "fn.light_change": ["The sun slips from behind cloud; the path brightens in patches."],
  "fn.smell_metallic": ["The air smells metallic, as if the dam were still inside the forest."],
  "fn.sign_confusing": ["Two arrows on the same post point opposite directions."],
  "fn.double_identity": ["They greet a traveler who later passes them again from the wrong direction."],
  "fn.weather_shift": ["Rain starts and stops within a minute. A second front is coming."],
  "fn.feast_smell": ["They smell bread and smoke where no houses stand."],
  "fn.lanterns": ["Lanterns swing from low branches, lit from no source they can see."],
  "fn.strange_music": ["Music they cannot place drifts over the creek."],
  "fn.breath_current": ["The tunnel exhales; air moves toward darkness and they follow."],
  "fn.stone_names": ["Jane names the stones as they pass; Jill repeats the names."],
  "fn.bone_orchard": ["White shapes stand in a grove. They do not touch them."],

  // challenge
  "fn.stalked": ["They are being matched step for step. When they stop, it stops."],
  "fn.wrong_place": ["They come into a clearing that should not be here; every path seems new."],
  "fn.near_miss": ["Footing goes, but they catch a trunk and hold until the shake passes."],
  "fn.misdirection": ["A friendly voice points them to a shortcut that loops back on itself."],
  "fn.lost_item": ["They check their packs and find the compass missing."],
  "fn.bad_bargain": ["A trader wants too much for a hint. They walk on."],
  "fn.chase": ["Movement behind becomes pursuit. They run until their breath burns."],
  "fn.obstacle": ["A fallen tree blocks the way; they crawl and pass packs across."],
  "fn.cross_danger": ["They cross a spillway grate one by one, each step sounding hollow."],
  "fn.rule_presented": ["A sign reads: “Do not speak while the bridge is crossed.”"],
  "fn.giant_block": ["A boulder, too round for this valley, sits squarely on the trail."],
  "fn.trial_riddle": ["A child asks a question that isn’t a question. They answer with a nod."],
  "fn.ordeal_dark": ["Without lights, they count steps and turns; the dark equals them."],
  "fn.name_turns": ["A name they used earlier won’t work now; they try another."],
  "fn.river_black": ["The river here is black and moving fast; they cross in silence."],

  // support
  "fn.find_marker": ["At a fork, a survey marker points east. They mark the map and continue."],
  "fn.aid_sign": ["Fresh paint on an old post shows an arrow where none had been before."],
  "fn.memory_map": ["Jill reconstructs the creek bends from memory, and they correct course."],
  "fn.helper_offers": ["An old woman offers a pebble “for finding your way back.” They keep it."],
  "fn.gift_small": ["Under a flat stone, someone left a biscuit wrapped in paper."],
  "fn.guide_sign": ["A white moth waits at the mouth of the tunnel, wings like a small flag."],
  "fn.stranger_hint": ["“Keep left at the fork,” a man under the bridge says."],

  // maintenance
  "fn.repair_boot": ["They tape a frayed strap and change socks."],
  "fn.eat": ["They split an apple and drink from the thermos."],
  "fn.repack": ["They redistribute weight between the packs and set off again."],

  // reflection
  "fn.breath_held": ["They make a stretch without speaking, counting breaths."],
  "fn.joke_turns": ["A joke from earlier lands wrong; they let it go."],
  "fn.count_distance": ["They estimate they’ve made four more kilometers since the dam."],
  "fn.promise_made": ["They agree not to enter any building with a second story."],
  "fn.naming": ["They repeat the names for the turns until the names feel right."],
  "fn.pattern_seen": ["The path repeats a pattern of three rises and a bend; they trust it."],

  // phase gates
  "fn.call": ["They shoulder their packs and check the map. The road runs east along the river."],
  "fn.threshold_crossing": [
    "They leave the access road beyond the fence line. The plant hum fades behind them.",
  ],
  "fn.return": ["A lane appears between trees. They walk the last hundred meters without a word."],
};

/** ------------------------------------
 *  Utility: pick a sentence for a function
 *  from external surfaces.json if it matches,
 *  else fall back to the local stock above.
 *  -----------------------------------*/
function pickSurfaceText(fn: string, NCV: any): string {
  const all = (surfaces as any[]) || [];
  // Prefer matches with mood/pov/time/terrain
  const candidates = all.filter(
    (s) =>
      s?.binds?.function === fn &&
      (!s.binds.mood || s.binds.mood === NCV?.mood) &&
      (!s.binds.pov || s.binds.pov === NCV?.pov) &&
      (!s.binds.time || s.binds.time === NCV?.time) &&
      (!s.binds.terrain || s.binds.terrain === NCV?.terrain)
  );
  if (candidates.length) return (candidates[0].text as string); // deterministic (first match)
  const stock = SURFACES_FALLBACK[fn];
  if (stock?.length) return stock[0];
  const loose = all.find((s) => s?.binds?.function === fn);
  if (loose?.text) return loose.text as string;
  return "";
}

/** ------------------------------------
 *  Beat metadata: preconditions / effects
 *  -----------------------------------*/
type BeatId = string;

const BEAT_RULES: Record<BeatId, { needs?: string[]; gives?: string[] }> = {
  // movement
  "fn.trail_cut": { needs: ["left_road"], gives: ["in_trail"] },
  "fn.road_walk": { gives: ["on_road"] },
  "fn.crossing": { needs: ["in_trail"], gives: ["wet"] },
  "fn.ascend": { needs: ["in_trail"], gives: ["high_ground"] },
  "fn.descend": { needs: ["in_trail"], gives: [] },

  // environment
  "fn.light_fails": { gives: ["low_light"] },
  "fn.noise_close": { gives: ["alert"] },

  // challenge
  "fn.stalked": { needs: ["low_light"], gives: ["pursued"] },
  "fn.obstacle": { needs: ["in_trail"], gives: ["detour"] },
  "fn.cross_danger": { needs: ["wet"], gives: ["shaken"] },
  "fn.ordeal_dark": { needs: ["low_light"], gives: ["ordeal"] },

  // support / maintenance / reflection
  "fn.find_marker": { needs: ["in_trail"], gives: ["oriented"] },
  "fn.repair_boot": { needs: ["shaken"], gives: ["steadied"] },
  "fn.eat": { gives: ["fed"] },
  "fn.repack": { gives: ["ordered"] },

  // gates
  "fn.call": { gives: ["left_road"] },
  "fn.threshold_crossing": { needs: ["on_road"], gives: ["in_trail"] },
  "fn.return": { gives: ["approach"] },
};

function hasAll(tokens: Set<string>, needs?: string[]) {
  if (!needs || needs.length === 0) return true;
  for (const t of needs) if (!tokens.has(t)) return false;
  return true;
}
function applyGives(tokens: Set<string>, gives?: string[]) {
  if (!gives) return;
  for (const t of gives) tokens.add(t);
}

/** ------------------------------------
 *  Regime classifier (data → weights) + inertia
 *  -----------------------------------*/
type Weights = Record<Regime, number>;

function normalizeWeights(w: Partial<Weights>): Weights {
  const out: any = { horror: 0, trickster: 0, thriller: 0, fairytale: 0, shamanic: 0, ...w };
  const sum = REGIME_LIST.reduce((a, k) => a + (out[k] || 0), 0);
  if (sum <= 0) return { horror: 0.2, trickster: 0.2, thriller: 0.2, fairytale: 0.2, shamanic: 0.2 };
  REGIME_LIST.forEach((k) => (out[k] = out[k] / sum));
  return out as Weights;
}

function instantRegimeWeights(s: any): Weights {
  const varSeis = Number(s?.var?.seismic || 0);
  const varTilt = Number(s?.var?.tilt || 0);
  const trendSeis = Number(s?.trend?.seismic || 0);
  const tiltBin = s?.bins?.tilt || "";
  const tempBin = s?.bins?.temp || "";
  const mood = s?.NCV?.mood || "";
  const pace = s?.NCV?.pace || "";

  let horror = 0;
  horror += varSeis > 0.006 ? 1 : 0;
  horror += tempBin === "cool" ? 0.3 : 0;
  horror += mood === "strained" ? 0.5 : 0;

  let trickster = 0;
  trickster += varTilt > 0.0008 ? 0.6 : 0;
  trickster += pace === "steady" ? 0.3 : 0;
  trickster += tiltBin === "shift" ? 0.3 : 0;

  let thriller = 0;
  thriller += varSeis > 0.004 ? 0.7 : 0;
  thriller += trendSeis > 0.01 ? 0.5 : 0;
  thriller += pace === "fast" ? 0.3 : 0;

  let fairytale = 0;
  fairytale += varSeis < 0.002 ? 0.7 : 0;
  fairytale += pace === "calm" ? 0.3 : 0;

  let shamanic = 0;
  shamanic += tiltBin === "shear" ? 0.7 : 0;
  shamanic += tempBin === "warm" ? 0.2 : 0.1;
  shamanic += trendSeis < -0.01 ? 0.3 : 0;

  return normalizeWeights({ horror, trickster, thriller, fairytale, shamanic });
}

function mixWeights(prev: Weights, now: Weights, inertia = 0.7): Weights {
  const out: any = {};
  for (const k of REGIME_LIST) out[k] = inertia * prev[k] + (1 - inertia) * now[k];
  return normalizeWeights(out);
}

function topRegime(w: Weights): Regime {
  return REGIME_LIST.reduce((best, k) => (w[k] > w[best] ? k : best), REGIME_LIST[0]);
}

function allowedBridge(prev: Regime, next: Regime): string | null {
  if (prev === next) return null;
  const k = `${prev}->${next}` as const;
  return ALLOWED_BRIDGES[k] || null;
}

/** ------------------------------------
 *  Beat selection with scoring + constraints
 *  -----------------------------------*/
function scoreBeat(fn: BeatId, regime: Regime, s: any): number {
  const palette = PALETTE[regime];
  const inPalette =
    palette.movement.includes(fn) ||
    palette.environment.includes(fn) ||
    palette.challenge.includes(fn) ||
    palette.support.includes(fn) ||
    palette.maintenance.includes(fn) ||
    palette.reflection.includes(fn);
  let score = inPalette ? 1.0 : 0.2;

  // data coupling
  const vSeis = Number(s?.var?.seismic || 0);
  const vTilt = Number(s?.var?.tilt || 0);
  const trendSeis = Number(s?.trend?.seismic || 0);
  const lowLight = s?.NCV?.time === "dusk" || s?.NCV?.time === "night";

  if (fn === "fn.stalked") score += lowLight ? 0.6 : 0.1;
  if (fn === "fn.cross_danger") score += vSeis > 0.004 ? 0.5 : 0.0;
  if (fn === "fn.ascend") score += vTilt > 0.001 ? 0.4 : 0.0;
  if (fn === "fn.descend") score += trendSeis < -0.01 ? 0.3 : 0.0;
  if (fn === "fn.find_marker") score += (s?.bins?.tilt === "shift") ? 0.3 : 0.0;
  if (fn === "fn.ordeal_dark") score += lowLight && vSeis > 0.006 ? 0.6 : 0.0;

  return score;
}

function chooseBeatsPlanned(
  regime: Regime,
  s: any,
  tokens: Set<string>,
  recentBeats: string[],
  want = 3
): string[] {
  const ALL_BEATS = Array.from(
    new Set([
      ...PALETTE[regime].movement,
      ...PALETTE[regime].environment,
      ...PALETTE[regime].challenge,
      ...PALETTE[regime].support,
      ...PALETTE[regime].maintenance,
      ...PALETTE[regime].reflection,
    ])
  );

  const feasible = ALL_BEATS.filter((fn) => hasAll(tokens, BEAT_RULES[fn]?.needs));

  const scored = feasible
    .map((fn) => {
      let sc = scoreBeat(fn, regime, s);
      if (recentBeats.slice(-4).includes(fn)) sc *= 0.4; // cooldown
      return { fn, sc };
    })
    .sort((a, b) => b.sc - a.sc);

  const out: string[] = [];
  for (const { fn } of scored) {
    if (out.length >= want) break;
    out.push(fn);
    applyGives(tokens, BEAT_RULES[fn]?.gives);
  }
  return out;
}

/** ------------------------------------
 *  Side‑quest mini‑graph
 *  -----------------------------------*/
type NodeId = "SQ.threshold" | "SQ.trials" | "SQ.inmost" | "SQ.boon" | "SQ.exit";
const SQ_EDGES: Record<NodeId, NodeId[]> = {
  "SQ.threshold": ["SQ.trials"],
  "SQ.trials": ["SQ.trials", "SQ.inmost"],
  "SQ.inmost": ["SQ.boon"],
  "SQ.boon": ["SQ.exit"],
  "SQ.exit": [],
};

function pickSideQuestPath(steps: number, sList: any[]): NodeId[] {
  const path: NodeId[] = [];
  let node: NodeId = "SQ.threshold";
  let i = 0;
  while (i < steps && node !== "SQ.exit") {
    path.push(node);
    const s = sList[Math.min(i, sList.length - 1)];
    const v = Number(s?.var?.seismic || 0);
    const nexts = SQ_EDGES[node];
    if (node === "SQ.trials" && v > 0.006) node = "SQ.inmost";
    else node = nexts[0] || "SQ.exit";
    i++;
  }
  if (!path.includes("SQ.exit")) path.push("SQ.exit");
  return path;
}

/** ------------------------------------
 *  Derive lightweight ledger (time/terrain/fatigue)
 *  -----------------------------------*/
function deriveLedger(idx: number, total: number, s: any) {
  const timePhase = idx % 10;
  const time = timePhase < 3 ? "morning" : timePhase < 7 ? "day" : timePhase < 9 ? "dusk" : "night";
  const terrain =
    (s?.var?.seismic || 0) > 0.006 ? "rock" : (s?.var?.tilt || 0) > 0.001 ? "forest" : "road";
  return { time, terrain, idx, total };
}

/** ------------------------------------
 *  Component
 *  -----------------------------------*/
export default function App() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preset, setPreset] = useState<PresetKey>("geology");
  const [rawCSV, setRawCSV] = useState(PRESETS["geology"].sampleCSV);
  const [engaged, setEngaged] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PRESETS["geology"].channels.map((c) => [c, true]))
  );
  const [status, setStatus] = useState("Ready. Load data and Generate.");
  const [narrative, setNarrative] = useState<string[]>([]);
  const [showAnnotated, setShowAnnotated] = useState(false);

  const activeCodebook = PRESETS[preset].codebook;

  // Parse CSV and filter to engaged columns if headers exist
  const rows = useMemo(() => {
    const parsed = parseCSV(rawCSV);
    const keys = Object.keys(parsed[0] || {});
    const hasHeader = keys.some((k) => isNaN(Number(k)));
    if (!hasHeader) return parsed;
    const cols = keys.filter((k) => engaged[k]);
    return parsed.map((r) => Object.fromEntries(cols.map((k) => [k, (r as any)[k]])));
  }, [rawCSV, engaged]);

  // Compute per-row states (bins/trend/var/NCV)
  const states = useMemo(() => {
    if (!rows.length) return [] as any[];
    return computeStates(rows as any, activeCodebook);
  }, [rows, activeCodebook]);

  // Optional: original intents — still available
  const intents = useMemo(() => states.map((s) => selectFunctions(s, activeCodebook)), [states, activeCodebook]);

  function onGenerate() {
    if (!rows.length) {
      setStatus("No data detected. Paste CSV or use a preset.");
      return;
    }

    const out: string[] = [];
    // Fixed opening anchor
    out.push(
      "Jane and Jill break camp at dawn beside the hydroelectric plant, thermoses steaming, turbines droning in the mist."
    );
    // Concrete call
    out.push(pickSurfaceText("fn.call", { mood: "reflective" }) || "They shoulder their packs and check the map.");

    // Regime state with inertia
    let prevWeights: Weights = { horror: 0.2, trickster: 0.2, thriller: 0.2, fairytale: 0.2, shamanic: 0.2 };
    let prevRegime: Regime = topRegime(prevWeights);

    // Side‑quest plan across the middle 60%
    const sqStart = Math.floor(states.length * 0.15);
    const sqEnd = Math.floor(states.length * 0.85);
    const sqPath = pickSideQuestPath(Math.max(1, sqEnd - sqStart), states.slice(sqStart, sqEnd));

    // tokens & repetition memory
    const tokens = new Set<string>(["left_road"]);
    const recentBeats: string[] = [];

    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const ledger = deriveLedger(i, states.length, s);
      s.NCV = { ...(s.NCV || {}), time: ledger.time, terrain: ledger.terrain };

      const inst = instantRegimeWeights(s);
      const mixed = mixWeights(prevWeights, inst, 0.7);
      let regime = topRegime(mixed);

      // Bridge on regime change
      const bridge = allowedBridge(prevRegime, regime);
      if (bridge) out.push(BRIDGE_FNS[bridge]);

      // Side‑quest steering
      if (i >= sqStart && i < sqEnd) {
        const node = sqPath[i - sqStart];
        if (node === "SQ.inmost") regime = "shamanic";
        else if (node === "SQ.trials" && regime === "fairytale") regime = "trickster";
      }

      // Plan & emit beats
      const beats = chooseBeatsPlanned(regime, s, tokens, recentBeats, 3);
      for (const fn of beats) {
        const line = pickSurfaceText(fn, s.NCV);
        if (line) out.push(line);
        recentBeats.push(fn);
        if (recentBeats.length > 16) recentBeats.shift();
      }

      // Optional: small bias to original intents
      const extra = (intents[i] || []).slice(0, 1);
      for (const intent of extra) {
        const line = pickSurfaceText(intent.fn, s.NCV);
        if (line) out.push(line);
      }

      prevWeights = mixed;
      prevRegime = regime;
    }

    // Approach & fixed closing anchor
    out.push(pickSurfaceText("fn.return", {}) || "A lane appears between trees. They walk the last hundred meters without a word.");
    out.push('After several days on the road they reach the cottage at the forest’s edge. A silhouetted figure opens the door and says, "Are you ready?"');

    setNarrative(out);
    setStatus(`Generated ${out.length} lines across ${states.length} steps (${rows.length} rows).`);
  }

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-8">
      <header className="space-y-2 pb-6 border-b border-hair">
        <h1 className="text-3xl font-bold tracking-tight">Cage‑Board — Narrative (Regimes + Planner)</h1>
        <p className="text-sm text-neutral-600 max-w-2xl">
          Deterministic story assembly from data using genre regimes, bridge beats, and a small planner. No ML.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-6">
          {/* 1) Load */}
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
                    className={`px-3 py-1.5 rounded-full border ${preset === k ? "bg-ink text-white border-ink" : "border-hair hover:bg-hair/30"}`}
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
                  const f = e.target.files?.[0];
                  if (!f) return;
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

          {/* 2) Generate */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">2) Generate narrative</h2>
            <div className="flex items-center gap-3">
              <button onClick={onGenerate} className="px-4 py-2 rounded-full text-white bg-ink hover:opacity-90">
                Generate
              </button>
              <div className="text-xs text-neutral-500">{status}</div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAnnotated} onChange={(e) => setShowAnnotated(e.target.checked)} />
              <span>Show annotated view (debug)</span>
            </label>
          </div>
        </div>

        {/* Sidebar card */}
        <aside className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl border border-hair overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=800&auto=format&fit=crop"
              alt="Industrial to forest transition"
              className="w-full h-40 object-cover"
            />
            <div className="p-4 space-y-2">
              <h3 className="font-semibold">Regimes • Bridges • Planner</h3>
              <p className="text-sm text-neutral-700">
                Tone follows data via regimes with inertia; bridges make shifts feel natural; a simple planner keeps beats causal.
              </p>
            </div>
          </div>
        </aside>
      </section>

      {/* 3) Output */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">3) Output</h2>
        {narrative.length === 0 ? (
          <div className="rounded-xl border border-hair p-4 bg-white text-sm">
            Ready. Click <b>Generate</b> to compose Jane & Jill’s detour from dam to cottage.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3 leading-relaxed text-lg">
              {narrative.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            {showAnnotated && (
              <div className="rounded-2xl border border-hair p-3 bg-white text-sm">
                <div className="font-semibold mb-2">Annotated (per step)</div>
                {states.map((s: any, i: number) => {
                  const inst = instantRegimeWeights(s);
                  return (
                    <div key={i} className="mb-2 border-b border-hair pb-2">
                      <div className="text-xs text-neutral-500">Step {i + 1}</div>
                      <div>
                        NCV.mood: <b>{s.NCV?.mood}</b>, pace: <b>{s.NCV?.pace}</b>, pov: <b>{s.NCV?.pov}</b>, symbol:{" "}
                        <b>{s.NCV?.symbolic}</b>
                      </div>
                      <div className="text-xs mt-1">
                        w(horror): {inst.horror.toFixed(2)} · w(trickster): {inst.trickster.toFixed(2)} · w(thriller):{" "}
                        {inst.thriller.toFixed(2)} · w(fairy): {inst.fairytale.toFixed(2)} · w(shamanic):{" "}
                        {inst.shamanic.toFixed(2)}
                      </div>
                      <div className="text-neutral-600">
                        codebook: {(selectFunctions(s, activeCodebook) || []).map((x: any) => x.fn).join(", ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="pt-8 text-xs text-neutral-500 border-t border-hair">
        Fixed spine (dam → detour → cottage) · Regime contracts · Bridge beats · Planner with preconditions. Deterministic by data.
      </footer>
    </div>
  );
}
