# -*- coding: utf-8 -*-
"""
УТРЕННИЙ СКАНЕР РЫНКА — «Стратегия 1.0» (14.07.2026)
Три блока по параметрам Ивана (только фьючерсы Bybit, публичный API, без ключей):
  1) Листинги: новые контракты за 7 дней + официальные анонсы листингов;
  2) Разгон: RVOL >= 2 (оборот к среднему за 7/30 дней) И рост >= +5% за 24ч;
  3) Боковик: коридор шириной <= 4% минимум 3 дня, без тренда, с касаниями границ.
Выход: HTML-отчёт в сканер/отчёты/scan_ГГГГ-ММ-ДД.html (+ latest.html).
Запуск: python morning_scan.py [--open]  (--open = открыть в браузере)
"""
import sys, time, math, html
from pathlib import Path
from datetime import datetime, timedelta
import requests

BASE = Path(__file__).parent
OUT_DIR = BASE.parent / "docs"          # отчёт кладётся прямо на сайт
OUT_DIR.mkdir(exist_ok=True)

API = "https://api.bybit.com"
API_FALLBACK = "https://api.bytick.com"  # зеркало Bybit (если основной домен недоступен с сервера)
S = requests.Session()

# ── Параметры Ивана ────────────────────────────────────────────────────────
LISTING_DAYS   = 7      # листинги за последние N дней
RVOL_MIN       = 2.0    # объём сегодня ≥ 2x к среднему
GROWTH_MIN     = 5.0    # рост ≥ +5% за 24ч
MIN_TURNOVER   = 5e6    # блок «разгон»: оборот 24ч ≥ $5M
RANGE_MAX_PCT  = 4.0    # боковик: ширина коридора ≤ 4%
RANGE_MIN_DAYS = 3      # боковик: минимум 3 дня
RANGE_MAX_DAYS = 14     # смотреть окна до 14 дней
SIDE_MIN_TURN  = 3e6    # боковик: оборот 24ч ≥ $3M (отсечь мёртвое)
STABLES = {"USDCUSDT", "USDEUSDT", "DAIUSDT", "FDUSDUSDT", "TUSDUSDT",
           "USDPUSDT", "PYUSDUSDT", "USTCUSDT", "USDYUSDT", "BUSDUSDT"}  # стейблы — не монеты


def get(path, **params):
    for attempt in range(4):
        base = API if attempt < 2 else API_FALLBACK
        try:
            r = S.get(base + path, params=params, timeout=20)
            j = r.json()
            if j.get("retCode") == 0:
                return j["result"]
        except Exception:
            pass
        time.sleep(1 + attempt)
    return None


def fetch_instruments():
    out, cursor = [], ""
    while True:
        res = get("/v5/market/instruments-info", category="linear", limit=1000, cursor=cursor)
        if not res:
            break
        out += res.get("list", [])
        cursor = res.get("nextPageCursor") or ""
        if not cursor:
            break
    return [i for i in out if i.get("symbol", "").endswith("USDT") and i.get("status") == "Trading"]


def fetch_tickers():
    res = get("/v5/market/tickers", category="linear")
    return {t["symbol"]: t for t in (res.get("list", []) if res else [])}


def fetch_daily(symbol, days=35):
    res = get("/v5/market/kline", category="linear", symbol=symbol, interval="D", limit=days)
    if not res:
        return []
    rows = res.get("list", [])
    # Bybit отдаёт от новых к старым; разворачиваем и выкидываем текущий незакрытый день позже
    rows = sorted(rows, key=lambda r: int(r[0]))
    return [dict(ts=int(r[0]), o=float(r[1]), h=float(r[2]), l=float(r[3]),
                 c=float(r[4]), turn=float(r[6])) for r in rows]


def fmt_money(v):
    if v >= 1e9: return f"{v/1e9:.1f} млрд$"
    if v >= 1e6: return f"{v/1e6:.1f} млн$"
    if v >= 1e3: return f"{v/1e3:.0f} тыс$"
    return f"{v:.0f}$"


def scan():
    now = datetime.now()
    print("Загружаю инструменты...", flush=True)
    instruments = fetch_instruments()
    print(f"  контрактов: {len(instruments)}", flush=True)
    tickers = fetch_tickers()

    # ── Блок 1: листинги ───────────────────────────────────────────────────
    listings = []
    cutoff = (now - timedelta(days=LISTING_DAYS)).timestamp() * 1000
    for i in instruments:
        lt = int(i.get("launchTime") or 0)
        if lt >= cutoff:
            t = tickers.get(i["symbol"], {})
            listings.append(dict(
                symbol=i["symbol"],
                launched=datetime.fromtimestamp(lt / 1000).strftime("%d.%m %H:%M"),
                age_days=(now.timestamp() - lt / 1000) / 86400,
                turn=float(t.get("turnover24h") or 0),
                chg=float(t.get("price24hPcnt") or 0) * 100,
                price=t.get("lastPrice", "—")))
    listings.sort(key=lambda x: -x["age_days"] * -1)

    anns = []
    res = get("/v5/announcements/index", locale="en-US", type="new_crypto", limit=10)
    if res:
        for a in res.get("list", []):
            ts = int(a.get("dateTimestamp") or 0)
            anns.append(dict(title=a.get("title", ""),
                             date=datetime.fromtimestamp(ts / 1000).strftime("%d.%m %H:%M") if ts else "—"))

    # ── Кандидаты для блоков 2 и 3 (по обороту) ────────────────────────────
    candidates = [s for s, t in tickers.items()
                  if float(t.get("turnover24h") or 0) >= min(MIN_TURNOVER, SIDE_MIN_TURN)
                  and s.endswith("USDT") and s not in STABLES]
    print(f"Качаю дневную историю по {len(candidates)} монетам...", flush=True)

    movers, ranges = [], []
    for k, sym in enumerate(candidates):
        if k % 50 == 0:
            print(f"  {k}/{len(candidates)}", flush=True)
        d = fetch_daily(sym)
        if len(d) < 5:
            continue
        hist = d[:-1]          # закрытые дни
        today = d[-1]
        t = tickers.get(sym, {})
        turn24 = float(t.get("turnover24h") or 0)
        chg24 = float(t.get("price24hPcnt") or 0) * 100

        # ── Блок 2: разгон ─────────────────────────────────────────────────
        if turn24 >= MIN_TURNOVER and len(hist) >= 7:
            avg7 = sum(x["turn"] for x in hist[-7:]) / 7
            avg30 = sum(x["turn"] for x in hist[-30:]) / min(30, len(hist))
            base = min(avg7, avg30) if avg30 > 0 else avg7
            rvol = turn24 / base if base > 0 else 0
            day_open_chg = (today["c"] / today["o"] - 1) * 100 if today["o"] > 0 else 0
            if rvol >= RVOL_MIN and chg24 >= GROWTH_MIN:
                movers.append(dict(symbol=sym, rvol=rvol, chg24=chg24, day_chg=day_open_chg,
                                   turn=turn24, avg7=avg7, score=rvol * chg24))

        # ── Блок 3: боковик ────────────────────────────────────────────────
        if turn24 >= SIDE_MIN_TURN and len(hist) >= RANGE_MIN_DAYS:
            best = None
            for n in range(RANGE_MIN_DAYS, min(RANGE_MAX_DAYS, len(hist)) + 1):
                win = hist[-n:]
                hi = max(x["h"] for x in win)
                lo = min(x["l"] for x in win)
                mid = (hi + lo) / 2
                width = (hi - lo) / mid * 100
                if width > RANGE_MAX_PCT:
                    continue
                net = abs(win[-1]["c"] / win[0]["o"] - 1) * 100
                if width > 0 and net > width * 0.5:
                    continue  # это тренд, не боковик
                top_t = sum(1 for x in win if x["h"] >= hi - (hi - lo) * 0.25)
                bot_t = sum(1 for x in win if x["l"] <= lo + (hi - lo) * 0.25)
                if top_t < 2 or bot_t < 2:
                    continue
                cand = dict(symbol=sym, days=n, width=width, hi=hi, lo=lo,
                            top_t=top_t, bot_t=bot_t, turn=turn24,
                            pos=(today["c"] - lo) / (hi - lo) * 100 if hi > lo else 50)
                if best is None or n > best["days"]:
                    best = cand
            if best:
                ranges.append(best)

    movers.sort(key=lambda x: -x["score"])
    ranges.sort(key=lambda x: (-x["days"], x["width"]))
    return dict(now=now, listings=listings, anns=anns, movers=movers[:15], ranges=ranges[:25],
                total=len(candidates))


def render(d):
    now = d["now"]
    css = """
    body{background:#131722;color:#d1d4dc;font-family:'Segoe UI',sans-serif;margin:0;padding:24px;max-width:1100px;margin:auto}
    h1{font-size:22px;color:#fff} h2{font-size:17px;color:#fff;margin-top:28px;border-bottom:1px solid #2a2e39;padding-bottom:6px}
    .sum{background:#1e222d;border-radius:10px;padding:14px 18px;font-size:15px;line-height:1.5}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
    th{text-align:left;color:#787b86;font-weight:600;padding:6px 10px;border-bottom:1px solid #2a2e39}
    td{padding:7px 10px;border-bottom:1px solid #1e222d}
    tr:hover td{background:#1e222d}
    .g{color:#26a69a}.r{color:#ef5350}.y{color:#f5d90a}.dim{color:#787b86;font-size:12px}
    .tag{background:#2a2e39;border-radius:5px;padding:2px 7px;font-size:12px}
    """
    def esc(s): return html.escape(str(s))

    lst_rows = "".join(
        f"<tr><td><b>{esc(x['symbol'])}</b></td><td>{esc(x['launched'])}</td>"
        f"<td>{fmt_money(x['turn'])}</td>"
        f"<td class='{'g' if x['chg']>=0 else 'r'}'>{x['chg']:+.1f}%</td><td>{esc(x['price'])}</td></tr>"
        for x in d["listings"]) or "<tr><td colspan=5 class=dim>Новых листингов за 7 дней нет</td></tr>"
    ann_rows = "".join(f"<div class=dim>• {esc(a['date'])} — {esc(a['title'])}</div>" for a in d["anns"])

    mov_rows = "".join(
        f"<tr><td><b>{esc(x['symbol'])}</b></td>"
        f"<td class=y>×{x['rvol']:.1f}</td>"
        f"<td class='g'>{x['chg24']:+.1f}%</td>"
        f"<td class='{'g' if x['day_chg']>=0 else 'r'}'>{x['day_chg']:+.1f}%</td>"
        f"<td>{fmt_money(x['turn'])}</td><td class=dim>{fmt_money(x['avg7'])}/день</td></tr>"
        for x in d["movers"]) or f"<tr><td colspan=6 class=dim>Сегодня нет монет с объёмом ≥{RVOL_MIN}× и ростом ≥+{GROWTH_MIN:.0f}%</td></tr>"

    rng_rows = "".join(
        f"<tr><td><b>{esc(x['symbol'])}</b></td><td>{x['days']} дн.</td>"
        f"<td>{x['width']:.1f}%</td>"
        f"<td class=g>{x['lo']:g}</td><td class=r>{x['hi']:g}</td>"
        f"<td>{x['pos']:.0f}%</td>"
        f"<td class=dim>верх ×{x['top_t']} / низ ×{x['bot_t']}</td>"
        f"<td>{fmt_money(x['turn'])}</td></tr>"
        for x in d["ranges"]) or "<tr><td colspan=8 class=dim>Боковиков по критериям не найдено</td></tr>"

    top_mover = d["movers"][0]["symbol"] + f" (объём ×{d['movers'][0]['rvol']:.1f}, {d['movers'][0]['chg24']:+.0f}%)" if d["movers"] else "нет"
    top_range = d["ranges"][0]["symbol"] + f" ({d['ranges'][0]['days']} дн., {d['ranges'][0]['width']:.1f}%)" if d["ranges"] else "нет"

    return f"""<!DOCTYPE html><html lang=ru><head><meta charset=utf-8>
<title>Утренний скан {now:%d.%m.%Y}</title><style>{css}</style></head><body>
<h1>☀️ Утренний скан — {now:%d.%m.%Y %H:%M}</h1>
<div class=sum><b>Сводка:</b> листингов за 7 дней — <b>{len(d['listings'])}</b> ·
монет в разгоне — <b>{len(d['movers'])}</b> (лучшая: {esc(top_mover)}) ·
боковиков — <b>{len(d['ranges'])}</b> (самый устойчивый: {esc(top_range)}).
<span class=dim>Проверено {d['total']} контрактов Bybit (фьючерсы).</span></div>

<h2>🆕 Листинги за {LISTING_DAYS} дней</h2>
<table><tr><th>Монета</th><th>Запуск</th><th>Оборот 24ч</th><th>Изм. 24ч</th><th>Цена</th></tr>{lst_rows}</table>
<div style=margin-top:8px><span class=tag>Анонсы Bybit</span></div>{ann_rows}

<h2>🚀 Разгон: объём ≥{RVOL_MIN:.0f}× к среднему и рост ≥+{GROWTH_MIN:.0f}%</h2>
<table><tr><th>Монета</th><th>Объём к среднему</th><th>Рост 24ч</th><th>От открытия дня</th><th>Оборот 24ч</th><th>Обычный оборот</th></tr>{mov_rows}</table>
<div class=sum style="margin-top:8px;font-size:13px">📊 <b>Статистика всплесков</b> (2670 событий, 2 года): типичный ход после всплеска <b>+4%</b> (каждый 4-й даёт +8%, каждый 10-й +13-16%), пик обычно через ~сутки. Размер всплеска (×2 или ×10) на ход почти не влияет. <b>Вдогонку не входить</b> — через 24ч в среднем 0%: вход только на откате ~−1…−2% при совпадении со структурой. Затухание объёма — НЕ конец роста (в 78% пик позже); маркеры конца: +4…8% достигнуто, прошло >30ч, обратная дивергенция RSI, красный всплеск объёма.</div>

<h2>↔️ Боковики: коридор ≤{RANGE_MAX_PCT:.0f}% минимум {RANGE_MIN_DAYS} дня</h2>
<table><tr><th>Монета</th><th>Дней</th><th>Ширина</th><th>Низ</th><th>Верх</th><th>Цена в коридоре</th><th>Касания</th><th>Оборот 24ч</th></tr>{rng_rows}</table>
<div class=dim style=margin-top:6px>«Цена в коридоре»: 0% = у нижней границы, 100% = у верхней. Касания — сколько дней цена была в верхней/нижней четверти коридора.</div>

<div class=dim style="margin-top:26px">Данные: публичный API Bybit (фьючерсы USDT). Параметры Ивана: разгон RVOL≥{RVOL_MIN:.0f}×, рост≥+{GROWTH_MIN:.0f}%, оборот≥{fmt_money(MIN_TURNOVER)}; боковик ≤{RANGE_MAX_PCT:.0f}%, ≥{RANGE_MIN_DAYS} дн., касания ≥2+2. Файл: {now:%Y-%m-%d}.</div>
</body></html>"""


if __name__ == "__main__":
    t0 = time.time()
    data = scan()
    html_text = render(data)
    day_file = OUT_DIR / "scan.html"
    day_file.write_text(html_text, encoding="utf-8")
    print(f"Готово за {time.time()-t0:.0f} сек: {day_file}")
    print(f"Листинги: {len(data['listings'])} | Разгон: {len(data['movers'])} | Боковики: {len(data['ranges'])}")
    if "--open" in sys.argv:
        import os
        os.startfile(day_file)
