// АНАЛИТИКА МОНЕТ v2 (Supabase Edge Function, Deno) — замена market-scan
// Действия (body.action):
//   analyze — пересчитать три блока: listings / volatile / spike (по ТЗ §4)
//   kline   — прокси свечей Bybit для графиков в карточке монеты
// Секретов не требует. Пороги — из user_settings.filters.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.bybit.com";
const API_FALLBACK = "https://api.bytick.com";
const STABLE_BASES = new Set([
  "USDC", "USDE", "DAI", "FDUSD", "TUSD", "USDD", "PYUSD", "USTC", "BUSD", "EUR", "USDY", "USD1", "XUSD",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function pub(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  for (const host of [API, API_FALLBACK]) {
    try {
      const r = await fetch(`${host}${path}?${qs}`);
      const j = await r.json();
      if (j.retCode !== 0) throw new Error(`[${j.retCode}] ${j.retMsg}`);
      return j.result;
    } catch (e) {
      if (host === API_FALLBACK) throw new Error(`Bybit ${path}: ${String(e)}`);
    }
  }
}

// Пул параллельных задач
async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

async function allInstruments(category: "spot" | "linear") {
  const rows: Record<string, string>[] = [];
  let cursor = "";
  do {
    const res = await pub("/v5/market/instruments-info", {
      category, limit: "1000", ...(cursor ? { cursor } : {}),
    });
    rows.push(...(res.list ?? []));
    cursor = res.nextPageCursor ?? "";
  } while (cursor);
  return rows;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "analyze";

    // ---------- Прокси свечей для карточки монеты ----------
    if (action === "kline") {
      const { category, symbol, interval, limit } = body;
      if (!["spot", "linear"].includes(category)) throw new Error("bad category");
      const res = await pub("/v5/market/kline", {
        category, symbol: String(symbol), interval: String(interval),
        limit: String(Math.min(Number(limit) || 200, 1000)),
        ...(body.start ? { start: String(body.start) } : {}),
      });
      return new Response(JSON.stringify({ ok: true, list: res.list ?? [] }),
        { headers: { "Content-Type": "application/json", ...CORS } });
    }

    // ---------- Полный анализ ----------
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings } = await sb.from("user_settings").select("filters").eq("id", 1).single();
    const F = {
      listing_hours: 72, require_spot: true, age_days: 365,
      min_spot_turnover: 5_000_000, vol6h_pct: 10,
      spike_ratio: 5, spike_min_turnover: 5_000_000,
      ...(settings?.filters ?? {}),
    };
    const errors: string[] = [];

    const { data: run } = await sb.from("research_runs")
      .insert({ params: F }).select("id").single();
    const runId = run!.id;

    // Инструменты + тикеры
    const [linRaw, spotRaw] = await Promise.all([allInstruments("linear"), allInstruments("spot")]);
    const linear = linRaw.filter((x) =>
      x.status === "Trading" && x.contractType === "LinearPerpetual" && x.quoteCoin === "USDT");
    const spot = spotRaw.filter((x) => x.status === "Trading" && x.quoteCoin === "USDT");
    const spotByBase = new Map(spot.map((x) => [x.baseCoin, x]));

    const instRows = [
      ...linear.map((x) => ({
        market: "linear", symbol: x.symbol, base: x.baseCoin, quote: x.quoteCoin,
        status: x.status, contract_type: x.contractType,
        launch_time: x.launchTime ? new Date(parseInt(x.launchTime)).toISOString() : null,
        updated_at: new Date().toISOString(),
      })),
      ...spot.map((x) => ({
        market: "spot", symbol: x.symbol, base: x.baseCoin, quote: x.quoteCoin,
        status: x.status, contract_type: null,
        launch_time: x.launchTime ? new Date(parseInt(x.launchTime)).toISOString() : null,
        updated_at: new Date().toISOString(),
      })),
    ];
    for (let i = 0; i < instRows.length; i += 500) {
      const { error } = await sb.from("instruments").upsert(instRows.slice(i, i + 500), { onConflict: "market,symbol" });
      if (error) { errors.push(`instruments: ${error.message}`); break; }
    }

    const [tickLin, tickSpot] = await Promise.all([
      pub("/v5/market/tickers", { category: "linear" }),
      pub("/v5/market/tickers", { category: "spot" }),
    ]);
    const linTicker = new Map((tickLin.list ?? []).map((t: Record<string, string>) => [t.symbol, t]));
    const spotTicker = new Map((tickSpot.list ?? []).map((t: Record<string, string>) => [t.symbol, t]));

    const { data: coinRows } = await sb.from("coins").select("base, genesis_date");
    const genesis = new Map((coinRows ?? []).map((c) => [c.base, c.genesis_date]));

    const now = Date.now();
    const results: Record<string, unknown>[] = [];

    const num = (v: string | undefined) => v != null && v !== "" ? parseFloat(v) : null;
    const spotTurnover = (base: string) => {
      const sp = spotByBase.get(base);
      return sp ? num(spotTicker.get(sp.symbol)?.turnover24h) ?? 0 : 0;
    };

    // ---------- Блок 1: Новые листинги (≤72 ч) ----------
    for (const ins of linear) {
      const lt = ins.launchTime ? parseInt(ins.launchTime) : 0;
      if (!lt) continue;
      const hours = (now - lt) / 3600_000;
      if (hours < 0 || hours > F.listing_hours) continue;
      const hasSpot = spotByBase.has(ins.baseCoin);
      if (F.require_spot && !hasSpot) continue;
      const tk = linTicker.get(ins.symbol);
      const sp = spotByBase.get(ins.baseCoin);
      results.push({
        run_id: runId, block: "listings", symbol: ins.symbol, base: ins.baseCoin,
        metrics: {
          hours_since: Math.round(hours * 100) / 100,
          futures_launch: new Date(lt).toISOString(),
          spot_launch: sp?.launchTime ? new Date(parseInt(sp.launchTime)).toISOString() : null,
          has_spot: hasSpot,
          spot_turnover: spotTurnover(ins.baseCoin),
          price: num(tk?.lastPrice),
          change24h: (num(tk?.price24hPcnt) ?? 0) * 100,
        },
      });
    }

    // ---------- Блок 2: Волатильные (основная стратегия) ----------
    const ageDays = (ins: Record<string, string>): { days: number | null; source: string } => {
      const g = genesis.get(ins.baseCoin);
      if (g) return { days: (now - new Date(g).getTime()) / 86400_000, source: "coingecko" };
      const sp = spotByBase.get(ins.baseCoin);
      if (sp?.launchTime) return { days: (now - parseInt(sp.launchTime)) / 86400_000, source: "bybit_spot" };
      if (ins.launchTime) return { days: (now - parseInt(ins.launchTime)) / 86400_000, source: "bybit_linear" };
      return { days: null, source: "unknown" };
    };
    const volCandidates = linear.filter((ins) => {
      if (STABLE_BASES.has(ins.baseCoin)) return false;
      if (!spotByBase.has(ins.baseCoin)) return false;
      if (spotTurnover(ins.baseCoin) < F.min_spot_turnover) return false;
      const a = ageDays(ins);
      return a.days != null && a.days >= F.age_days;
    });
    const volData = await pool(volCandidates, 12, async (ins) => {
      const res = await pub("/v5/market/kline",
        { category: "linear", symbol: ins.symbol, interval: "15", limit: "24" });
      const list: string[][] = res.list ?? []; // новые -> старые
      if (list.length < 24) return null;
      const highs = list.map((c) => parseFloat(c[2]));
      const lows = list.map((c) => parseFloat(c[3]));
      const hi = Math.max(...highs), lo = Math.min(...lows);
      const openOldest = parseFloat(list[list.length - 1][1]);
      const closeLatest = parseFloat(list[0][4]);
      return {
        ins,
        vol6h: lo > 0 ? (hi - lo) / lo * 100 : 0,
        change6h: openOldest > 0 ? (closeLatest - openOldest) / openOldest * 100 : 0,
      };
    });
    for (const v of volData) {
      if (!v || v.vol6h < F.vol6h_pct) continue;
      const tk = linTicker.get(v.ins.symbol);
      const a = ageDays(v.ins);
      results.push({
        run_id: runId, block: "volatile", symbol: v.ins.symbol, base: v.ins.baseCoin,
        metrics: {
          price: num(tk?.lastPrice),
          vol6h: Math.round(v.vol6h * 100) / 100,
          change6h: Math.round(v.change6h * 100) / 100,
          change24h: (num(tk?.price24hPcnt) ?? 0) * 100,
          spot_turnover: spotTurnover(v.ins.baseCoin),
          age_days: a.days != null ? Math.round(a.days) : null,
          age_source: a.source,
        },
      });
    }

    // ---------- Блок 3: Аномальный рост спотового объёма ----------
    const spikeCandidates = linear.filter((ins) =>
      !STABLE_BASES.has(ins.baseCoin) &&
      spotByBase.has(ins.baseCoin) &&
      spotTurnover(ins.baseCoin) >= F.spike_min_turnover);
    const spikeData = await pool(spikeCandidates, 12, async (ins) => {
      const sp = spotByBase.get(ins.baseCoin)!;
      const res = await pub("/v5/market/kline",
        { category: "spot", symbol: sp.symbol, interval: "60", limit: "192" });
      const list: string[][] = res.list ?? []; // новые -> старые
      if (list.length < 192) return null;     // моложе 8 суток — база сравнения недостоверна
      const turns = list.map((c) => parseFloat(c[6])).reverse(); // старые -> новые
      const windows: number[] = [];
      for (let w = 0; w < 8; w++) {
        windows.push(turns.slice(w * 24, (w + 1) * 24).reduce((a, b) => a + b, 0));
      }
      const current = windows[7];
      const base = median(windows.slice(0, 7));
      if (base <= 0) return null;
      return { ins, current, base, ratio: current / base, daily: windows };
    });
    for (const s of spikeData) {
      if (!s || s.ratio < F.spike_ratio || s.current < F.spike_min_turnover) continue;
      const tk = linTicker.get(s.ins.symbol);
      results.push({
        run_id: runId, block: "spike", symbol: s.ins.symbol, base: s.ins.baseCoin,
        metrics: {
          turnover24h: Math.round(s.current),
          base_median: Math.round(s.base),
          ratio: Math.round(s.ratio * 100) / 100,
          price: num(tk?.lastPrice),
          change24h: (num(tk?.price24hPcnt) ?? 0) * 100,
          daily_turnovers: s.daily.map((v) => Math.round(v)), // 8 суточных сумм для мини-графика
        },
      });
    }

    // ---------- Сохранение ----------
    for (let i = 0; i < results.length; i += 200) {
      const { error } = await sb.from("research_results").insert(results.slice(i, i + 200));
      if (error) errors.push(`results: ${error.message}`);
    }
    const status = errors.length ? "partial" : "done";
    await sb.from("research_runs").update({
      status, errors: errors.length ? errors : null, duration_ms: Date.now() - t0,
    }).eq("id", runId);
    await sb.from("sync_status").upsert({
      id: "analytics", last_ok: new Date().toISOString(),
      detail: {
        runId, status,
        listings: results.filter((r) => r.block === "listings").length,
        volatile: results.filter((r) => r.block === "volatile").length,
        spike: results.filter((r) => r.block === "spike").length,
        ms: Date.now() - t0,
      },
    }, { onConflict: "id" });

    return new Response(JSON.stringify({ ok: true, runId, status, errors, counts: {
      listings: results.filter((r) => r.block === "listings").length,
      volatile: results.filter((r) => r.block === "volatile").length,
      spike: results.filter((r) => r.block === "spike").length,
    }, ms: Date.now() - t0 }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
