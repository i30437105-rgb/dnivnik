// Симулятор: хранение в Supabase (sim_accounts / sim_sessions / sim_trades)
// и автоскрины в Storage screens по пути sim/<trade_id>/entry.png|exit.png.
import { sb } from "../supa.js";

// ---------- Счёт (эпохи) ----------

export async function loadActiveAccount() {
  const { data, error } = await sb.from("sim_accounts").select("*")
    .is("closed_at", null).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createAccount(deposit) {
  const { data, error } = await sb.from("sim_accounts")
    .insert({ start_deposit: deposit, balance: deposit }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Обнуление: закрываем эпоху (история остаётся), новую создаёт createAccount
export async function closeAccount(id) {
  const { error } = await sb.from("sim_accounts")
    .update({ closed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateAccountBalance(id, balance) {
  const { error } = await sb.from("sim_accounts").update({ balance }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function loadAccountTotals(accountId) {
  const [s, t] = await Promise.all([
    sb.from("sim_sessions").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    sb.from("sim_trades").select("id, sim_sessions!inner(account_id)", { count: "exact", head: true })
      .eq("sim_sessions.account_id", accountId),
  ]);
  return { sessions: s.count ?? 0, trades: t.count ?? 0 };
}

// ---------- Сессии ----------

export async function createSession(row) {
  const { data, error } = await sb.from("sim_sessions").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function finishSession(id) {
  const { error } = await sb.from("sim_sessions")
    .update({ finished_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Сделки ----------

export async function insertSimTrade(row) {
  const { data, error } = await sb.from("sim_trades").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function closeSimTrade(id, patch) {
  const { error } = await sb.from("sim_trades").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// Последние сделки счёта (для списка на этапе 1; полная статистика — этап 2)
export async function loadRecentTrades(accountId, limit = 30) {
  const { data, error } = await sb.from("sim_trades")
    .select("*, sim_sessions!inner(account_id, symbol, timeframe)")
    .eq("sim_sessions.account_id", accountId)
    .order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- Автоскрины ----------

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// kind: 'entry' | 'exit'; скрин снимает система — пользователь ничего не сохраняет
export async function uploadSimShot(tradeId, kind, dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const path = `sim/${tradeId}/${kind}.png`;
  const { error } = await sb.storage.from("screens")
    .upload(path, blob, { contentType: "image/png", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

export async function simShotUrl(tradeId, kind) {
  const { data } = await sb.storage.from("screens")
    .createSignedUrl(`sim/${tradeId}/${kind}.png`, 3600);
  return data?.signedUrl ?? null;
}
