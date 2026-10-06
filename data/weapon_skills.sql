-- ============================================
-- СИСТЕМА ОРУЖИЯ — 9 видов, 27 навыков, 81 путь
-- ============================================

-- Виды оружия
CREATE TABLE IF NOT EXISTS weapons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    hands INTEGER DEFAULT 1,
    speed INTEGER DEFAULT 2,
    physical INTEGER DEFAULT 2,
    magic INTEGER DEFAULT 2,
    description TEXT
);

-- Навыки оружия
CREATE TABLE IF NOT EXISTS weapon_skills (
    id TEXT PRIMARY KEY,
    weapon_type TEXT,
    name TEXT NOT NULL,
    icon TEXT,
    description TEXT,
    base_damage INTEGER DEFAULT 10,
    damage_per_level INTEGER DEFAULT 5,
    mana_cost INTEGER DEFAULT 5,
    cooldown_multiplier REAL DEFAULT 1.0,
    target_type TEXT DEFAULT 'single',
    max_level INTEGER DEFAULT 9
);

-- Пути развития навыков
CREATE TABLE IF NOT EXISTS weapon_skill_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT,
    path_id TEXT,
    name TEXT,
    description TEXT,
    effect_type TEXT,
    effect_value REAL,
    FOREIGN KEY (skill_id) REFERENCES weapon_skills(id)
);

-- Экземпляры оружия
CREATE TABLE IF NOT EXISTS weapon_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weapon_type TEXT,
    name TEXT,
    level INTEGER DEFAULT 1,
    rarity TEXT DEFAULT 'common',
    bonus_speed INTEGER DEFAULT 0,
    bonus_physical INTEGER DEFAULT 0,
    bonus_magic INTEGER DEFAULT 0,
    price INTEGER DEFAULT 100
);

-- ============================================
-- 9 ВИДОВ ОРУЖИЯ
-- ============================================

INSERT OR IGNORE INTO weapons (id, name, icon, hands, speed, physical, magic, description) VALUES
('dagger', 'Кинжал-катар', '🗡️', 1, 3, 2, 1, 'Быстрое оружие для ловких убийц'),
('rapier', 'Рапира', '⚔️', 1, 3, 1, 2, 'Точное оружие, сочетающее скорость и магию'),
('battle_axe', 'Боевой топор', '🪓', 1, 2, 3, 1, 'Мощное рубящее оружие'),
('crystal_wand', 'Кристальный жезл', '🔮', 1, 2, 1, 3, 'Проводник магии с кристаллом'),
('whip', 'Хлыст', '🪢', 1, 3, 0, 3, 'Оружие контроля и чистой магии'),
('claymore', 'Клеймор', '⚔️', 2, 2, 2, 2, 'Универсальный двуручный меч'),
('war_hammer', 'Двуручный молот', '🔨', 2, 1, 3, 2, 'Сокрушительная сила'),
('storm_staff', 'Посох-разрядник', '⚡', 2, 1, 2, 3, 'Проводник чистой энергии'),
('dual_blades', 'Парные клинки', '🗡️', 2, 3, 3, 0, 'Максимальная физическая мощь');

-- ============================================
-- КИНЖАЛ
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('dagger_double_stab', 'dagger', 'Двойной укол', '🗡️', 'Быстрый двойной удар. Второй удар может нанести больше урона.', 12, 4, 8, 1.0, 'single'),
('dagger_sliding_cut', 'dagger', 'Скользящий разрез', '✂️', 'Атака игнорирует часть брони противника.', 15, 5, 10, 1.1, 'single'),
('dagger_throw', 'dagger', 'Бросок клинка', '🎯', 'Метательная атака. Шанс потерять клинок, но враг замедляется.', 20, 6, 12, 1.3, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('dagger_double_stab', 'eviscerate', 'Путь потрошения', 'Второй удар наносит больше урона, если первый удар попал', 'bonus_second_hit', 0.5),
('dagger_double_stab', 'shadow', 'Путь тени', 'После удара есть шанс стать невидимым на один ход', 'invisibility_chance', 0.15),
('dagger_double_stab', 'poison', 'Путь яда', 'Оба удара имеют шанс наложения яда', 'poison_chance', 0.3),
('dagger_sliding_cut', 'opening', 'Путь вскрытия', 'Увеличивает игнорирование брони', 'armor_penetration', 0.3),
('dagger_sliding_cut', 'bloodloss', 'Путь кровопотери', 'Накладывает раны, наносящие постепенный физический урон', 'bleed_damage', 5),
('dagger_sliding_cut', 'vulnerability', 'Путь уязвимости', 'Увеличивает шанс попадания по уязвимой точке', 'crit_chance', 0.15),
('dagger_throw', 'return', 'Путь возврата', 'Шанс возвращения клинка для повторного броска', 'return_chance', 0.4),
('dagger_throw', 'ricochet', 'Путь рикошета', 'Шанс отрикошетить в другого врага', 'ricochet_chance', 0.3),
('dagger_throw', 'pin', 'Путь пригвождения', 'На 1 ход обездвиживает цель', 'immobilize_duration', 1);

-- ============================================
-- РАПИРА
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('rapier_lightning_thrust', 'rapier', 'Молниеносный выпад', '⚡', 'Самый быстрый удар с самым низким уроном.', 8, 3, 5, 0.7, 'single'),
('rapier_charged_sting', 'rapier', 'Заряженный укол', '✨', 'Снижает на 1 ход скорость врага.', 12, 4, 10, 1.1, 'single'),
('rapier_feint', 'rapier', 'Финт', '🌀', 'Сложный замах, снижающий защиту на следующий ход.', 10, 4, 8, 1.0, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('rapier_lightning_thrust', 'series', 'Путь серии', 'Можно использовать без задержки, если предыдущий удар попал', 'no_cooldown_on_hit', 1.0),
('rapier_lightning_thrust', 'charge', 'Путь заряда', 'Каждое попадание повышает магический урон по цели', 'magic_charge_stacking', 0.1),
('rapier_lightning_thrust', 'evasion', 'Путь уклонения', 'Даёт шанс уклонения на 1 ход', 'dodge_buff', 0.2),
('rapier_charged_sting', 'paralysis', 'Путь паралича', 'Шанс не снизить скорость, а обездвижить врага', 'immobilize_chance', 0.25),
('rapier_charged_sting', 'exhaustion', 'Путь истощения', 'Снижает скорость на несколько ходов', 'slow_duration', 3),
('rapier_charged_sting', 'transfer', 'Путь передачи', 'Возможно замедлить одновременно несколько целей', 'slow_targets', 3),
('rapier_feint', 'expose', 'Путь разоблачения', 'Сильнее снижает защиту', 'armor_reduction', 0.3),
('rapier_feint', 'double_deception', 'Путь двойного обмана', 'Повышает шанс критического удара', 'crit_chance', 0.15),
('rapier_feint', 'team_strike', 'Путь командного удара', 'Действует на всех врагов в бою', 'aoe_debuff', 1.0);

-- ============================================
-- БОЕВОЙ ТОПОР
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('axe_cleave', 'battle_axe', 'Раскол', '🪓', 'Шанс сломать щит или блок противника.', 18, 6, 10, 1.1, 'single'),
('axe_round_strike', 'battle_axe', 'Круговой удар', '🌀', 'Круговая атака, наносящая урон сразу нескольким целям.', 15, 5, 15, 1.3, 'all'),
('axe_notch', 'battle_axe', 'Засечка', '🩸', 'Наносит кровоточащую рану.', 14, 5, 12, 1.2, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('axe_cleave', 'destruction', 'Путь крушения', 'Полностью разрушает щит при попадании', 'destroy_shield', 1.0),
('axe_cleave', 'overload', 'Путь перегрузки', 'Дополнительный урон по щитам и броне', 'bonus_vs_shield', 0.5),
('axe_cleave', 'stun', 'Путь оглушения', 'Шанс контузить цель после раскола блока', 'stun_chance', 0.2),
('axe_round_strike', 'storm', 'Путь шторма', 'Увеличивает количество дополнительных целей', 'extra_targets', 2),
('axe_round_strike', 'flaying', 'Путь свежевания', 'Добавляет кровотечение поражённым врагам', 'bleed_on_hit', 1.0),
('axe_round_strike', 'whirlwind', 'Путь вихря', 'Позволяет провести второй удар, но с меньшим уроном', 'second_strike', 0.5),
('axe_notch', 'infection', 'Путь заражения', 'Постепенный урон увеличивается со временем', 'bleed_growth', 0.2),
('axe_notch', 'weakening', 'Путь ослабления', 'Цель получает больше урона, пока кровоточит', 'damage_amp_when_bleeding', 0.3),
('axe_notch', 'multiple_wounds', 'Путь множественных ран', 'Можно накладывать несколько стаков засечки', 'bleed_stacks', 5);

-- ============================================
-- КРИСТАЛЬНЫЙ ЖЕЗЛ
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('wand_push_discharge', 'crystal_wand', 'Разряд-толчок', '💫', 'Слабый удар, но заставляет врага пропустить ход.', 8, 3, 8, 0.9, 'single'),
('wand_resonance_impulse', 'crystal_wand', 'Резонансный импульс', '⚡', 'Накапливает магический заряд и бьёт по нескольким врагам.', 15, 5, 15, 1.2, 'all'),
('wand_conductive_mark', 'crystal_wand', 'Проводящая метка', '🎯', 'Прикрепляет метку, увеличивающую урон стихии по помеченному.', 5, 2, 12, 1.4, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('wand_push_discharge', 'knockback', 'Путь отбрасывания', 'Увеличивает время атаки врага', 'slow_duration', 2),
('wand_push_discharge', 'stun', 'Путь оглушения', 'Враг при толчке получает дополнительный урон', 'collision_damage', 15),
('wand_push_discharge', 'resonance', 'Путь резонанса', 'Дополнительный урон магией', 'bonus_magic_damage', 10),
('wand_resonance_impulse', 'expansion', 'Путь расширения', 'Больше шанс попасть по нескольким врагам', 'extra_targets_chance', 0.4),
('wand_resonance_impulse', 'accumulation', 'Путь накопления', 'Импульс растёт при последовательном использовании', 'stacking_damage', 0.15),
('wand_resonance_impulse', 'breakthrough', 'Путь пробоя', 'Игнорирует часть защиты цели', 'armor_penetration', 0.25),
('wand_conductive_mark', 'amplification', 'Путь усиления', 'Увеличивает бонус урона от проводящих атак', 'mark_bonus', 0.2),
('wand_conductive_mark', 'propagation', 'Путь распространения', 'При гибели врага метка перекидывается на другого', 'mark_transfer', 1.0),
('wand_conductive_mark', 'detonation', 'Путь детонации', 'Метка взрывается по истечении времени', 'mark_explosion', 30);

-- ============================================
-- ДВУРУЧНЫЙ МОЛОТ
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('hammer_crushing_blow', 'war_hammer', 'Сокрушающий удар', '🔨', 'Долгий удар с большим уроном.', 30, 10, 15, 1.3, 'single'),
('hammer_stun', 'war_hammer', 'Оглушение', '💥', 'Удар с шансом стана.', 20, 7, 18, 1.4, 'single'),
('hammer_energy_ricochet', 'war_hammer', 'Разрядный отскок', '⚡', 'Магическая энергия может задеть рядом стоящего врага.', 22, 8, 20, 1.5, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('hammer_crushing_blow', 'destruction', 'Путь разрушения', 'Дополнительный урон по броне', 'bonus_vs_armor', 0.4),
('hammer_crushing_blow', 'earthquake', 'Путь землетрясения', 'Ударная волна замедляет противника и рядом стоящего врага', 'aoe_slow', 1.0),
('hammer_crushing_blow', 'penetration', 'Путь пробития', 'Урон получает несколько целей', 'extra_targets', 1),
('hammer_stun', 'long_stun', 'Путь долгого стана', 'Увеличивает длительность стана', 'stun_duration', 2),
('hammer_stun', 'pain_shock', 'Путь болевого шока', 'Во время стана цель получает урон со временем', 'dot_during_stun', 5),
('hammer_stun', 'mass_strike', 'Путь массового удара', 'Эффект стана задевает несколько целей', 'aoe_stun', 1.0),
('hammer_energy_ricochet', 'chain', 'Путь цепи', 'Может задеть несколько целей', 'extra_targets', 2),
('hammer_energy_ricochet', 'amplification', 'Путь усиления', 'Увеличивает урон отскочившего заряда', 'ricochet_damage_bonus', 0.3),
('hammer_energy_ricochet', 'grounding', 'Путь заземления', 'Снижает сопротивление физическому урону', 'physical_resist_reduction', 0.2);

-- ============================================
-- ПОСОХ-РАЗРЯДНИК
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('staff_energy_wave', 'storm_staff', 'Волна энергии', '🌊', 'Бьёт 2 врагов стихией.', 18, 6, 15, 1.2, 'chain'),
('staff_charged_strike', 'storm_staff', 'Накопительный удар', '💠', 'Чем дольше готовить навык, тем сильнее удар.', 15, 5, 20, 1.5, 'single'),
('staff_chain_strike', 'storm_staff', 'Цепной удар', '⛓️', 'Двойной взмах. Если первый удар попадает, второй попадает в другого врага.', 20, 7, 18, 1.3, 'chain');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('staff_energy_wave', 'storm', 'Путь шторма', 'Шанс оттолкнуть врага', 'knockback_chance', 0.3),
('staff_energy_wave', 'exhaustion', 'Путь истощения', 'Снижает ману на несколько ходов', 'mana_drain', 5),
('staff_energy_wave', 'long_discharge', 'Путь длительного разряда', 'Волна наносит урон 2 раза', 'double_hit', 1.0),
('staff_charged_strike', 'patience', 'Путь терпения', 'Максимальное количество заряда увеличено', 'max_charge_bonus', 3),
('staff_charged_strike', 'explosion', 'Путь взрыва', 'При полном заряде наносит урон двум целям', 'full_charge_aoe', 2),
('staff_charged_strike', 'instant', 'Путь мгновенного разряда', 'Шанс полностью зарядиться мгновенно', 'instant_charge_chance', 0.15),
('staff_chain_strike', 'long_chain', 'Путь длинной цепи', 'Попадает вторым ударом по двум целям', 'extra_chain_targets', 2),
('staff_chain_strike', 'amplification', 'Путь усиления', 'Второй удар наносит повышенный урон', 'second_hit_bonus', 0.4),
('staff_chain_strike', 'closure', 'Путь замыкания', 'Второй удар может попасть по первому врагу и нанесёт дополнительный урон', 'return_strike', 0.5);

-- ============================================
-- КЛЕЙМОР
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('claymore_straight', 'claymore', 'Прямой удар', '⚔️', 'Простая атака, без штрафов и особенностей.', 20, 7, 8, 1.0, 'single'),
('claymore_rising', 'claymore', 'Восходящий удар', '⬆️', 'Удар снизу вверх. Медленный, но с высоким уроном.', 25, 9, 12, 1.3, 'single'),
('claymore_parry', 'claymore', 'Парирующий контр-удар', '🛡️', 'Стойка, блокирующая вражеский удар и наносящая ответный.', 18, 6, 14, 1.2, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('claymore_straight', 'stability', 'Путь стабильности', 'Снижает получаемый урон при использовании', 'damage_reduction', 0.15),
('claymore_straight', 'strength', 'Путь силы', 'Увеличивает базовый урон удара от силы', 'strength_scaling', 0.5),
('claymore_straight', 'endurance', 'Путь выносливости', 'Снижает затраты маны и увеличивает скорость атаки', 'mana_speed_bonus', 0.2),
('claymore_rising', 'throw_up', 'Путь подброса', 'Подкидывает врагов в воздух — враги пропускают ход', 'airborne', 1.0),
('claymore_rising', 'rupture', 'Путь разрыва', 'Дополнительный урон по броне', 'armor_penetration', 0.3),
('claymore_rising', 'impulse', 'Путь импульса', 'Следующий удар получает бонус к скорости на несколько ходов', 'speed_buff', 0.3),
('claymore_parry', 'perfect_block', 'Путь идеального блока', 'Шанс полного блока урона', 'block_chance', 0.25),
('claymore_parry', 'retribution', 'Путь возмездия', 'Контр-удар наносит больше урона', 'counter_damage_bonus', 0.5),
('claymore_parry', 'resilience', 'Путь стойкости', 'При успешном парировании восстанавливает здоровье', 'heal_on_parry', 10);

-- ============================================
-- ПАРНЫЕ КЛИНКИ
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('dual_blade_flurry', 'dual_blades', 'Шквал клинков', '🌀', 'Серия ударов. Каждый следующий удар имеет меньший шанс попадания (макс 5 ударов).', 10, 4, 15, 1.2, 'single'),
('dual_cross_slash', 'dual_blades', 'Крестообразный рез', '✖️', 'Удар обоими клинками сразу.', 22, 8, 12, 1.1, 'single'),
('dual_blade_dance', 'dual_blades', 'Танец лезвий', '💃', 'Стойка уклонения с контратакой. Действует, пока по герою не попадут.', 15, 5, 18, 1.4, 'single');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('dual_blade_flurry', 'fury', 'Путь ярости', 'Каждый последующий удар серии сильнее', 'increasing_damage', 0.15),
('dual_blade_flurry', 'unstoppable', 'Путь неудержимости', 'Увеличивает количество ударов в серии до восьми', 'max_hits', 8),
('dual_blade_flurry', 'blood_feast', 'Путь кровавого пира', 'Восстанавливает здоровье за попадание', 'lifesteal', 3),
('dual_cross_slash', 'dispersion', 'Путь рассеивания', 'Увеличивает шанс критического удара', 'crit_chance', 0.2),
('dual_cross_slash', 'double_strike', 'Путь двойного удара', 'Наносит урон дважды', 'double_hit', 1.0),
('dual_cross_slash', 'wide_swing', 'Путь широкого взмаха', 'Может задеть двух целей', 'extra_targets', 1),
('dual_blade_dance', 'grace', 'Путь грации', 'Выше шанс уклонения', 'dodge_bonus', 0.2),
('dual_blade_dance', 'retribution', 'Путь возмездия', 'Контрудар наносит дополнительный урон', 'counter_bonus', 0.4),
('dual_blade_dance', 'blade_whirl', 'Путь вихря клинков', 'При уклонении задевает соседнего врага', 'aoe_on_dodge', 1.0);

-- ============================================
-- ХЛЫСТ
-- ============================================

INSERT OR IGNORE INTO weapon_skills
(id, weapon_type, name, icon, description, base_damage, damage_per_level, mana_cost, cooldown_multiplier, target_type) VALUES
('whip_lash', 'whip', 'Хлёсткий удар', '🪢', 'Слабый физический удар, наносящий снижение сопротивления стихии.', 10, 4, 8, 1.0, 'single'),
('whip_entangle', 'whip', 'Опутывание', '🕸️', 'Обездвиживание цели на несколько ходов.', 12, 4, 15, 1.3, 'single'),
('whip_discharge_loop', 'whip', 'Разрядная петля', '⚡', 'Если опутано несколько целей, магический заряд перескакивает, нанося урон.', 20, 7, 20, 1.4, 'chain');

INSERT OR IGNORE INTO weapon_skill_paths (skill_id, path_id, name, description, effect_type, effect_value) VALUES
('whip_lash', 'exhaustion', 'Путь истощения', 'Сильнее снижение сопротивления', 'resist_reduction', 0.2),
('whip_lash', 'ranged', 'Путь дальнего боя', 'Враги имеют ниже скорость атаки', 'enemy_slow', 0.15),
('whip_lash', 'multi_strike', 'Путь множественного удара', 'Бьёт по нескольким целям', 'extra_targets', 2),
('whip_entangle', 'long_bonds', 'Путь долгих оков', 'Увеличивает длительность обездвиживания', 'immobilize_duration', 2),
('whip_entangle', 'pain_discharge', 'Путь болевого разряда', 'Во время обездвиживания цель получает дополнительный урон', 'dot_damage', 6),
('whip_entangle', 'group_capture', 'Путь группового захвата', 'Возможно обездвижить несколько целей', 'aoe_immobilize', 2),
('whip_discharge_loop', 'big_chain', 'Путь большой цепи', 'Увеличивает количество целей в цепи', 'extra_chain_targets', 2),
('whip_discharge_loop', 'charge_amplification', 'Путь усиления заряда', 'Увеличивает урон по следующей цели', 'chain_damage_growth', 0.2),
('whip_discharge_loop', 'exhaustion', 'Путь истощения', 'Снижает ману всех задетых целей', 'mana_drain_all', 5);

-- ============================================
-- ЭКЗЕМПЛЯРЫ ОРУЖИЯ (для теста)
-- ============================================

INSERT OR IGNORE INTO weapon_instances (weapon_type, name, level, rarity, price) VALUES
('claymore', 'Железный клеймор', 1, 'common', 100),
('claymore', 'Стальной клеймор', 3, 'common', 300),
('claymore', 'Клеймор теней', 5, 'rare', 800),
('dagger', 'Ржавый кинжал', 1, 'common', 50),
('dagger', 'Кинжал убийцы', 3, 'common', 250),
('dagger', 'Кинжал теней', 5, 'rare', 600),
('rapier', 'Простая рапира', 1, 'common', 80),
('battle_axe', 'Ржавый топор', 1, 'common', 90),
('crystal_wand', 'Треснувший жезл', 1, 'common', 120),
('whip', 'Кожаный хлыст', 1, 'common', 70),
('war_hammer', 'Каменный молот', 1, 'common', 150),
('storm_staff', 'Посох ученика', 1, 'common', 130),
('dual_blades', 'Парные кинжалы', 1, 'common', 110);