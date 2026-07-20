-- ДНЕВНИК ТРЕЙДЕРА — схема Supabase (14.07.2026)
-- Выполнить один раз: Supabase Dashboard → SQL Editor → вставить всё → Run

-- Настройки (одна строка)
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  daily_goal_pct numeric not null default 3,   -- цель дня, % от баланса на утро
  daily_stop_pct numeric not null default 2    -- стоп дня, %
);
insert into settings (id) values (1) on conflict do nothing;

-- Торговые дни: баланс на начало дня фиксируется первым синком за день
create table if not exists days (
  day date primary key,
  start_balance numeric not null,
  synced_at timestamptz default now()
);

-- Сделки (закрытые позиции из Bybit closed-pnl + ручные поля Ивана)
create table if not exists trades (
  id text primary key,                -- orderId Bybit
  symbol text not null,
  side text,                          -- Buy = лонг
  qty numeric,
  entry_price numeric,
  exit_price numeric,
  pnl numeric,                        -- чистый результат сделки, $
  opened_at timestamptz,
  closed_at timestamptz,
  comment text,                       -- ручное: почему вошёл / что увидел
  emotion text,                       -- ручное: спокойно / уверенно / FOMO / отыгрыш / усталость
  screenshot_url text                 -- ручное: скрин графика (Supabase Storage)
);
create index if not exists trades_closed_idx on trades (closed_at desc);

-- Доступ: только вошедшему пользователю (Иван), никому больше
alter table settings enable row level security;
alter table days enable row level security;
alter table trades enable row level security;
create policy "auth all settings" on settings for all to authenticated using (true) with check (true);
create policy "auth all days" on days for all to authenticated using (true) with check (true);
create policy "auth all trades" on trades for all to authenticated using (true) with check (true);

-- Хранилище скриншотов
insert into storage.buckets (id, name, public) values ('screens', 'screens', false)
on conflict do nothing;
create policy "auth screens read" on storage.objects for select to authenticated using (bucket_id = 'screens');
create policy "auth screens write" on storage.objects for insert to authenticated with check (bucket_id = 'screens');
