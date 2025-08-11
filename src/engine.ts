export type Row = Record<string, number|string>;
export type Codebook = {
  entity: string;
  channels: string[];
  windows: { trend: number; variance: number };
  bins: Record<string, {id:string; max:number}[]>;
  ncv: Record<string, { from: string; map: [string,string][] }>;
  functions: { thresholds: { if: string; then: string[] }[] };
};

export function parseCSV(text: string): Row[] {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(s=>s.trim());
  const hasHeader = headers.some(h => isNaN(Number(h)) && h.length>0);
  if (!hasHeader) {
    return lines.map((ln,i)=>({ value: Number(ln.trim()) }));
  }
  const rows: Row[] = [];
  for (const ln of lines.slice(1)) {
    const cols = ln.split(',').map(s=>s.trim());
    const obj: Row = {};
    headers.forEach((h, i)=> {
      const n = Number(cols[i]);
      obj[h] = Number.isFinite(n) ? n : cols[i];
    });
    rows.push(obj);
  }
  return rows;
}

function binValue(bins: {id:string; max:number}[], v: number): string {
  for (const b of bins) if (v <= b.max) return b.id;
  return bins[bins.length-1].id;
}

function rolling(rows: Row[], idx: number, n: number, key: string) {
  const start = Math.max(0, idx - n + 1);
  const arr = rows.slice(start, idx+1).map(r=> Number(r[key])||0);
  const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
  const variance = arr.reduce((a,b)=>a+(b-mean)*(b-mean),0)/arr.length;
  const trend = arr.length>1 ? arr[arr.length-1] - arr[0] : 0;
  return { mean, variance, trend };
}

export function computeStates(rows: Row[], codebook: Codebook){
  const win = codebook.windows?.trend ?? 5;
  return rows.map((r, idx)=>{
    const s: any = { raw:r, bins:{}, trend:{}, var:{}, setpoint:{}, relative:{}, NCV:{} };
    for(const ch of codebook.channels){
      const bins = codebook.bins[ch]; s.bins[ch] = binValue(bins, Number(r[ch])||0);
      const roll = rolling(rows, idx, win, ch); s.trend[ch] = roll.trend; s.var[ch] = roll.variance;
    }
    if ('temp' in s.bins) s.setpoint.temp = s.bins['temp'];
    if ('lum' in r && 'transpiration' in r){
      const l = Number(r['lum'])||0, tr = Number(r['transpiration'])||0;
      s.relative.lum_vs_transpiration = (l - tr) > 0.1 ? 'lum_dominant' : (tr - l) > 0.1 ? 'transpiration_dominant' : 'balanced';
    }
    for(const [k, spec] of Object.entries(codebook.ncv||{})){
      const src = (spec as any).from as string; let tag = 'flat';
      if(src.endsWith('.var')){ const ch = src.split('.')[0]; const v = s.var[ch]; tag = v<0.0001?'low': v<0.005?'med':'high'; }
      else if(src.endsWith('.trend')){ const ch = src.split('.')[0]; const v = s.trend[ch]; tag = v>0.01?'up': v<-0.01?'down':'flat'; }
      else if(src.startsWith('setpoint.')){ const key = src.split('.')[1]; tag = s.setpoint[key]; }
      else if(src.startsWith('relative.')){ const key = src.split('.')[1]; tag = s.relative[key]; }
      else if(src.endsWith('.bin')){ const ch = src.split('.')[0]; tag = s.bins[ch]; }
      const found = (spec as any).map.find((p:[string,string])=>p[0]===tag);
      s.NCV[k] = found ? found[1] : tag;
    }
    return s;
  });
}

export function selectFunctions(state: any, codebook: Codebook){
  const env: Record<string, any> = {
    "temp.bin": state.bins?.temp,
    "lum.bin": state.bins?.lum,
    "bio_potential.trend": state.trend?.bio_potential,
    "lum.trend": state.trend?.lum,
    "seismic.bin": state.bins?.seismic,
    "tilt.bin": state.bins?.tilt,
    "gas_flux.bin": state.bins?.gas_flux,
    "seismic.trend": state.trend?.seismic
  };
  const out: {fn:string}[] = [];
  for(const rule of (codebook.functions?.thresholds||[])){
    const expr = rule.if;
    try{
      const ok = Function('env', `with(env){ return (${expr.replace(/([a-zA-Z_]+\.[a-zA-Z_]+)/g, 'env["$1"]')}); }`)(env);
      if(ok){ for(const t of rule.then){ out.push({fn:t}); } }
    }catch(e){ /* ignore */ }
  }
  return out;
}
