// ДНЕВНИК v2 — синхронизация с Bybit (Supabase Edge Function, Deno)
// Задачи (body.task):
//   auto      — cron каждые 10 минут: снимок equity + импорт; в 00:0x местного
//               времени сам становится day_start (снимок начала дня)
//   day_start — принудительный снимок начала дня
//   manual    — кнопка «Обновить» на сайте
// Секреты: BYBIT_KEY, BYBIT_SECRET (read-only, права: Unified Trading + Assets — чтение)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY подставляются автоматически.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.bybit.com";
const STABLES = new Set(["USDT", "USDC", "DAI", "USD", "BUSD", "TUSD"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  if (j.retCode !== 0) throw new Error(`Bybit ${path}: [${j.retCode}] ${j.retMsg}`);
  return j.result;
}

// Дата и время в часовом поясе пользователя
function localParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const startedAt = Date.now();
  const warnings: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    const task: string = body.task ?? "manual";

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await sb.from("user_settings").select("*").eq("id", 1).single();
    const tz = settings?.timezone ?? "Europe/Moscow";
    const now = new Date();
    const local = localParts(now, tz);
    const today = local.date;

    // ---------- 1. Снимок баланса (total equity, Unified) ----------
    const wallet = await bybitGet("/v5/account/wallet-balance", { accountType: "UNIFIED" });
    const equity = parseFloat(wallet.list?.[0]?.totalEquity ?? "0");
    const upl = wallet.list?.[0]?.totalPerpUPL != null ? parseFloat(wallet.list[0].totalPerpUPL) : null;

    // Является ли этот запуск снимком начала дня
    const { data: existingStart } = await sb.from("account_snapshots")
      .select("id").eq("day", today).eq("kind", "day_start").limit(1);
    const isDayStart = task === "day_start" ||
      (task === "auto" && local.hour === 0 && local.minute < 10 && !existingStart?.length);

    await sb.from("account_snapshots").insert({
      ts: now.toISOString(), equity, upl,
      kind: isDayStart ? "day_start" : (task === "auto" ? "auto" : "manual"),
      day: today, accurate: true,
    });

    // ---------- 2. Строка дня ----------
    const { data: dayRow } = await sb.from("days").select("day, start_accurate").eq("day", today).maybeSingle();
    if (isDayStart) {
      // точный старт дня: создаём или уточняем существующий приблизительный
      await sb.from("days").upsert(
        { day: today, start_balance: equity, start_accurate: true }, { onConflict: "day" });

      // Кубышка (вариант А): в полночь откладываем % от прибыли ЗАВЕРШИВШЕГОСЯ дня.
      // Прибыль дня — РЕАЛИЗОВАННАЯ (закрытые сделки + фандинг), без плавающего PnL открытых позиций:
      // (equity сейчас − UPL сейчас) − (старт вчера − UPL на старте вчера) − вчерашние пополнения/выводы.
      try {
        if (settings?.vault_start_day) {
          const yday = localParts(new Date(now.getTime() - 86400_000), tz).date;
          if (yday >= settings.vault_start_day) {
            const { data: yRow } = await sb.from("days").select("start_balance").eq("day", yday).maybeSingle();
            if (yRow) {
              const { data: yFlows } = await sb.from("cash_flows").select("type, amount_usd").eq("day", yday);
              // защита: движение средств без оценки в USD исказило бы «прибыль» — фиксацию пропускаем
              if ((yFlows ?? []).some((f) => f.amount_usd == null)) {
                warnings.push(`Кубышка: фиксация за ${yday} пропущена — есть движение средств без оценки в USD, внесите корректировку вручную`);
              } else {
                // пополнения/переводы — это тело депозита, из прибыли исключаются полностью
                const net = (yFlows ?? []).reduce((s, f) =>
                  s + (f.type === "deposit" || f.type === "transfer_in" ? 1 : -1) * Number(f.amount_usd), 0);
                const { data: yStartSnap } = await sb.from("account_snapshots")
                  .select("upl").eq("day", yday).order("ts", { ascending: true }).limit(1).maybeSingle();
                const r = (equity - (upl ?? 0)) -
                  (Number(yRow.start_balance) - Number(yStartSnap?.upl ?? 0)) - net;
                if (r > 0) {
                  const pctV = Number(settings.vault_pct ?? 50);
                  const { error } = await sb.from("vault_ledger").insert({
                    day: yday, type: "accrual", amount: r * pctV / 100,
                    note: `${pctV}% от прибыли дня ${(r).toFixed(2)}$`,
                  });
                  if (error && !/duplicate|unique/i.test(error.message)) warnings.push(`Кубышка: ${error.message}`);
                }
              }
            }
          }
        }
      } catch (e) { warnings.push(`Кубышка: ${String(e)}`); }
    } else if (!dayRow) {
      // снимок 00:00 пропущен — берём первый доступный, помечаем «приблизительно» (по ТЗ 5.2)
      await sb.from("days").insert({ day: today, start_balance: equity, start_accurate: false });
      warnings.push("Снимок 00:00 отсутствовал — старт дня зафиксирован приблизительно");
    }

    const nowMs = Date.now();
    const sinceStr = String(nowMs - 7 * 86400_000);
    // у asset-эндпоинтов Bybit окно должно быть СТРОГО меньше 7 суток
    const flowSinceStr = String(nowMs - Math.floor(6.9 * 86400_000));
    const flowEndStr = String(nowMs);

    // ---------- 3. Закрытые сделки (closed-pnl), 7 дней ----------
    let savedTrades = 0;
    {
      let cursor = "";
      do {
        const res = await bybitGet("/v5/position/closed-pnl", {
          category: "linear", startTime: sinceStr, limit: "100",
          ...(cursor ? { cursor } : {}),
        });
        for (const t of res.list ?? []) {
          const closedAt = new Date(parseInt(t.updatedTime));
          const { error } = await sb.from("trades").upsert({
            id: t.orderId,
            symbol: t.symbol,
            side: t.side === "Sell" ? "Buy" : "Sell", // closed-pnl отдаёт сторону ЗАКРЫТИЯ
            qty: parseFloat(t.qty),
            entry_price: parseFloat(t.avgEntryPrice),
            exit_price: parseFloat(t.avgExitPrice),
            pnl: parseFloat(t.closedPnl),
            open_fee: t.openFee != null ? parseFloat(t.openFee) : null,
            close_fee: t.closeFee != null ? parseFloat(t.closeFee) : null,
            leverage: t.leverage ?? null,
            opened_at: new Date(parseInt(t.createdTime)).toISOString(),
            closed_at: closedAt.toISOString(),
            day: localParts(closedAt, tz).date,
            raw: t,
          }, { onConflict: "id" });
          if (!error) savedTrades++;
        }
        cursor = res.nextPageCursor ?? "";
      } while (cursor);
    }

    // ---------- 4. Исполнения (fills), 7 дней ----------
    let savedExecs = 0;
    try {
      let cursor = "";
      do {
        const res = await bybitGet("/v5/execution/list", {
          category: "linear", startTime: sinceStr, limit: "100",
          ...(cursor ? { cursor } : {}),
        });
        for (const e of res.list ?? []) {
          if (e.execType && e.execType !== "Trade") continue;
          const { error } = await sb.from("executions").upsert({
            id: e.execId,
            order_id: e.orderId,
            symbol: e.symbol,
            side: e.side,
            price: parseFloat(e.execPrice),
            qty: parseFloat(e.execQty),
            fee: e.execFee != null ? parseFloat(e.execFee) : null,
            fee_rate: e.feeRate != null ? parseFloat(e.feeRate) : null,
            is_maker: e.isMaker ?? null,
            order_type: e.orderType ?? null,
            exec_time: new Date(parseInt(e.execTime)).toISOString(),
            raw: e,
          }, { onConflict: "id" });
          if (!error) savedExecs++;
        }
        cursor = res.nextPageCursor ?? "";
      } while (cursor);
    } catch (e) {
      warnings.push(`Исполнения не загружены: ${String(e)}`);
    }

    // ---------- 5. Денежные потоки, 7 дней ----------
    let savedFlows = 0;
    const usd = (coin: string, amount: number) => STABLES.has(coin) ? amount : null;
    const saveFlow = async (row: Record<string, unknown>) => {
      const { error } = await sb.from("cash_flows").upsert(row, { onConflict: "id" });
      if (!error) savedFlows++;
    };
    // Пополнения
    try {
      const res = await bybitGet("/v5/asset/deposit/query-record",
        { startTime: flowSinceStr, endTime: flowEndStr, limit: "50" });
      for (const d of res.rows ?? []) {
        if (String(d.status) !== "3") continue; // 3 = success
        const ts2 = new Date(parseInt(d.successAt));
        const amount = parseFloat(d.amount);
        await saveFlow({
          id: `dep_${d.txID || d.id || d.successAt + d.coin}`,
          ts: ts2.toISOString(), day: localParts(ts2, tz).date,
          type: "deposit", coin: d.coin, amount, amount_usd: usd(d.coin, amount), raw: d,
        });
      }
    } catch (e) { warnings.push(`Пополнения: ${String(e)}`); }
    // Выводы
    try {
      const res = await bybitGet("/v5/asset/withdraw/query-record",
        { startTime: flowSinceStr, endTime: flowEndStr, limit: "50" });
      for (const w of res.rows ?? []) {
        if (w.status !== "success") continue;
        const ts2 = new Date(parseInt(w.updateTime || w.createTime));
        const amount = parseFloat(w.amount);
        await saveFlow({
          id: `wd_${w.withdrawId}`,
          ts: ts2.toISOString(), day: localParts(ts2, tz).date,
          type: "withdrawal", coin: w.coin, amount, amount_usd: usd(w.coin, amount), raw: w,
        });
      }
    } catch (e) { warnings.push(`Выводы: ${String(e)}`); }
    // Внутренние переводы (FUND <-> UNIFIED): считаем поток относительно UNIFIED
    try {
      const res = await bybitGet("/v5/asset/transfer/query-inter-transfer-list",
        { startTime: flowSinceStr, endTime: flowEndStr, limit: "50" });
      for (const tr of res.list ?? []) {
        if (tr.status !== "SUCCESS") continue;
        const toUnified = tr.toAccountType === "UNIFIED";
        const fromUnified = tr.fromAccountType === "UNIFIED";
        if (toUnified === fromUnified) continue; // не касается UNIFIED
        const ts2 = new Date(parseInt(tr.timestamp));
        const amount = parseFloat(tr.amount);
        await saveFlow({
          id: `tr_${tr.transferId}`,
          ts: ts2.toISOString(), day: localParts(ts2, tz).date,
          type: toUnified ? "transfer_in" : "transfer_out",
          coin: tr.coin, amount, amount_usd: usd(tr.coin, amount), raw: tr,
        });
      }
    } catch (e) { warnings.push(`Переводы: ${String(e)}`); }

    // ---------- 5б. Реальный вывод с биржи списывает кубышку ----------
    try {
      if (settings?.vault_start_day) {
        const { data: outs } = await sb.from("cash_flows").select("id, day, amount_usd")
          .in("type", ["withdrawal", "transfer_out"]).gte("day", settings.vault_start_day);
        if (outs?.length) {
          const { data: led } = await sb.from("vault_ledger").select("amount, note");
          const noted = new Set((led ?? []).map((l) => l.note));
          let bal = (led ?? []).reduce((s, l) => s + Number(l.amount), 0);
          for (const o of outs) {
            const key = `flow:${o.id}`;
            if (noted.has(key) || o.amount_usd == null) continue;
            const take = Math.min(bal, Number(o.amount_usd));
            if (take <= 0) continue;
            await sb.from("vault_ledger").insert({ day: o.day, type: "withdrawal", amount: -take, note: key });
            bal -= take;
          }
        }
      }
    } catch (e) { warnings.push(`Кубышка/выводы: ${String(e)}`); }

    // ---------- 6. Статус ----------
    await sb.from("sync_status").upsert({
      id: "diary", last_ok: new Date().toISOString(),
      detail: { task, equity, savedTrades, savedExecs, savedFlows, warnings, ms: Date.now() - startedAt },
    }, { onConflict: "id" });

    return new Response(JSON.stringify({
      ok: true, task, day: today, isDayStart, equity,
      savedTrades, savedExecs, savedFlows, warnings,
    }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e) {
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await sb.from("sync_status").upsert({
        id: "diary", last_error: String(e), last_error_at: new Date().toISOString(),
      }, { onConflict: "id" });
    } catch { /* статус недоступен — отдаём только ответ */ }
    return new Response(JSON.stringify({ ok: false, error: String(e), warnings }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
