import { SUPABASE_URL, SUPABASE_ANON } from "./config.js";

const { createClient } = window.supabase;
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await sb.auth.signOut();
  location.reload();
}

// Вызов Edge Function с нормальной обработкой ошибок
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let detail = error.message;
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) detail = ctx.error;
    } catch { /* тело недоступно */ }
    throw new Error(detail);
  }
  if (data && data.ok === false) throw new Error(data.error || "Неизвестная ошибка функции");
  return data;
}
