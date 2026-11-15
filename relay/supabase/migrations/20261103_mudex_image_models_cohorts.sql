-- 2026-11-02 ~ 11-03에 운영 DB에 적용한 것을 모았다(mudex_charge_search_path, mudex_image_models, mudex_cohorts).
alter function mudex.charge(text, text, int, int, int, numeric) set search_path = '';

-- 이미지 모델: 응답의 usage(텍스트 입력·이미지 입력·이미지 출력 토큰)로 값을 매긴다. 1M 토큰당 달러.
alter table mudex.models add column if not exists kind text not null default 'chat';
alter table mudex.models add column if not exists img_in_per_m numeric(10,4) not null default 0;
insert into mudex.models (model, kind, in_per_m, cached_per_m, img_in_per_m, out_per_m) values
  ('gpt-image-1', 'image', 5.00, 1.25, 10.00, 40.00),
  ('gpt-image-1-mini', 'image', 2.00, 0.20, 2.50, 8.00)
on conflict (model) do nothing;

-- 연수(cohort): 강사가 만들고, 연수생은 연수 코드+이름으로 들어와 개인 코드를 자동으로 받는다.
-- 강의가 끝나면 closed=true로 그 연수의 코드가 모두 쓸 수 없게 된다. budget_usd는 연수 전체 총액 안전선(비우면 없음).
create table if not exists mudex.cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entry_code text not null unique,
  ends_at timestamptz not null,
  budget_usd numeric(10,2),
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table mudex.codes add column if not exists cohort_id uuid references mudex.cohorts(id) on delete set null;
alter table mudex.codes add column if not exists trainee_name text;
alter table mudex.codes add column if not exists device_id text;
create index if not exists codes_cohort_idx on mudex.codes(cohort_id);
create unique index if not exists codes_cohort_device_idx on mudex.codes(cohort_id, device_id) where device_id is not null;
revoke all on all tables in schema mudex from public, anon, authenticated;

-- 따로 넣어야 하는 값(저장소에 두지 않는다):
--   mudex.models 에 쓰는 대화 모델과 단가(예: gpt-6.1-terra)
--   mudex.config 의 admin_password_sha256(강사 비밀번호의 SHA-256), admin_secret_sha256
