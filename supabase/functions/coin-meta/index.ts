// МЕТАДАННЫЕ МОНЕТ (Supabase Edge Function, Deno) — CoinGecko + перевод LLM
// Действия (body.action):
//   fetch         — {bases: string[]} загрузить/обновить метаданные (≤12 за вызов)
//   fetch_missing — найти монеты без метаданных или старше 7 дней и обработать ≤12
//   set_id        — {base, cg_id} ручное исправление сопоставления + перезагрузка
// Секреты: COINGECKO_KEY (Demo). Необязательные: LLM_PROVIDER (anthropic|openai), LLM_KEY.
// Правило ТЗ 4.5: ничего не выдумывать; команда почти всегда «Нет проверяемых данных».
import { createClient } from "npm:@supabase/supabase-js@2";

const CG = "https://api.coingecko.com/api/v3";
const BATCH = 12; // 2 запроса на монету, лимит Demo — 30/мин

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function cgGet(path: string, params: Record<string, string> = {}) {
  const key = Deno.env.get("COINGECKO_KEY");
  if (!key) throw new Error("COINGECKO_KEY не задан в секретах Supabase");
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${CG}${path}${qs ? "?" + qs : ""}`, {
    headers: { "x-cg-demo-api-key": key },
  });
  if (r.status === 429) throw new Error("CoinGecko: превышен лимит запросов, повторите через минуту");
  if (!r.ok) throw new Error(`CoinGecko ${path}: HTTP ${r.status}`);
  return await r.json();
}

// Перевод/сжатие описания на понятный русский. Без ключа LLM — вернём null (останется английский).
async function toRussian(nameCoin: string, textEn: string): Promise<string | null> {
  const provider = Deno.env.get("LLM_PROVIDER");
  const key = Deno.env.get("LLM_KEY");
  if (!provider || !key || !textEn) return null;
  const prompt = `Ниже описание криптопроекта «${nameCoin}» с CoinGecko. Перескажи его по-русски простым понятным языком, 2–4 предложения: что делает проект и зачем нужен токен. Не добавляй ничего от себя, не оценивай надёжность. Только пересказ фактов из текста.\n\n${textEn.slice(0, 4000)}`;
  try {
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const j = await r.json();
      return j.content?.[0]?.text?.trim() ?? null;
    }
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini", max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const j = await r.json();
      return j.choices?.[0]?.message?.content?.trim() ?? null;
    }
  } catch { /* перевод необязателен — не роняем загрузку метаданных */ }
  return null;
}

// deno-lint-ignore no-explicit-any
async function fetchCoin(sb: any, base: string, forcedId?: string) {
  let cgId = forcedId ?? null;
  let candidates: Record<string, unknown>[] = [];
  if (!cgId) {
    const search = await cgGet("/search", { query: base });
    const matches = (search.coins ?? []).filter(
      (c: Record<string, unknown>) => String(c.symbol).toUpperCase() === base.toUpperCase());
    candidates = matches.slice(0, 5).map((c: Record<string, unknown>) =>
      ({ id: c.id, name: c.name, rank: c.market_cap_rank }));
    if (!matches.length) {
      await sb.from("coins").upsert({
        base, cg_id: null, meta_updated_at: new Date().toISOString(),
        sources: { search_candidates: [], note: "не найдено на CoinGecko" },
      }, { onConflict: "base" });
      return { base, found: false };
    }
    // при нескольких совпадениях — самый высокий ранг капитализации; кандидаты сохраняем для ручной правки
    matches.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      (Number(a.market_cap_rank) || 1e9) - (Number(b.market_cap_rank) || 1e9));
    cgId = String(matches[0].id);
  }
  const c = await cgGet(`/coins/${cgId}`, {
    localization: "true", tickers: "false", market_data: "false",
    community_data: "false", developer_data: "false", sparkline: "false",
  });
  const descEn: string = (c.description?.en ?? "").trim();
  const descRuCg: string = (c.description?.ru ?? "").trim();
  const descRu = descRuCg || await toRussian(c.name ?? base, descEn);
  const contract = c.platforms && typeof c.platforms === "object"
    ? Object.values(c.platforms).find((v) => v) ?? null : null;
  await sb.from("coins").upsert({
    base,
    cg_id: cgId,
    name: c.name ?? base,
    description_en: descEn || null,
    description_ru: descRu || null,
    team: null, // CoinGecko не отдаёт команду — по ТЗ показываем «Нет проверяемых данных»
    links: {
      homepage: (c.links?.homepage ?? []).filter(Boolean),
      docs: c.links?.whitepaper || null,
      explorers: (c.links?.blockchain_site ?? []).filter(Boolean).slice(0, 3),
    },
    genesis_date: c.genesis_date || null,
    age_source: c.genesis_date ? "coingecko" : null,
    contract_address: contract,
    sources: {
      coingecko: `https://www.coingecko.com/en/coins/${cgId}`,
      search_candidates: candidates,
      fetched_at: new Date().toISOString(),
    },
    manual: Boolean(forcedId),
    meta_updated_at: new Date().toISOString(),
  }, { onConflict: "base" });
  return { base, found: true, cg_id: cgId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "fetch_missing";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "set_id") {
      const done = await fetchCoin(sb, String(body.base), String(body.cg_id));
      return new Response(JSON.stringify({ ok: true, done }),
        { headers: { "Content-Type": "application/json", ...CORS } });
    }

    let bases: string[] = [];
    if (action === "fetch") {
      bases = (body.bases ?? []).slice(0, BATCH);
    } else {
      // fetch_missing: монеты из последней аналитики без метаданных или старше 7 дней
      const { data: run } = await sb.from("research_runs")
        .select("id").in("status", ["done", "partial"]).order("id", { ascending: false }).limit(1).single();
      if (run) {
        const { data: res } = await sb.from("research_results").select("base").eq("run_id", run.id);
        const uniq = [...new Set((res ?? []).map((r) => r.base))];
        const { data: have } = await sb.from("coins").select("base, meta_updated_at").in("base", uniq);
        const fresh = new Set((have ?? [])
          .filter((c) => c.meta_updated_at &&
            Date.now() - new Date(c.meta_updated_at).getTime() < 7 * 86400_000)
          .map((c) => c.base));
        bases = uniq.filter((b) => !fresh.has(b)).slice(0, BATCH);
      }
    }

    const results = [];
    for (const base of bases) {
      try {
        results.push(await fetchCoin(sb, base));
      } catch (e) {
        results.push({ base, error: String(e) });
        if (String(e).includes("лимит")) break; // 429 — остальное в следующий раз
      }
      await new Promise((r) => setTimeout(r, 1200)); // бережём лимит 30/мин
    }
    await sb.from("sync_status").upsert({
      id: "meta", last_ok: new Date().toISOString(), detail: { results },
    }, { onConflict: "id" });

    return new Response(JSON.stringify({ ok: true, processed: results }),
      { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
