// Слой данных: запросы к БД и Edge Functions
import { sb, callFn } from "./supa.js";
import { state } from "./util.js";

export async function loadSettings() {
  const { data, error } = await sb.from("user_settings").select("*").eq("id", 1).single();
  if (error) throw new Error("Настройки: " + error.message);
  state.settings = data;
  state.tz = data.timezone || "Europe/Moscow";
  return data;
}

export async function saveSettings(patch) {
  const { error } = await sb.from("user_settings")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(error.message);
  return loadSettings();
}

export async function loadSyncStatus() {
  const { data } = await sb.from("sync_status").select("*");
  const map = {};
  for (const row of data ?? []) map[row.id] = row;
  return map;
}

// ---------- Дневник ----------

export const runSync = () => callFn("bybit-sync", { task: "manual" });

export async function loadDaysRange(from, to) {
  const { data, error } = await sb.from("v_days").select("*")
    .gte("day", from).lte("day", to).order("day");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadSnapshots(day) {
  const { data, error } = await sb.from("account_snapshots")
    .select("ts, equity, kind").eq("day", day).order("ts").limit(2000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadLatestSnapshot() {
  const { data } = await sb.from("account_snapshots")
    .select("ts, equity").order("ts", { ascending: false }).limit(1).maybeSingle();
  return data;
}

export async function loadTrades(from, to) {
  const { data, error } = await sb.from("trades")
    .select("*, trade_notes(*), attachments(id)")
    .gte("day", from).lte("day", to)
    .order("closed_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  // trade_notes: 1-к-1, но PostgREST может вернуть массив — нормализуем
  return (data ?? []).map((t) => ({
    ...t,
    trade_notes: Array.isArray(t.trade_notes) ? (t.trade_notes[0] ?? null) : t.trade_notes,
  }));
}

export async function loadExecutionsWindow(symbol, fromIso, toIso) {
  const { data, error } = await sb.from("executions").select("*")
    .eq("symbol", symbol).gte("exec_time", fromIso).lte("exec_time", toIso)
    .order("exec_time").limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadExecFees(fromIso, toIso) {
  const { data } = await sb.from("executions").select("fee")
    .gte("exec_time", fromIso).lte("exec_time", toIso).limit(5000);
  return (data ?? []).reduce((s, e) => s + (Number(e.fee) || 0), 0);
}

export async function loadCashFlows(from, to) {
  const { data } = await sb.from("cash_flows").select("*")
    .gte("day", from).lte("day", to).order("ts");
  return data ?? [];
}

export async function saveTradeNote(tradeId, patch) {
  const { error } = await sb.from("trade_notes").upsert({
    trade_id: tradeId, ...patch, updated_at: new Date().toISOString(),
  }, { onConflict: "trade_id" });
  if (error) throw new Error(error.message);
}

export async function saveDayOverride(day, patch) {
  const { error } = await sb.from("days").update(patch).eq("day", day);
  if (error) throw new Error(error.message);
}

// ---------- Стратегии ----------

export async function loadStrategies(includeArchived = false) {
  let q = sb.from("strategies").select("*").order("id");
  if (!includeArchived) q = q.eq("archived", false);
  const { data } = await q;
  return data ?? [];
}

export async function addStrategy(name) {
  const { error } = await sb.from("strategies").insert({ name });
  if (error) throw new Error(error.message);
}

export async function updateStrategy(id, patch) {
  const { error } = await sb.from("strategies").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Скриншоты ----------

const MAX_FILE = 10 * 1024 * 1024;
const OK_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadAttachment(tradeId, file) {
  if (!OK_MIME.has(file.type)) throw new Error("Только PNG, JPG или WebP");
  if (file.size > MAX_FILE) throw new Error("Файл больше 10 МБ");
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
  const path = `${tradeId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("screens").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  const { error: e2 } = await sb.from("attachments").insert({
    trade_id: tradeId, path, name: file.name, size: file.size, mime: file.type,
  });
  if (e2) throw new Error(e2.message);
}

export async function loadAttachments(tradeId) {
  const { data } = await sb.from("attachments").select("*").eq("trade_id", tradeId).order("created_at");
  const out = [];
  for (const a of data ?? []) {
    const { data: signed } = await sb.storage.from("screens").createSignedUrl(a.path, 3600);
    out.push({ ...a, url: signed?.signedUrl });
  }
  return out;
}

export async function deleteAttachment(att) {
  await sb.storage.from("screens").remove([att.path]);
  await sb.from("attachments").delete().eq("id", att.id);
}

// ---------- Аналитика ----------

export const runAnalyze = () => callFn("market-analyze", { action: "analyze" });
export const fetchKline = (category, symbol, interval, limit) =>
  callFn("market-analyze", { action: "kline", category, symbol, interval, limit });
export const fetchMetaMissing = () => callFn("coin-meta", { action: "fetch_missing" });
export const fetchMetaFor = (bases) => callFn("coin-meta", { action: "fetch", bases });
export const setCoinId = (base, cg_id) => callFn("coin-meta", { action: "set_id", base, cg_id });

export async function loadLatestRun() {
  const { data: run } = await sb.from("research_runs").select("*")
    .in("status", ["done", "partial"]).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!run) return { run: null, results: [] };
  const { data: results } = await sb.from("research_results").select("*").eq("run_id", run.id);
  return { run, results: results ?? [] };
}

export async function loadCoin(base) {
  const { data } = await sb.from("coins").select("*").eq("base", base).maybeSingle();
  return data;
}

export async function loadInstrumentsFor(base) {
  const { data } = await sb.from("instruments").select("*").eq("base", base);
  return data ?? [];
}
