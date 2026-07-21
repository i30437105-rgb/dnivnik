-- ===============================================================
-- ДНЕВНИК + АНАЛИТИКА v2 (21.07.2026) — полная замена схемы v1
-- по ТЗ TZ_trading_service_v1 + 17-решения-по-ТЗ.md
-- Применяется целиком; старые таблицы v1 удаляются (решение Ивана №5)
-- ===============================================================

-- ---------- Снос v1 ----------
drop table if exists scan_reports cascade;
drop table if exists trades cascade;
drop table if exists days cascade;
drop table if exists settings cascade;

-- ---------- Настройки (одна строка) ----------
create table if not exists user_settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'Europe/Moscow',
  daily_goal_pct numeric not null default 3,          -- цель дня, % от B0
  daily_loss_pct numeric not null default 3,          -- лимит убытка, % (решение Ивана №8)
  daily_loss_usd numeric,                             -- лимит фиксированной суммой
  loss_limit_mode text not null default 'pct' check (loss_limit_mode in ('pct','usd')),
  filters jsonb not null default '{
    "listing_hours": 72,
    "require_spot": true,
    "age_days": 365,
    "min_spot_turnover": 5000000,
    "vol6h_pct": 10,
    "spike_ratio": 5,
    "spike_min_turnover": 5000000
  }'::jsonb,
  updated_at timestamptz not null default now()
);
insert into user_settings (id) values (1) on conflict do nothing;

-- ---------- Снимки баланса (total equity) ----------
create table if not exists account_snapshots (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  equity numeric not null,
  kind text not null check (kind in ('auto','day_start','manual')),
  day date not null,                                  -- торговый день в поясе пользователя
  accurate boolean not null default true
);
create index if not exists snapshots_day_idx on account_snapshots (day, ts);

-- ---------- Торговые дни ----------
create table if not exists days (
  day date primary key,
  start_balance numeric not null,                     -- снимок equity в 00:00 (или ближайший)
  start_accurate boolean not null default true,       -- false = снимок 00:00 пропущен, взят ближайший
  goal_pct numeric,                                   -- переопределение цели на день (null = глобальная)
  loss_pct numeric,
  loss_usd numeric,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- Денежные потоки (пополнения / выводы / переводы) ----------
create table if not exists cash_flows (
  id text primary key,                                -- биржевой ID (txID / withdrawId / transferId)
  ts timestamptz not null,
  day date not null,
  type text not null check (type in ('deposit','withdrawal','transfer_in','transfer_out')),
  coin text not null,
  amount numeric not null,                            -- в монете
  amount_usd numeric,                                 -- null = не смогли оценить (не-стейбл)
  raw jsonb
);
create index if not exists cash_flows_day_idx on cash_flows (day);

-- ---------- Сделки (1 запись closed-pnl = 1 сделка; решение Ивана №2) ----------
create table if not exists trades (
  id text primary key,                                -- orderId закрывающего ордера Bybit
  symbol text not null,
  side text,                                          -- Buy = лонг (инвертировано от стороны закрытия)
  qty numeric,
  entry_price numeric,
  exit_price numeric,
  pnl numeric,
  open_fee numeric,
  close_fee numeric,
  leverage text,
  opened_at timestamptz,
  closed_at timestamptz,
  day date,                                           -- день закрытия в поясе пользователя
  raw jsonb
);
create index if not exists trades_day_idx on trades (day);
create index if not exists trades_closed_idx on trades (closed_at desc);

-- ---------- Исполнения (fills) ----------
create table if not exists executions (
  id text primary key,                                -- execId
  order_id text,
  symbol text not null,
  side text,
  price numeric,
  qty numeric,
  fee numeric,
  fee_rate numeric,
  is_maker boolean,
  order_type text,
  exec_time timestamptz not null,
  raw jsonb
);
create index if not exists exec_symbol_time_idx on executions (symbol, exec_time);

-- ---------- Справочник стратегий ----------
create table if not exists strategies (
  id int generated always as identity primary key,
  name text not null unique,
  archived boolean not null default false
);
insert into strategies (name) values ('Высокорисковая'), ('Консервативная')
on conflict (name) do nothing;

-- ---------- Пользовательские данные сделки (не трогаются импортом) ----------
create table if not exists trade_notes (
  trade_id text primary key references trades(id) on delete cascade,
  comment text,
  state_tags text[] default '{}',                     -- «спокойствие», «FOMO», «усталость»…
  state_note text,
  strategy_id int references strategies(id),
  updated_at timestamptz not null default now()
);

-- ---------- Скриншоты (несколько на сделку) ----------
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  trade_id text not null references trades(id) on delete cascade,
  path text not null,                                 -- путь в бакете screens
  name text,
  size int,
  mime text,
  created_at timestamptz not null default now()
);
create index if not exists attach_trade_idx on attachments (trade_id);

-- ---------- Инструменты Bybit ----------
create table if not exists instruments (
  market text not null check (market in ('spot','linear')),
  symbol text not null,
  base text not null,
  quote text not null,
  status text,
  launch_time timestamptz,
  contract_type text,
  updated_at timestamptz not null default now(),
  primary key (market, symbol)
);
create index if not exists instruments_base_idx on instruments (base);

-- ---------- Метаданные монет (CoinGecko + перевод) ----------
create table if not exists coins (
  base text primary key,                              -- базовая монета, напр. 'SOL'
  cg_id text,                                         -- id CoinGecko
  name text,
  description_ru text,
  description_en text,
  team text,                                          -- null → «Нет проверяемых данных»
  links jsonb,                                        -- {homepage, docs, ...}
  genesis_date date,
  age_source text,                                    -- 'coingecko' | 'bybit_spot' | 'bybit_linear'
  contract_address text,
  sources jsonb,                                      -- ссылки-первоисточники + кандидаты сопоставления
  manual boolean not null default false,              -- сопоставление исправлено вручную
  meta_updated_at timestamptz
);

-- ---------- Запуски аналитики ----------
create table if not exists research_runs (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  params jsonb,
  status text not null default 'running' check (status in ('running','done','partial','error')),
  errors jsonb,
  duration_ms int
);

create table if not exists research_results (
  id bigint generated always as identity primary key,
  run_id bigint not null references research_runs(id) on delete cascade,
  block text not null check (block in ('listings','volatile','spike')),
  symbol text not null,                               -- фьючерсный символ
  base text not null,
  metrics jsonb not null
);
create index if not exists results_run_idx on research_results (run_id, block);

-- ---------- Статус обновлений («данные актуальны на…») ----------
create table if not exists sync_status (
  id text primary key,                                -- 'diary' | 'analytics' | 'meta'
  last_ok timestamptz,
  last_error text,
  last_error_at timestamptz,
  detail jsonb
);

-- ---------- Сводка по дням (для календаря/графика/статистики) ----------
create or replace view v_days with (security_invoker = true) as
select
  d.day,
  d.start_balance,
  d.start_accurate,
  d.goal_pct,
  d.loss_pct,
  d.loss_usd,
  (select a.equity from account_snapshots a where a.day = d.day order by a.ts desc limit 1) as end_equity,
  (select max(a.ts) from account_snapshots a where a.day = d.day) as last_snap_at,
  coalesce((select sum(case when c.type in ('deposit','transfer_in') then c.amount_usd
                            else -c.amount_usd end)
            from cash_flows c where c.day = d.day and c.amount_usd is not null), 0) as net_flow,
  exists(select 1 from cash_flows c where c.day = d.day and c.amount_usd is null) as flow_unpriced,
  coalesce((select sum(t.pnl) from trades t where t.day = d.day), 0) as realized_pnl,
  (select count(*) from trades t where t.day = d.day) as trades_count
from days d;

-- ---------- RLS: доступ только вошедшему пользователю ----------
alter table user_settings enable row level security;
alter table account_snapshots enable row level security;
alter table days enable row level security;
alter table cash_flows enable row level security;
alter table trades enable row level security;
alter table executions enable row level security;
alter table strategies enable row level security;
alter table trade_notes enable row level security;
alter table attachments enable row level security;
alter table instruments enable row level security;
alter table coins enable row level security;
alter table research_runs enable row level security;
alter table research_results enable row level security;
alter table sync_status enable row level security;

do $$
declare t text;
begin
  foreach t in array array['user_settings','account_snapshots','days','cash_flows','trades',
    'executions','strategies','trade_notes','attachments','instruments','coins',
    'research_runs','research_results','sync_status']
  loop
    execute format('drop policy if exists "auth all %1$s" on %1$I', t);
    execute format('create policy "auth all %1$s" on %1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Хранилище скриншотов (бакет screens уже существует) ----------
insert into storage.buckets (id, name, public) values ('screens', 'screens', false)
on conflict do nothing;
drop policy if exists "auth screens read"   on storage.objects;
drop policy if exists "auth screens write"  on storage.objects;
drop policy if exists "auth screens update" on storage.objects;
drop policy if exists "auth screens delete" on storage.objects;
create policy "auth screens read"   on storage.objects for select to authenticated using (bucket_id = 'screens');
create policy "auth screens write"  on storage.objects for insert to authenticated with check (bucket_id = 'screens');
create policy "auth screens update" on storage.objects for update to authenticated using (bucket_id = 'screens');
create policy "auth screens delete" on storage.objects for delete to authenticated using (bucket_id = 'screens');
