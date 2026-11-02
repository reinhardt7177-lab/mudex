-- mumuclass 프로젝트에 적용한 것과 같은 내용 (2026-11-02, MCP apply_migration으로 적용)
create schema if not exists mudex;
revoke all on schema mudex from public, anon, authenticated;

create table mudex.codes (
  code text primary key,
  label text,
  budget_usd numeric(10,4) not null default 3,
  spent_usd numeric(12,6) not null default 0,
  expires_at timestamptz not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table mudex.usage (
  id bigserial primary key,
  code text not null references mudex.codes(code) on delete cascade,
  model text not null,
  input_tokens int not null default 0,
  cached_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index usage_code_idx on mudex.usage(code, created_at desc);

create table mudex.models (
  model text primary key,
  in_per_m numeric(10,4) not null,
  cached_per_m numeric(10,4) not null,
  out_per_m numeric(10,4) not null,
  enabled boolean not null default true
);

create table mudex.config (key text primary key, value text not null);

insert into mudex.models (model, in_per_m, cached_per_m, out_per_m) values
  ('gpt-5-mini', 0.25, 0.025, 2.00),
  ('gpt-5-nano', 0.05, 0.005, 0.40),
  ('gpt-5', 1.25, 0.125, 10.00),
  ('gpt-4.1-mini', 0.40, 0.10, 1.60),
  ('gpt-4.1', 2.00, 0.50, 8.00);

create or replace function mudex.charge(p_code text, p_model text, p_in int, p_cached int, p_out int, p_cost numeric)
returns numeric language sql set search_path = '' as $$
  with u as (
    update mudex.codes set spent_usd = spent_usd + p_cost, last_used_at = now()
    where code = p_code returning spent_usd
  ), ins as (
    insert into mudex.usage(code, model, input_tokens, cached_tokens, output_tokens, cost_usd)
    values (p_code, p_model, p_in, p_cached, p_out, p_cost)
  )
  select spent_usd from u;
$$;
revoke all on all tables in schema mudex from public, anon, authenticated;
revoke all on all functions in schema mudex from public, anon, authenticated;

-- 관리 비밀값은 해시만 넣는다:
-- insert into mudex.config(key, value) values ('admin_secret_sha256', '<sha256 hex>');

-- (2026-11-02 추가) 이미지 모델: 응답 usage로 값을 매긴다. 1M 토큰당 달러.
alter table mudex.models add column if not exists kind text not null default 'chat';
alter table mudex.models add column if not exists img_in_per_m numeric(10,4) not null default 0;
insert into mudex.models (model, kind, in_per_m, cached_per_m, img_in_per_m, out_per_m) values
  ('gpt-image-1', 'image', 5.00, 1.25, 10.00, 40.00),
  ('gpt-image-1-mini', 'image', 2.00, 0.20, 2.50, 8.00)
on conflict (model) do nothing;
