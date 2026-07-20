// ДНЕВНИК — синхронизация с Bybit (Supabase Edge Function, Deno)
// Тянет закрытые сделки (closed-pnl) и баланс; фиксирует баланс начала дня.
// Секреты (Dashboard → Edge Functions → Secrets) — нужны только ДВА:
//   BYBIT_KEY, BYBIT_SECRET — read-only ключ Ивана
// (URL проекта и service-ключ Supabase подставляет автоматически)
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.bybit.com";

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function bybitGet(path: string, params: Record<string, string>) {
  const key = Deno.env.get("BYBIT_KEY")!;
  const secret = Deno.env.get("BYBIT_SECRET")!;
  const ts = Date.now().toString();
  const recv = "20000";
  const qs = new URLSearchParams(params).toString();
  const sig = await sign(secret, ts + key + recv + qs);
  const r = await fetch(`${API}${path}?${qs}`, {
    headers: {
      "X-BAPI-API-KEY": key, "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv, "X-BAPI-SIGN": sig,
    },
  });
  const j = await r.json();
  if (j.retCode !== 0) throw new Error(`Bybit ${path}: ${j.retMsg}`);
  return j.result;
}

Deno.serve(async () => {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_KEY")!);

    // 1) Баланс (UNIFIED equity)
    const wallet = await bybitGet("/v5/account/wallet-balance", { accountType: "UNIFIED" });
    const equity = parseFloat(wallet.list?.[0]?.totalEquity ?? "0");

    // 2) Закрытые сделки за последние 7 дней (с пагинацией)
    const start = (Date.now() - 7 * 86400_000).toString();
    let cursor = "";
    let saved = 0;
    let todayPnl = 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    do {
      const res = await bybitGet("/v5/position/closed-pnl", {
        category: "linear", startTime: start, limit: "100",
        ...(cursor ? { cursor } : {}),
      });
      for (const t of res.list ?? []) {
        const closedAt = new Date(parseInt(t.updatedTime));
        const pnl = parseFloat(t.closedPnl);
        if (closedAt.toISOString().slice(0, 10) === todayStr) todayPnl += pnl;
        const { error } = await sb.from("trades").upsert({
          id: t.orderId,
          symbol: t.symbol,
          side: t.side === "Sell" ? "Buy" : "Sell", // closed-pnl отдаёт сторону ЗАКРЫТИЯ
          qty: parseFloat(t.qty),
          entry_price: parseFloat(t.avgEntryPrice),
          exit_price: parseFloat(t.avgExitPrice),
          pnl,
          opened_at: new Date(parseInt(t.createdTime)).toISOString(),
          closed_at: closedAt.toISOString(),
        }, { onConflict: "id", ignoreDuplicates: false });
        if (!error) saved++;
      }
      cursor = res.nextPageCursor ?? "";
    } while (cursor);

    // 3) Баланс начала дня: первый синк за день фиксирует equity минус уже сделанный за день pnl
    const { data: dayRow } = await sb.from("days").select("day").eq("day", todayStr).maybeSingle();
    if (!dayRow) {
      await sb.from("days").insert({ day: todayStr, start_balance: equity - todayPnl });
    }

    return new Response(JSON.stringify({ ok: true, equity, saved, todayPnl }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
