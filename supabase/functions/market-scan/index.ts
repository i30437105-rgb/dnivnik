// УТРЕННИЙ СКАНЕР — Supabase Edge Function (14.07.2026)
// Сканирует фьючерсы Bybit по параметрам Ивана и кладёт HTML-отчёт в таблицу scan_reports.
// Секретов не требует (публичный API); пишет в базу встроенным service-ключом.
import { createClient } from "npm:@supabase/supabase-js@2";

const APIS = ["https://api.bybit.com", "https://api.bytick.com"];
const LISTING_DAYS = 7, RVOL_MIN = 2, GROWTH_MIN = 5, MIN_TURN = 5e6;
const RANGE_MAX = 4, RANGE_MIN_D = 3, RANGE_MAX_D = 14, SIDE_MIN_TURN = 3e6;
const STABLES = new Set(["USDCUSDT","USDEUSDT","DAIUSDT","FDUSDUSDT","TUSDUSDT","USDPUSDT","PYUSDUSDT","USTCUSDT","USDYUSDT","BUSDUSDT"]);

async function get(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  for (const base of APIS) {
    for (let a = 0; a < 2; a++) {
      try {
        const r = await fetch(`${base}${path}?${qs}`);
        const j = await r.json();
        if (j.retCode === 0) return j.result;
      } catch (_) { /* retry */ }
    }
  }
  return null;
}

const fmtMoney = (v: number) =>
  v >= 1e9 ? (v/1e9).toFixed(1)+" млрд$" : v >= 1e6 ? (v/1e6).toFixed(1)+" млн$" :
  v >= 1e3 ? (v/1e3).toFixed(0)+" тыс$" : v.toFixed(0)+"$";
const esc = (s: unknown) => String(s ?? "").replace(/</g, "&lt;");

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const t0 = Date.now();
    // Инструменты (с пагинацией) + тикеры + анонсы
    let instruments: any[] = [], cursor = "";
    do {
      const res = await get("/v5/market/instruments-info", { category: "linear", limit: "1000", ...(cursor ? { cursor } : {}) });
      if (!res) break;
      instruments = instruments.concat(res.list ?? []);
      cursor = res.nextPageCursor ?? "";
    } while (cursor);
    instruments = instruments.filter(i => i.symbol.endsWith("USDT") && i.status === "Trading");
    const tickRes = await get("/v5/market/tickers", { category: "linear" });
    const tickers: Record<string, any> = {};
    for (const t of tickRes?.list ?? []) tickers[t.symbol] = t;
    const annRes = await get("/v5/announcements/index", { locale: "en-US", type: "new_crypto", limit: "10" });

    const now = new Date();
    const mskNow = new Date(now.getTime() + 3 * 3600e3);
    const cutoff = Date.now() - LISTING_DAYS * 86400e3;
    const listings = instruments
      .filter(i => parseInt(i.launchTime || "0") >= cutoff)
      .map(i => {
        const t = tickers[i.symbol] ?? {};
        const lt = new Date(parseInt(i.launchTime) + 3 * 3600e3);
        return { symbol: i.symbol, launched: `${String(lt.getUTCDate()).padStart(2,"0")}.${String(lt.getUTCMonth()+1).padStart(2,"0")} ${String(lt.getUTCHours()).padStart(2,"0")}:${String(lt.getUTCMinutes()).padStart(2,"0")}`,
          turn: parseFloat(t.turnover24h ?? "0"), chg: parseFloat(t.price24hPcnt ?? "0") * 100, price: t.lastPrice ?? "—", ts: parseInt(i.launchTime) };
      }).sort((a, b) => b.ts - a.ts);
    const anns = (annRes?.list ?? []).map((a: any) => {
      const d = new Date(parseInt(a.dateTimestamp) + 3 * 3600e3);
      return { title: a.title, date: `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}` };
    });

    // Кандидаты
    const candidates = Object.keys(tickers).filter(s =>
      s.endsWith("USDT") && !STABLES.has(s) && parseFloat(tickers[s].turnover24h ?? "0") >= Math.min(MIN_TURN, SIDE_MIN_TURN));

    const movers: any[] = [], ranges: any[] = [];
    await pool(candidates, 12, async (sym) => {
      const res = await get("/v5/market/kline", { category: "linear", symbol: sym, interval: "D", limit: "35" });
      const rows = (res?.list ?? []).sort((a: any, b: any) => parseInt(a[0]) - parseInt(b[0]))
        .map((r: any) => ({ o: +r[1], h: +r[2], l: +r[3], c: +r[4], turn: +r[6] }));
      if (rows.length < 5) return;
      const hist = rows.slice(0, -1), today = rows[rows.length - 1];
      const t = tickers[sym];
      const turn24 = parseFloat(t.turnover24h ?? "0");
      const chg24 = parseFloat(t.price24hPcnt ?? "0") * 100;

      if (turn24 >= MIN_TURN && hist.length >= 7) {
        const avg7 = hist.slice(-7).reduce((s: number, x: any) => s + x.turn, 0) / 7;
        const last30 = hist.slice(-30);
        const avg30 = last30.reduce((s: number, x: any) => s + x.turn, 0) / last30.length;
        const base = Math.min(avg7, avg30 || avg7);
        const rvol = base > 0 ? turn24 / base : 0;
        if (rvol >= RVOL_MIN && chg24 >= GROWTH_MIN)
          movers.push({ symbol: sym, rvol, chg24, dayChg: today.o > 0 ? (today.c / today.o - 1) * 100 : 0, turn: turn24, avg7, score: rvol * chg24 });
      }
      if (turn24 >= SIDE_MIN_TURN && hist.length >= RANGE_MIN_D) {
        let best: any = null;
        for (let n = RANGE_MIN_D; n <= Math.min(RANGE_MAX_D, hist.length); n++) {
          const win = hist.slice(-n);
          const hi = Math.max(...win.map((x: any) => x.h)), lo = Math.min(...win.map((x: any) => x.l));
          const width = (hi - lo) / ((hi + lo) / 2) * 100;
          if (width > RANGE_MAX) continue;
          const net = Math.abs(win[win.length - 1].c / win[0].o - 1) * 100;
          if (width > 0 && net > width * 0.5) continue;
          const topT = win.filter((x: any) => x.h >= hi - (hi - lo) * 0.25).length;
          const botT = win.filter((x: any) => x.l <= lo + (hi - lo) * 0.25).length;
          if (topT < 2 || botT < 2) continue;
          best = { symbol: sym, days: n, width, hi, lo, topT, botT, turn: turn24, pos: hi > lo ? (today.c - lo) / (hi - lo) * 100 : 50 };
        }
        if (best) ranges.push(best);
      }
    });
    movers.sort((a, b) => b.score - a.score);
    ranges.sort((a, b) => b.days - a.days || a.width - b.width);
    const topM = movers.slice(0, 15), topR = ranges.slice(0, 25);

    // HTML (стиль как у дневника)
    const dt = `${String(mskNow.getUTCDate()).padStart(2,"0")}.${String(mskNow.getUTCMonth()+1).padStart(2,"0")}.${mskNow.getUTCFullYear()} ${String(mskNow.getUTCHours()).padStart(2,"0")}:${String(mskNow.getUTCMinutes()).padStart(2,"0")}`;
    const css = `body{background:#131722;color:#d1d4dc;font-family:'Segoe UI',sans-serif;margin:0;padding:18px}
h1{font-size:19px;color:#fff}h2{font-size:16px;color:#fff;margin-top:26px;border-bottom:1px solid #2a2e39;padding-bottom:6px}
.sum{background:#1e222d;border-radius:10px;padding:12px 16px;font-size:14px;line-height:1.5}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
th{text-align:left;color:#787b86;font-weight:600;padding:6px 10px;border-bottom:1px solid #2a2e39}
td{padding:7px 10px;border-bottom:1px solid #1e222d}tr:hover td{background:#1e222d}
.g{color:#26a69a}.r{color:#ef5350}.y{color:#f5d90a}.dim{color:#787b86;font-size:12px}`;
    const lstRows = listings.map(x =>
      `<tr><td><b>${esc(x.symbol)}</b></td><td>${x.launched}</td><td>${fmtMoney(x.turn)}</td><td class="${x.chg>=0?'g':'r'}">${x.chg>=0?'+':''}${x.chg.toFixed(1)}%</td><td>${esc(x.price)}</td></tr>`).join("")
      || `<tr><td colspan=5 class=dim>Новых листингов за ${LISTING_DAYS} дней нет</td></tr>`;
    const annRows = anns.map((a: any) => `<div class=dim>• ${a.date} — ${esc(a.title)}</div>`).join("");
    const movRows = topM.map(x =>
      `<tr><td><b>${esc(x.symbol)}</b></td><td class=y>×${x.rvol.toFixed(1)}</td><td class=g>+${x.chg24.toFixed(1)}%</td><td class="${x.dayChg>=0?'g':'r'}">${x.dayChg>=0?'+':''}${x.dayChg.toFixed(1)}%</td><td>${fmtMoney(x.turn)}</td><td class=dim>${fmtMoney(x.avg7)}/день</td></tr>`).join("")
      || `<tr><td colspan=6 class=dim>Сегодня нет монет с объёмом ≥${RVOL_MIN}× и ростом ≥+${GROWTH_MIN}%</td></tr>`;
    const rngRows = topR.map(x =>
      `<tr><td><b>${esc(x.symbol)}</b></td><td>${x.days} дн.</td><td>${x.width.toFixed(1)}%</td><td class=g>${x.lo}</td><td class=r>${x.hi}</td><td>${x.pos.toFixed(0)}%</td><td class=dim>верх ×${x.topT} / низ ×${x.botT}</td><td>${fmtMoney(x.turn)}</td></tr>`).join("")
      || `<tr><td colspan=8 class=dim>Боковиков по критериям не найдено</td></tr>`;
    const topMs = topM[0] ? `${topM[0].symbol} (объём ×${topM[0].rvol.toFixed(1)}, +${topM[0].chg24.toFixed(0)}%)` : "нет";
    const topRs = topR[0] ? `${topR[0].symbol} (${topR[0].days} дн., ${topR[0].width.toFixed(1)}%)` : "нет";
    const html = `<!DOCTYPE html><html lang=ru><head><meta charset=utf-8><style>${css}</style></head><body>
<h1>☀️ Утренний скан — ${dt} МСК</h1>
<div class=sum><b>Сводка:</b> листингов за ${LISTING_DAYS} дней — <b>${listings.length}</b> · в разгоне — <b>${topM.length}</b> (лучшая: ${esc(topMs)}) · боковиков — <b>${topR.length}</b> (устойчивый: ${esc(topRs)}). <span class=dim>Проверено ${candidates.length} контрактов за ${((Date.now()-t0)/1000).toFixed(0)} сек.</span></div>
<h2>🆕 Листинги</h2><table><tr><th>Монета</th><th>Запуск (МСК)</th><th>Оборот 24ч</th><th>Изм. 24ч</th><th>Цена</th></tr>${lstRows}</table>
<div style=margin-top:8px class=dim><b>Анонсы Bybit:</b></div>${annRows}
<h2>🚀 Разгон: объём ≥${RVOL_MIN}× и рост ≥+${GROWTH_MIN}%</h2><table><tr><th>Монета</th><th>Объём к среднему</th><th>Рост 24ч</th><th>От открытия дня</th><th>Оборот 24ч</th><th>Обычный оборот</th></tr>${movRows}</table>
<div class=sum style="margin-top:8px;font-size:12px">📊 Статистика всплесков (2670 событий, 2 года): типичный ход <b>+4%</b> (каждый 4-й +8%), пик через ~сутки. Вдогонку не входить — вход на откате −1…−2% при совпадении со структурой. Затухание объёма — не конец роста.</div>
<h2>↔️ Боковики: ≤${RANGE_MAX}% минимум ${RANGE_MIN_D} дня</h2><table><tr><th>Монета</th><th>Дней</th><th>Ширина</th><th>Низ</th><th>Верх</th><th>Цена в коридоре</th><th>Касания</th><th>Оборот 24ч</th></tr>${rngRows}</table>
<div class=dim style=margin-top:6px>«Цена в коридоре»: 0% = у нижней границы (интересно для лонга), 100% = у верхней.</div>
</body></html>`;

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await sb.from("scan_reports").upsert({ id: 1, html, updated_at: new Date().toISOString() });
    return new Response(JSON.stringify({ ok: true, listings: listings.length, movers: topM.length, ranges: topR.length, sec: (Date.now()-t0)/1000 }),
      { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
  }
});
