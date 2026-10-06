-- ============================================
-- СИСТЕМА СТИХИЙ — 9 стихий, 27 заклинаний, 81 путь
-- ============================================

-- Заклинания стихий
CREATE TABLE IF NOT EXISTS element_spells (
    id TEXT PRIMARY KEY,
    element TEXT,
    name TEXT NOT NULL,
    icon TEXT,
    description TEXT,
    base_damage INTEGER DEFAULT 15,
    damage_per_level INTEGER DEFAULT 6,
    mana_cost INTEGER DEFAULT 10,
    cooldown_multiplier REAL DEFAULT 1.0,
    target_type TEXT DEFAULT 'single',
    spell_type TEXT DEFAULT 'attack',
    max_level INTEGER DEFAULT 9
);

-- Пути заклинаний
CREATE TABLE IF NOT EXISTS spell_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spell_id TEXT,
    path_id TEXT,
    name TEXT,
    description TEXT,
    effect_type TEXT,
    effect_value REAL,
    FOREIGN KEY (spell_id) REFERENCES element_spells(id)
);

-- ============ ОГОНЬ ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('fire_fist', 'fire', 'Огненный кулак', '👊', 'Концентрация пламени вокруг оружия для нанесения удара.', 18, 6, 10, 1.0, 'single', 'attack'),
('fire_bullet', 'fire', 'Огненная пуля', '🔥', 'Выстрел сгустком пламени.', 15, 5, 8, 0.9, 'single', 'attack'),
('fire_pillar', 'fire', 'Огненный столб', '🌋', 'Колонна пламени, вырывающаяся из-под земли.', 25, 9, 18, 1.4, 'single', 'attack');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('fire_fist', 'fury', 'Путь ярости', 'Урон растёт от полученного урона игроком', 'damage_from_damage_taken', 0.3),
('fire_fist', 'brand', 'Путь клейма', 'Оставляет огненную метку, снижающую броню цели', 'armor_reduction', 0.2),
('fire_fist', 'explosion', 'Путь взрыва', 'При попадании наносит урон соседним целям', 'splash_damage', 0.5),
('fire_bullet', 'burst', 'Путь очереди', 'Можно выпустить несколько пуль подряд', 'multi_shot', 3),
('fire_bullet', 'penetration', 'Путь пробития', 'Пули могут попасть по нескольким целям', 'pierce_targets', 2),
('fire_bullet', 'smolder', 'Путь тлеющего попадания', 'Оставляет цель гореть некоторое время', 'burn_dot', 5),
('fire_pillar', 'duration', 'Путь длительности', 'Столб горит дольше, нанося урон каждую секунду', 'duration_bonus', 3),
('fire_pillar', 'explosion', 'Путь взрыва', 'При завершении происходит взрыв, отбрасывающий врагов', 'explosion_knockback', 1.0),
('fire_pillar', 'spread', 'Путь распространения', 'Огонь стекает на землю, наносит урон и замедляет', 'ground_fire', 1.0);

-- ============ ВОДА ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('water_barrier', 'water', 'Водная преграда', '🛡️', 'Преграда, блокирующая атаки стихией.', 0, 0, 12, 1.3, 'self', 'buff'),
('water_heal', 'water', 'Целительные капли', '💧', 'Поток воды, исцеляющий раны.', 0, 0, 15, 1.2, 'self', 'heal'),
('water_wave', 'water', 'Разрушительная волна', '🌊', 'Мощный вал воды, сносящий всё на своём пути.', 22, 8, 20, 1.5, 'all', 'attack');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('water_barrier', 'shield', 'Путь щита', 'Увеличивает прочность преграды', 'shield_strength', 0.3),
('water_barrier', 'reflection', 'Путь отражения', 'Шанс отразить входящую атаку', 'reflect_chance', 0.2),
('water_barrier', 'cooling', 'Путь охлаждения', 'Замедляет тех, кто попал физической атакой', 'attacker_slow', 1.0),
('water_heal', 'deep_heal', 'Путь глубокого исцеления', 'Увеличивает объём восстанавливаемого здоровья', 'heal_bonus', 0.3),
('water_heal', 'purification', 'Путь очищения', 'Снимает негативные эффекты', 'cleanse', 1.0),
('water_heal', 'mastery', 'Путь мастерства', 'При повторном применении эффект исцеления увеличивается', 'stacking_heal', 0.15),
('water_wave', 'tide', 'Путь прилива', 'Попадает по двум целям', 'extra_targets', 1),
('water_wave', 'drowning', 'Путь утопления', 'Сбрасывает таймер заклинания врага', 'reset_enemy_cooldown', 1.0),
('water_wave', 'fury', 'Путь ярости бушующих эмоций', 'Урон пропорционален здоровью', 'damage_by_health', 0.5);

-- ============ ВОЗДУХ ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('wind_whirl', 'wind', 'Режущий вихрь', '🌪️', 'Вращающийся поток воздуха вокруг мага, наносящий урон атакующим врагам.', 12, 4, 10, 1.0, 'self', 'buff'),
('wind_flow', 'wind', 'Незримый поток', '💨', 'Невидимый удар воздуха по врагу.', 16, 6, 8, 0.8, 'single', 'attack'),
('wind_storm', 'wind', 'Направленный шторм', '🌀', 'Узкий ураганный поток, сбивающий и отбрасывающий цель.', 20, 7, 16, 1.3, 'single', 'attack');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('wind_whirl', 'expansion', 'Путь расширения', 'Бьёт по двум целям', 'extra_targets', 1),
('wind_whirl', 'suction', 'Путь всасывания', 'Снижает скорость врага', 'enemy_slow', 0.2),
('wind_whirl', 'continuity', 'Путь непрерывности', 'Может длиться больше одного хода', 'duration_bonus', 2),
('wind_flow', 'silence', 'Путь тишины', 'Шанс мгновенно перезарядить', 'instant_reset', 0.2),
('wind_flow', 'displacement', 'Путь смещения', 'Обнуляет таймер атаки врага', 'reset_enemy_timer', 1.0),
('wind_flow', 'edge', 'Путь режущей грани', 'Увеличивает урон, добавляя порез', 'bleed_damage', 4),
('wind_storm', 'distance', 'Путь дальности', 'Отбрасывает дальше, увеличивая перезарядку навыков врага', 'longer_knockback', 1.0),
('wind_storm', 'penetration', 'Путь пробития', 'Попадает по двум целям', 'extra_targets', 1),
('wind_storm', 'stun', 'Путь оглушения', 'При отталкивании есть шанс оглушить врага', 'stun_chance', 0.25);

-- ============ КИПЯЩАЯ ТЕНЬ ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('shadow_bite', 'boiling_shadow', 'Обмораживающий укус', '🥶', 'Атака, оставляющая ожог, похожий на обморожение.', 14, 5, 10, 1.0, 'single', 'attack'),
('shadow_merge', 'boiling_shadow', 'Слияние с тенью', '🌑', 'Маг сливается с тенью, становясь практически невидимым.', 0, 0, 15, 1.5, 'self', 'buff'),
('shadow_absorb', 'boiling_shadow', 'Поглощающий свет', '⚫', 'Сфера тьмы поглощает часть света и магии.', 18, 6, 14, 1.2, 'single', 'attack');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('shadow_bite', 'spread', 'Путь распространения', 'Постепенный урон увеличивается со временем', 'dot_growth', 0.2),
('shadow_bite', 'unquenchable', 'Путь неугасимости', 'Эффект невозможно исцелить', 'unhealable', 1.0),
('shadow_bite', 'absorption', 'Путь поглощения', 'Часть урона восстанавливает игроку здоровье', 'lifesteal', 0.2),
('shadow_merge', 'surprise', 'Путь внезапности', 'Первая атака при выходе из тени наносит дополнительный урон', 'ambush_bonus', 0.5),
('shadow_merge', 'silent_step', 'Путь бесшумной поступи', 'Ускоряет перезарядку умения', 'cooldown_reduction', 0.3),
('shadow_merge', 'cover', 'Путь покрывающей тени', 'Не получить урон, находясь под покровом', 'invulnerability', 1.0),
('shadow_absorb', 'hunger', 'Путь голода', 'Поглощённая энергия восстанавливает ману игроку', 'mana_restore', 10),
('shadow_absorb', 'choking', 'Путь удушения', 'Постепенный физический урон', 'physical_dot', 5),
('shadow_absorb', 'slow', 'Путь замедления', 'Каждую секунду увеличивает время перезарядки умений у врагов', 'enemy_cd_increase', 0.2);

-- ============ ПЛАЗМА ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('plasma_discharge', 'plasma', 'Плазменный разряд', '⚡', 'Нестабильный сгусток раскалённой энергии.', 20, 7, 12, 1.0, 'single', 'attack'),
('plasma_cut', 'plasma', 'Точный рез', '🔪', 'Узко направленный луч плазмы для прицельного уничтожения.', 22, 8, 14, 1.1, 'single', 'attack'),
('plasma_heat', 'plasma', 'Сварочный жар', '🔥', 'Направленный контролируемый жар для точного урона вблизи.', 18, 6, 10, 0.9, 'single', 'attack');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('plasma_discharge', 'overload', 'Путь перегрузки', 'Выше урон, но растёт шанс навредить себе', 'high_risk_damage', 0.5),
('plasma_discharge', 'stabilization', 'Путь стабилизации', 'Ниже урон и меньше шанс навредить себе', 'safe_damage', -0.2),
('plasma_discharge', 'chain_reaction', 'Путь цепной реакции', 'При попадании создаётся вторичный взрыв', 'secondary_explosion', 0.5),
('plasma_cut', 'surgeon', 'Путь хирурга', 'Увеличивает шанс попадания в уязвимые места', 'crit_chance', 0.2),
('plasma_cut', 'burn_through', 'Путь прожига', 'Луч попадёт, даже если цель уклонилась', 'unavoidable', 1.0),
('plasma_cut', 'separation', 'Путь разделения', 'Луч можно разделить на два потока', 'split_beam', 2),
('plasma_heat', 'concentration', 'Путь концентрации', 'Увеличивает точность по уязвимым местам', 'accuracy_bonus', 0.15),
('plasma_heat', 'endurance', 'Путь выдержки', 'Повышает шанс крита при последовательном использовании', 'stacking_crit', 0.1),
('plasma_heat', 'brand', 'Путь клейма', 'Прожигает броню, нанося урон напрямую', 'armor_bypass', 0.3);

-- ============ ЛЁД ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('ice_shield', 'ice', 'Ледяной щит', '🧊', 'Прочная защита, останавливающая почти любые атаки.', 0, 0, 15, 1.4, 'self', 'buff'),
('ice_knife', 'ice', 'Ледяной метательный нож', '🗡️', 'Одноразовый клинок для атаки.', 16, 6, 8, 0.8, 'single', 'attack'),
('ice_armor', 'ice', 'Ледяная броня', '🛡️', 'Покрытие тела слоем прочного льда, замедляя скорость.', 0, 0, 18, 1.5, 'self', 'buff');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('ice_shield', 'monolith', 'Путь монолита', 'Повышает прочность щита', 'shield_strength', 0.4),
('ice_shield', 'frostbite', 'Путь обморожения', 'Прямой физический урон наносит сильное обморожение', 'counter_frostbite', 1.0),
('ice_shield', 'shards', 'Путь осколков', 'При разрушении щит взрывается осколками', 'shield_explosion', 1.0),
('ice_knife', 'volley', 'Путь залпа', 'Позволяет метнуть несколько ножей', 'multi_throw', 3),
('ice_knife', 'deep_wound', 'Путь глубокой раны', 'Замедляет и наносит постепенный урон', 'slow_and_dot', 1.0),
('ice_knife', 'rebirth', 'Путь возрождения', 'Шанс не разрушить нож и использовать повторно', 'return_chance', 0.25),
('ice_armor', 'impregnable', 'Путь неприступности', 'Увеличенное сопротивление магии', 'magic_resist', 0.3),
('ice_armor', 'thorns', 'Путь шипов', 'Атакующие получают урон и обморожение', 'thorns_damage', 8),
('ice_armor', 'fluidity', 'Путь текучести', 'Броня не сковывает движение', 'no_slow', 1.0);

-- ============ МОЛНИЯ ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('storm_accurate', 'storm', 'Меткий разряд', '⚡', 'Точный удар молнией по одной цели.', 18, 6, 8, 0.8, 'single', 'attack'),
('storm_winding', 'storm', 'Извилистый разряд', '🌩️', 'Молния, бьющая под резкими углами, обходя щиты.', 20, 7, 12, 1.0, 'single', 'attack'),
('storm_foresight', 'storm', 'Разряд предвидения', '✨', 'Короткая вспышка, на миг замедляющая время вокруг.', 10, 4, 16, 1.5, 'all', 'debuff');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('storm_accurate', 'vulnerability', 'Путь уязвимости', 'Увеличивает шанс попасть в слабое место', 'crit_chance', 0.2),
('storm_accurate', 'ricochet', 'Путь рикошета', 'Молния может перескочить на ближайшего врага', 'chain_chance', 0.3),
('storm_accurate', 'cold_blood', 'Путь хладнокровия', 'Чем дольше бой, тем выше урон', 'damage_over_time', 0.1),
('storm_winding', 'penetration', 'Путь пробивания', 'Пробивает броню', 'armor_pierce', 0.3),
('storm_winding', 'multi_hit', 'Путь множественных ударов', 'Бьёт несколько раз одну цель', 'multi_hit', 3),
('storm_winding', 'disorientation', 'Путь дезориентации', 'Задевает случайных врагов', 'random_targets', 2),
('storm_foresight', 'stretch', 'Путь растяжения', 'Увеличивает длительность замедления', 'slow_duration', 2),
('storm_foresight', 'counter', 'Путь контрудара', 'Следующая атака получает бонус урона', 'counter_bonus', 0.5),
('storm_foresight', 'haste', 'Путь ускорения', 'После замедления игрок может атаковать мгновенно', 'instant_attack', 1.0);

-- ============ ХРУСТАЛЬНАЯ БУРЯ ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('crystal_whirl', 'crystal_storm', 'Кристальный вихрь', '🌪️', 'Поток мелких острых кристаллов, режущий всё на пути.', 16, 6, 10, 0.9, 'all', 'attack'),
('crystal_blade', 'crystal_storm', 'Кристальный штормовой клинок', '💎', 'Вокруг игрока формируется вращающееся кольцо кристаллических лезвий.', 14, 5, 12, 1.1, 'self', 'buff'),
('crystal_mark', 'crystal_storm', 'Кристальная метка', '✨', 'Россыпь кристаллов, взрывающаяся при контакте.', 22, 8, 15, 1.3, 'single', 'attack');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('crystal_whirl', 'sharpness', 'Путь остроты', 'Увеличивает урон от порезов', 'bleed_bonus', 0.3),
('crystal_whirl', 'expansion', 'Путь расширения', 'Попадает по нескольким целям', 'extra_targets', 2),
('crystal_whirl', 'entanglement', 'Путь затягивания', 'Вихрь замедляет цель', 'slow_effect', 0.2),
('crystal_blade', 'accumulation', 'Путь накопления', 'Чем дольше держится кольцо, тем больше урон', 'stacking_damage', 0.15),
('crystal_blade', 'dispersion', 'Путь рассеивания', 'При броске лезвия поражают несколько целей', 'multi_target', 2),
('crystal_blade', 'return', 'Путь возврата', 'Часть осколков возвращается, нанося урон', 'return_damage', 0.4),
('crystal_mark', 'mining', 'Путь минирования', 'Можно поставить несколько меток', 'max_marks', 3),
('crystal_mark', 'chain_explosion', 'Путь цепного взрыва', 'Взрыв одной метки детонирует соседние', 'chain_detonation', 1.0),
('crystal_mark', 'repeat', 'Путь повтора', 'Метка имеет шанс не исчезнуть', 'persist_chance', 0.2);

-- ============ КРОВЬ ФЕНИКСА ============
INSERT OR IGNORE INTO element_spells
(id, element, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type, spell_type) VALUES
('phoenix_warmth', 'phoenix_blood', 'Возрождающий жар', '🔥', 'Тёплый поток, лечащий раны.', 0, 0, 14, 1.2, 'self', 'heal'),
('phoenix_splash', 'phoenix_blood', 'Кровавый всплеск', '🩸', 'Атака, использующая жар и жидкость одновременно.', 20, 7, 12, 1.0, 'single', 'attack'),
('phoenix_steam', 'phoenix_blood', 'Испепеляющий пар', '💨', 'Облако пара, скрывающее игрока и поджигающее атакующих.', 8, 3, 16, 1.4, 'self', 'buff');

INSERT OR IGNORE INTO spell_paths (spell_id, path_id, name, description, effect_type, effect_value) VALUES
('phoenix_warmth', 'phoenix', 'Путь феникса', 'При смертельном уроне шанс восстановить здоровье', 'revive_chance', 0.2),
('phoenix_warmth', 'smoldering', 'Путь тлеющего исцеления', 'Эффект исцеления растягивается во времени', 'heal_over_time', 1.0),
('phoenix_warmth', 'cleansing', 'Путь очищающего пламени', 'Выжигает яды из крови', 'cleanse_poison', 1.0),
('phoenix_splash', 'burn', 'Путь ожога', 'Оставляет горящую рану, которая кровоточит', 'burn_bleed', 1.0),
('phoenix_splash', 'sacrifice', 'Путь жертвы', 'Можно потратить здоровье для увеличения урона', 'hp_for_damage', 0.5),
('phoenix_splash', 'ignition', 'Путь возгорания', 'Эффект может распространиться на соседние цели', 'spread_burn', 1.0),
('phoenix_steam', 'cover', 'Путь укрытия', 'Снижает точность по игроку', 'accuracy_reduction', 0.3),
('phoenix_steam', 'burn_attackers', 'Путь ожога', 'Атакующие получают постепенный урон', 'attacker_dot', 5),
('phoenix_steam', 'evaporation', 'Путь испарения', 'Облако восстанавливает здоровье игроку', 'heal_over_time', 3);