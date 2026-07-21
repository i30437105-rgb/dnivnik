// Развёрнутая карточка монеты (ТЗ §4.2): описание, команда, даты, график, источники
import { loadCoin, loadInstrumentsFor, fetchKline, fetchMetaFor, setCoinId } from "./api.js";
import { esc, usd, pct, price, fmtDT, openModal } from "./util.js";

// Диапазоны графика: [подпись, категория интервала Bybit, свечей]
const RANGES = {
  "6h-5m": { label: "6 ч / 5 мин", interval: "5", limit: 72 },
  "24h-15m": { label: "24 ч / 15 мин", interval: "15", limit: 96 },
  "7d-1h": { label: "7 дн / 1 час", interval: "60", limit: 168 },
};

export async function openCoinCard(base, symbol) {
  const modal = openModal(`<div class="loading">Загружаю ${esc(base)}…</div>`, { wide: true });
  try {
    let [coin, instruments] = await Promise.all([loadCoin(base), loadInstrumentsFor(base)]);
    if (!coin || !coin.meta_updated_at) {
      // первая встреча с монетой — пробуем подтянуть метаданные сразу
      try { await fetchMetaFor([base]); coin = await loadCoin(base); } catch { /* без ключа CoinGecko — покажем что есть */ }
    }
    render(modal, base, symbol, coin, instruments);
  } catch (e) {
    modal.el.innerHTML = `<div class="warn">Не удалось загрузить карточку: ${esc(e.message)}</div>`;
  }
}

function render(modal, base, symbol, coin, instruments) {
  const lin = instruments.find((i) => i.market === "linear");
  const spot = instruments.find((i) => i.market === "spot");
  const desc = coin?.description_ru
    ? esc(coin.description_ru)
    : coin?.description_en
      ? `<span class="muted">(на английском — русский перевод появится после подключения ключа перевода)</span><br>${esc(coin.description_en.slice(0, 1200))}`
      : `<span class="muted">Описание пока не загружено${coin?.sources?.note ? " — " + esc(coin.sources.note) : ""}.</span>`;
  const links = coin?.links ?? {};
  const linkList = [
    ...(links.homepage ?? []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">Сайт</a>`),
    ...(links.docs ? [`<a href="${esc(links.docs)}" target="_blank" rel="noopener">Документация</a>`] : []),
    ...(coin?.sources?.coingecko ? [`<a href="${esc(coin.sources.coingecko)}" target="_blank" rel="noopener">CoinGecko (источник описания)</a>`] : []),
  ].join(" · ") || `<span class="muted">нет</span>`;

  modal.el.innerHTML = `
    <h2>${esc(coin?.name ?? base)} <span class="muted">${esc(symbol)}</span></h2>
    <div class="grid2">
      <div>
        <h3>О проекте</h3>
        <p>${desc}</p>
        <p><b>Команда:</b> ${coin?.team ? esc(coin.team) : `<span class="muted">Нет проверяемых данных</span>`}</p>
        <p><b>Дата запуска проекта:</b> ${coin?.genesis_date ? esc(coin.genesis_date) : `<span class="muted">нет данных</span>`}
           <span class="hint">не путать с датой листинга на Bybit</span></p>
        <p><b>Листинг на Bybit:</b><br>
           фьючерс — ${lin?.launch_time ? fmtDT(lin.launch_time) : "—"}<br>
           спот — ${spot?.launch_time ? fmtDT(spot.launch_time) : "—"}</p>
        <p><b>Ссылки:</b> ${linkList}</p>
        <p class="muted small">Метаданные обновлены: ${coin?.meta_updated_at ? fmtDT(coin.meta_updated_at) : "ещё не загружались"}</p>
        <details class="small"><summary>Исправить сопоставление с CoinGecko</summary>
          <div class="row" style="margin-top:6px">
            <input id="cc-cgid" placeholder="id монеты на CoinGecko, напр. solana" value="${esc(coin?.cg_id ?? "")}">
            <button id="cc-setid" class="btn">Применить</button>
          </div>
          ${(coin?.sources?.search_candidates?.length)
            ? `<div class="muted small">Кандидаты: ${coin.sources.search_candidates.map((c) => `${esc(c.id)} (ранг ${c.rank ?? "—"})`).join(", ")}</div>` : ""}
        </details>
      </div>
      <div>
        <h3>Рынок</h3>
        <div id="cc-market" class="muted">загружаю…</div>
        <div class="seg" id="cc-ranges" style="margin:8px 0">
          ${Object.entries(RANGES).map(([k, r]) =>
            `<button class="btn range" data-r="${k}">${r.label}</button>`).join("")}
        </div>
        <div id="cc-chart" style="height:280px;border:1px solid var(--chart-grid);border-radius:10px;overflow:hidden"></div>
        <div id="cc-updated" class="muted small"></div>
      </div>
    </div>`;

  modal.el.querySelector("#cc-setid").onclick = async () => {
    const id = modal.el.querySelector("#cc-cgid").value.trim();
    if (!id) return;
    try {
      await setCoinId(base, id);
      modal.close();
      openCoinCard(base, symbol);
    } catch (e) { alert("Ошибка: " + e.message); }
  };

  let chart, series;
  const drawRange = async (key) => {
    modal.el.querySelectorAll(".range").forEach((b) => b.classList.toggle("primary", b.dataset.r === key));
    const r = RANGES[key];
    try {
      const res = await fetchKline("linear", symbol, r.interval, r.limit);
      const candles = (res.list ?? []).map((c) => ({
        time: Math.floor(parseInt(c[0]) / 1000),
        open: +c[1], high: +c[2], low: +c[3], close: +c[4],
      })).reverse();
      if (!chart) {
        const css = getComputedStyle(document.documentElement);
        const tk = (name) => css.getPropertyValue(name).trim();
        chart = LightweightCharts.createChart(modal.el.querySelector("#cc-chart"), {
          height: 280, layout: { background: { color: tk("--bg-inset") }, textColor: tk("--chart-axis-text") },
          grid: { vertLines: { color: tk("--chart-grid") }, horzLines: { color: tk("--chart-grid") } },
          crosshair: { vertLine: { color: tk("--chart-crosshair") }, horzLine: { color: tk("--chart-crosshair") } },
          timeScale: { timeVisible: true, secondsVisible: false, borderColor: tk("--chart-grid") },
          rightPriceScale: { borderColor: tk("--chart-grid") },
        });
        series = chart.addCandlestickSeries({
          upColor: tk("--chart-candle-up"), downColor: tk("--chart-candle-down"), borderVisible: false,
          wickUpColor: tk("--chart-candle-up"), wickDownColor: tk("--chart-candle-down"),
        });
      }
      series.setData(candles);
      chart.timeScale().fitContent();
      // сводка по последним данным
      if (candles.length) {
        const last = candles[candles.length - 1];
        const dayAgo = candles.filter((c) => c.time >= last.time - 86400);
        const hi = Math.max(...dayAgo.map((c) => c.high));
        const lo = Math.min(...dayAgo.map((c) => c.low));
        const first = dayAgo[0];
        const ch = first ? (last.close - first.open) / first.open * 100 : null;
        modal.el.querySelector("#cc-market").innerHTML =
          `Цена: <b>${price(last.close)}</b> · за 24 ч: ${ch != null ? pct(ch) : "—"} · максимум: ${price(hi)} · минимум: ${price(lo)}`;
        modal.el.querySelector("#cc-updated").textContent =
          "Рыночные данные обновлены: " + fmtDT(new Date().toISOString());
      }
    } catch (e) {
      modal.el.querySelector("#cc-chart").innerHTML = `<div class="warn">График недоступен: ${esc(e.message)}</div>`;
    }
  };
  modal.el.querySelectorAll(".range").forEach((b) => b.onclick = () => drawRange(b.dataset.r));
  drawRange("24h-15m");
}
