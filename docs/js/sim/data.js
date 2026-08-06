// Симулятор: свечи Bybit v5 kline (public API, CORS открыт) + кэш IndexedDB.
// Свеча сразу в формате klinecharts: {timestamp, open, high, low, close, volume, turnover}.

const API = "https://api.bybit.com/v5/market";
const PAGE = 1000; // лимит Bybit на запрос

export const TIMEFRAMES = [
  { id: "5", label: "5м", ms: 5 * 60e3 },
  { id: "15", label: "15м", ms: 15 * 60e3 },
  { id: "60", label: "1ч", ms: 60 * 60e3 },
  { id: "240", label: "4ч", ms: 240 * 60e3 },
  { id: "D", label: "1д", ms: 24 * 60 * 60e3 },
];
export const tfById = (id) => TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[0];

async function bybit(path, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/${path}?${qs}`);
  if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
  const j = await res.json();
  if (j.retCode !== 0) throw new Error(`Bybit: ${j.retMsg || "код " + j.retCode}`);
  return j.result;
}

// ---------- Пары (для поиска в настройке сессии) ----------

let symbolsCache = null;

export async function loadSymbols() {
  if (symbolsCache) return symbolsCache;
  const r = await bybit("instruments-info", { category: "linear", limit: 1000 });
  symbolsCache = (r.list ?? [])
    .filter((i) => i.quoteCoin === "USDT" && i.status === "Trading")
    .map((i) => i.symbol)
    .sort();
  return symbolsCache;
}

// ---------- Свечи ----------

function parseList(list) {
  // Bybit отдаёт [startMs, open, high, low, close, volume, turnover] по убыванию времени
  return (list ?? []).map((r) => ({
    timestamp: Number(r[0]),
    open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]),
    volume: Number(r[5]), turnover: Number(r[6]),
  }));
}

// Постраничная загрузка периода: идём от конца назад, пока не покроем from
export async function loadKlines(symbol, interval, fromMs, toMs, onProgress) {
  const key = `${symbol}|${interval}|${fromMs}|${toMs}`;
  const cached = await idbGet(key);
  if (cached?.length) return cached;

  const pages = [];
  let total = 0;
  let end = toMs;
  for (let guard = 0; guard < 200; guard++) {
    const r = await bybit("kline", {
      category: "linear", symbol, interval,
      start: fromMs, end, limit: PAGE,
    });
    const page = parseList(r.list);
    if (!page.length) break;
    pages.push(page);
    total += page.length;
    onProgress?.(total);
    const oldest = page[page.length - 1].timestamp;
    if (oldest <= fromMs || page.length < PAGE) break;
    end = oldest - 1;
  }

  const byTs = new Map();
  for (const page of pages) for (const c of page) byTs.set(c.timestamp, c);
  const out = [...byTs.values()]
    .filter((c) => c.timestamp >= fromMs && c.timestamp <= toMs)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (out.length) await idbPut(key, out);
  return out;
}

// ---------- Кэш IndexedDB (исторические свечи не меняются) ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sim-cache", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("klines");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const tx = d.transaction("klines").objectStore("klines").get(key);
      tx.onsuccess = () => resolve(tx.result);
      tx.onerror = () => resolve(null);
    });
  } catch { return null; } // кэш не критичен — при сбое просто грузим с API
}

async function idbPut(key, val) {
  try {
    const d = await db();
    await new Promise((resolve) => {
      const tx = d.transaction("klines", "readwrite").objectStore("klines").put(val, key);
      tx.onsuccess = resolve;
      tx.onerror = resolve;
    });
  } catch { /* переполнение квоты не мешает работе */ }
}
