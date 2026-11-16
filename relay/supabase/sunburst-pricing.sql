-- Image generation used by web/public/tools.js.
-- Standard API pricing verified 2026-11-16:
-- https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst
-- Prices are USD per million tokens. This is an idempotent data update.
insert into mudex.models
  (model, kind, in_per_m, cached_per_m, img_in_per_m, out_per_m, enabled)
values
  ('gpt-image-2.6-sunburst', 'image', 5, 1.25, 8, 30, true)
on conflict (model) do update set
  kind = excluded.kind,
  in_per_m = excluded.in_per_m,
  cached_per_m = excluded.cached_per_m,
  img_in_per_m = excluded.img_in_per_m,
  out_per_m = excluded.out_per_m,
  enabled = excluded.enabled;
