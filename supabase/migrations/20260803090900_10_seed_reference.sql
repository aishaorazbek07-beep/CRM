-- ============================================================
-- 10. СПРАВОЧНИКИ: единицы, склады, категории, стартовая номенклатура
-- ============================================================

insert into public.units (code, name, full_name, kind, precision) values
  ('sht',   'шт',    'штука',            'piece',  0),
  ('t',     'т',     'тонна',            'weight', 3),
  ('kg',    'кг',    'килограмм',        'weight', 2),
  ('list',  'лист',  'лист',             'piece',  0),
  ('m',     'м',     'метр',             'length', 2),
  ('m2',    'м2',    'квадратный метр',  'area',   2),
  ('kompl', 'компл', 'комплект',         'set',    0),
  ('h',     'ч',     'нормо-час',        'time',   1)
on conflict (code) do nothing;

insert into public.warehouses (code, name, kind, sort_order) values
  ('MAIN', 'Основной склад материалов', 'material',   10),
  ('SHOP', 'Производственный цех',      'production', 20),
  ('FG',   'Склад готовой продукции',   'finished',   30)
on conflict (code) do nothing;

-- Категории
with root as (
  insert into public.categories (name, sort_order) values
    ('Металлопрокат', 10),
    ('Трубопроводная арматура', 20),
    ('Приводы и автоматика', 30),
    ('Соединительные детали', 40),
    ('Метизы', 50),
    ('Кабель и электрика', 60),
    ('Работы и услуги', 70)
  returning id, name
)
insert into public.categories (name, parent_id, sort_order)
select v.name, r.id, v.sort
from root r
join (values
  ('Лист нержавеющий',        'Металлопрокат', 10),
  ('Лист углеродистый',       'Металлопрокат', 20),
  ('Труба нержавеющая',       'Металлопрокат', 30),
  ('Задвижки',                'Трубопроводная арматура', 10),
  ('Затворы дисковые',        'Трубопроводная арматура', 20),
  ('Клапаны',                 'Трубопроводная арматура', 30),
  ('Электроприводы',          'Приводы и автоматика', 10),
  ('Фланцы',                  'Соединительные детали', 10),
  ('Отводы и переходы',       'Соединительные детали', 20)
) as v(name, parent, sort) on v.parent = r.name;

-- Стартовая номенклатура
insert into public.items
  (sku, name, category_id, kind, base_unit_id, steel_grade, gost, spec, weight_kg,
   is_stock_tracked, requires_certificate, min_stock, reorder_qty,
   default_price, last_purchase_price, lead_time_days)
values
  ('MET-304-2X1500', 'Лист нержавеющий 2х1500х6000 AISI 304',
    (select id from public.categories where name = 'Лист нержавеющий'), 'material',
    (select id from public.units where code = 'list'), '304', 'ГОСТ 5582-75',
    '{"thickness_mm":2,"width_mm":1500,"length_mm":6000,"surface":"2B"}'::jsonb, 141.3,
    true, true, 10, 20, 285000, 240000, 21),

  ('MET-316-3X1500', 'Лист нержавеющий 3х1500х6000 AISI 316',
    (select id from public.categories where name = 'Лист нержавеющий'), 'material',
    (select id from public.units where code = 'list'), '316', 'ГОСТ 5582-75',
    '{"thickness_mm":3,"width_mm":1500,"length_mm":6000,"surface":"2B"}'::jsonb, 211.9,
    true, true, 6, 12, 465000, 398000, 30),

  ('MET-09G2S-8', 'Лист 8х1500х6000 09Г2С',
    (select id from public.categories where name = 'Лист углеродистый'), 'material',
    (select id from public.units where code = 'list'), '09Г2С', 'ГОСТ 19281-2014',
    '{"thickness_mm":8,"width_mm":1500,"length_mm":6000}'::jsonb, 565.2,
    true, true, 20, 40, 148000, 121000, 14),

  ('ARM-ZD-304-100', 'Задвижка клиновая Ду100 Ру16 нерж. AISI 304',
    (select id from public.categories where name = 'Задвижки'), 'component',
    (select id from public.units where code = 'sht'), '304', 'ГОСТ 5762-2002',
    '{"du":100,"ru":16,"type":"клиновая","connection":"фланцевое"}'::jsonb, 32,
    true, true, 4, 8, 410000, 335000, 25),

  ('ARM-ZD-316-100', 'Задвижка клиновая Ду100 Ру16 нерж. AISI 316',
    (select id from public.categories where name = 'Задвижки'), 'component',
    (select id from public.units where code = 'sht'), '316', 'ГОСТ 5762-2002',
    '{"du":100,"ru":16,"type":"клиновая","connection":"фланцевое"}'::jsonb, 32,
    true, true, 2, 4, 585000, 476000, 35),

  ('ARM-ZD-316-150', 'Задвижка клиновая Ду150 Ру16 нерж. AISI 316',
    (select id from public.categories where name = 'Задвижки'), 'component',
    (select id from public.units where code = 'sht'), '316', 'ГОСТ 5762-2002',
    '{"du":150,"ru":16,"type":"клиновая","connection":"фланцевое"}'::jsonb, 58,
    true, true, 2, 4, 890000, 735000, 35),

  ('DRV-AUMA-SA07', 'Электропривод AUMA SA 07.2 (штатный)',
    (select id from public.categories where name = 'Электроприводы'), 'component',
    (select id from public.units where code = 'sht'), null, null,
    '{"torque_nm":100,"voltage":"380V","ip":"IP68","brand":"AUMA"}'::jsonb, 28,
    true, false, 0, 0, 1450000, 1180000, 75),

  ('DRV-ROTORK-IQ10', 'Электропривод ROTORK IQ10 (аналог)',
    (select id from public.categories where name = 'Электроприводы'), 'component',
    (select id from public.units where code = 'sht'), null, null,
    '{"torque_nm":110,"voltage":"380V","ip":"IP68","brand":"ROTORK"}'::jsonb, 30,
    true, false, 0, 0, 1520000, 1240000, 60),

  ('DRV-GENEBRE-EL', 'Электропривод GENEBRE 5810 (временная подмена)',
    (select id from public.categories where name = 'Электроприводы'), 'component',
    (select id from public.units where code = 'sht'), null, null,
    '{"torque_nm":90,"voltage":"380V","ip":"IP67","brand":"GENEBRE"}'::jsonb, 22,
    true, false, 1, 2, 720000, 560000, 14),

  ('FLN-304-100', 'Фланец плоский Ду100 Ру16 AISI 304',
    (select id from public.categories where name = 'Фланцы'), 'component',
    (select id from public.units where code = 'sht'), '304', 'ГОСТ 33259-2015',
    '{"du":100,"ru":16}'::jsonb, 6.5,
    true, true, 20, 40, 42000, 33000, 10),

  ('FLN-316-150', 'Фланец плоский Ду150 Ру16 AISI 316',
    (select id from public.categories where name = 'Фланцы'), 'component',
    (select id from public.units where code = 'sht'), '316', 'ГОСТ 33259-2015',
    '{"du":150,"ru":16}'::jsonb, 11,
    true, true, 12, 24, 78000, 61000, 14),

  ('MTZ-M16-A4', 'Болт М16х70 А4 (нерж.)',
    (select id from public.categories where name = 'Метизы'), 'component',
    (select id from public.units where code = 'sht'), '316', 'DIN 933',
    '{"d":16,"l":70,"class":"A4"}'::jsonb, 0.14,
    true, false, 500, 1000, 1250, 890, 7),

  ('CBL-KVVG-4X1.5', 'Кабель КВВГ 4х1.5',
    (select id from public.categories where name = 'Кабель и электрика'), 'material',
    (select id from public.units where code = 'm'), null, 'ГОСТ 1508-78',
    '{"cores":4,"section":1.5}'::jsonb, 0.21,
    true, false, 200, 500, 1450, 1080, 10),

  ('SRV-WELD', 'Работы сварочные (нормо-час)',
    (select id from public.categories where name = 'Работы и услуги'), 'service',
    (select id from public.units where code = 'h'), null, null, '{}'::jsonb, null,
    false, false, 0, 0, 9500, 6000, 0),

  ('SRV-PAINT', 'Антикоррозийная обработка (м2)',
    (select id from public.categories where name = 'Работы и услуги'), 'service',
    (select id from public.units where code = 'm2'), null, null, '{}'::jsonb, null,
    false, false, 0, 0, 7800, 4500, 0),

  ('PRD-RVS-100', 'Резервуар вертикальный стальной РВС-100 м3',
    (select id from public.categories where name = 'Металлопрокат'), 'product',
    (select id from public.units where code = 'sht'), '09Г2С', 'ГОСТ 31385-2016',
    '{"volume_m3":100,"purpose":"обессоленная вода"}'::jsonb, null,
    false, false, 0, 0, 0, 0, 45)
on conflict (sku) do nothing;

-- Пересчёт «лист ↔ тонна» для металлопроката
insert into public.item_units (item_id, unit_id, factor)
select i.id, (select id from public.units where code = 't'), 1 / (i.weight_kg / 1000.0)
from public.items i
where i.sku in ('MET-304-2X1500','MET-316-3X1500','MET-09G2S-8') and i.weight_kg > 0
on conflict do nothing;

-- Аналоги электроприводов (главный кейс временной подмены)
insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note)
select a.id, b.id, 3, false, 'Полная взаимозаменяемость по моменту и присоединению'
from public.items a, public.items b
where a.sku = 'DRV-AUMA-SA07' and b.sku = 'DRV-ROTORK-IQ10'
on conflict do nothing;

insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note)
select a.id, b.id, 1, true, 'Только как ВРЕМЕННАЯ подмена: момент 90 Н·м вместо 100, IP67 вместо IP68'
from public.items a, public.items b
where a.sku = 'DRV-AUMA-SA07' and b.sku = 'DRV-GENEBRE-EL'
on conflict do nothing;

-- Аналоги по маркам стали (304 ↔ 316 с оговоркой)
insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note)
select a.id, b.id, 2, false, 'AISI 316 дороже, но перекрывает требования по 304 (не наоборот)'
from public.items a, public.items b
where a.sku = 'ARM-ZD-304-100' and b.sku = 'ARM-ZD-316-100'
on conflict do nothing;
