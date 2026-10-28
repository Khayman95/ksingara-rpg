-- ============================================
-- СИСТЕМА ВРАГОВ
-- ============================================

CREATE TABLE IF NOT EXISTS enemies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    category TEXT,
    weapon_type TEXT,
    hp INTEGER DEFAULT 50,
    damage INTEGER DEFAULT 10,
    armor REAL DEFAULT 0.0,
    energy_shield REAL DEFAULT 0.0,
    dodge REAL DEFAULT 0.0,
    speed INTEGER DEFAULT 2,
    gold_min INTEGER DEFAULT 5,
    gold_max INTEGER DEFAULT 15,
    exp_reward INTEGER DEFAULT 20,
    is_boss INTEGER DEFAULT 0,
    biome TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS element_resistances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    element TEXT,
    resist_element TEXT,
    value REAL
);

-- Стартовые кулдауны для путей
-- ALTER TABLE weapon_skill_paths ADD COLUMN start_without_cooldown INTEGER DEFAULT 0;
-- ALTER TABLE spell_paths ADD COLUMN start_without_cooldown INTEGER DEFAULT 0;

-- Пути, дающие старт без кулдауна
UPDATE weapon_skill_paths SET start_without_cooldown = 1
WHERE path_id IN ('series', 'silence', 'instant', 'haste');
UPDATE spell_paths SET start_without_cooldown = 1
WHERE path_id IN ('instant_reset', 'instant_attack');

-- Сопротивления стихий
INSERT OR IGNORE INTO element_resistances (element, resist_element, value) VALUES
('fire', 'fire', 0.4), ('fire', 'ice', -0.3), ('fire', 'water', -0.3),
('water', 'water', 0.4), ('water', 'fire', -0.3), ('water', 'storm', -0.3),
('wind', 'wind', 0.4), ('wind', 'earth', -0.3), ('wind', 'ice', -0.3),
('boiling_shadow', 'shadow', 0.4), ('boiling_shadow', 'light', -0.3),
('plasma', 'plasma', 0.4), ('plasma', 'earth', -0.3),
('ice', 'ice', 0.4), ('ice', 'fire', -0.3),
('storm', 'storm', 0.4), ('storm', 'earth', -0.3),
('crystal_storm', 'crystal_storm', 0.4), ('crystal_storm', 'storm', -0.3),
('phoenix_blood', 'phoenix_blood', 0.4), ('phoenix_blood', 'shadow', -0.3);

-- Враги кинжала
INSERT OR IGNORE INTO enemies
(id, name, icon, category, weapon_type, hp, damage, armor, energy_shield, dodge, speed,
gold_min, gold_max, exp_reward, is_boss, biome, description) VALUES
('glass_wasp', 'Стеклянная оса-жнец', '🐝', 'animal', 'dagger',
50, 12, 0.0, 0.0, 0.15, 3, 8, 15, 25, 0, 'forest',
'Полупрозрачное насекомое, охотится в темноте.'),
('shadow_whisper', 'Шёпот в тенях', '👤', 'humanoid', 'dagger',
60, 15, 0.05, 0.0, 0.25, 3, 12, 20, 30, 0, 'dark_forest',
'Существо без лица, тело — плащ из тьмы.'),
('living_shard', 'Живой осколок', '💎', 'elemental', 'dagger',
45, 10, 0.15, 0.1, 0.10, 2, 10, 18, 28, 0, 'mountains',
'Элементаль из осколков разбитого зеркала.'),

-- Враги рапиры
('needle_ray', 'Иглохвостый скат', '🐟', 'animal', 'rapier',
55, 13, 0.0, 0.05, 0.20, 3, 10, 18, 28, 0, 'sea',
'Летающий скат с хвостом-иглой.'),
('nowhere_fencer', 'Фехтовальщик из ниоткуда', '🎭', 'humanoid', 'rapier',
65, 16, 0.05, 0.10, 0.30, 3, 15, 25, 35, 0, 'city',
'Появляется из порталов.'),
('shimmer_beam', 'Мерцающий луч', '✨', 'elemental', 'rapier',
40, 14, 0.0, 0.20, 0.25, 3, 12, 22, 32, 0, 'beach',
'Существо из чистого света.'),

-- Враги топора
('axe_beetle', 'Жук-секира', '🪲', 'animal', 'battle_axe',
80, 18, 0.20, 0.0, 0.05, 2, 15, 25, 40, 0, 'jungle',
'Гигантский жук с мандибулами-топорами.'),
('bone_butcher', 'Костяной мясник', '💀', 'humanoid', 'battle_axe',
90, 20, 0.15, 0.05, 0.10, 2, 18, 30, 45, 0, 'dark_forest',
'Существо в костяных пластинах.'),
('magma_rift', 'Магматический разлом', '🌋', 'elemental', 'battle_axe',
75, 22, 0.10, 0.15, 0.05, 2, 20, 32, 48, 0, 'volcanic',
'Элементаль из лавы.'),

-- Враги жезла
('crystal_spider', 'Кристальный паук-ткач', '🕷️', 'animal', 'crystal_wand',
60, 14, 0.10, 0.15, 0.10, 2, 15, 25, 38, 0, 'magical_glade',
'Плетёт паутину из кристаллов.'),
('crystal_archivist', 'Кристальный архивариус', '📚', 'humanoid', 'crystal_wand',
70, 16, 0.05, 0.25, 0.15, 2, 20, 32, 45, 0, 'city',
'Покрыт кристаллами, хранящими знания.'),
('resonance_elem', 'Резонансный элементаль', '🔮', 'elemental', 'crystal_wand',
55, 18, 0.0, 0.30, 0.15, 2, 18, 28, 42, 0, 'mountains',
'Из чистой энергии.'),

-- Враги молота
('stone_ram', 'Каменный таран', '🐗', 'animal', 'war_hammer',
100, 22, 0.30, 0.05, 0.0, 1, 20, 35, 50, 0, 'mountains',
'Голова-молот, дробит всё.'),
('cyclops_smith', 'Кузнец-циклоп', '👁️', 'humanoid', 'war_hammer',
120, 25, 0.25, 0.10, 0.05, 1, 25, 40, 60, 0, 'mountains',
'Одноглазый гигант, куёт оружие в бою.'),
('quake_elem', 'Землетряс', '⛰️', 'elemental', 'war_hammer',
110, 28, 0.20, 0.20, 0.0, 1, 28, 45, 65, 0, 'volcanic',
'Из камня и вибраций.'),

-- Враги посоха
('electric_ray', 'Электрический скат-охотник', '⚡', 'animal', 'storm_staff',
70, 18, 0.05, 0.20, 0.15, 2, 18, 30, 45, 0, 'sea',
'Летающий скат, стреляет молниями.'),
('storm_priest', 'Грозовой жрец', '🌩️', 'humanoid', 'storm_staff',
85, 22, 0.05, 0.25, 0.10, 2, 22, 38, 55, 0, 'taiga',
'В мантии, управляет молниями.'),
('storm_whirl', 'Штормовой вихрь', '🌀', 'elemental', 'storm_staff',
65, 20, 0.0, 0.30, 0.20, 3, 20, 35, 50, 0, 'mountains',
'Из чистой электрической энергии.'),

-- Враги клеймора
('twin_wolf', 'Двухголовый волк-мечник', '🐺', 'animal', 'claymore',
90, 20, 0.10, 0.10, 0.15, 2, 20, 32, 48, 0, 'taiga',
'Волк с двумя головами.'),
('fallen_knight', 'Падший рыцарь', '⚔️', 'humanoid', 'claymore',
110, 24, 0.25, 0.15, 0.10, 2, 25, 40, 60, 0, 'dark_forest',
'Огромный рыцарь в доспехах.'),
('ether_blade', 'Эфирный клинок', '🗡️', 'elemental', 'claymore',
80, 22, 0.15, 0.25, 0.20, 3, 22, 38, 55, 0, 'magical_glade',
'Из энергии, принимает форму меча.'),

-- Враги парных клинков
('four_arm_mantis', 'Четырёхрукий богомол', '🦗', 'animal', 'dual_blades',
65, 16, 0.05, 0.05, 0.30, 3, 18, 30, 45, 0, 'jungle',
'Насекомое с четырьмя лезвиями-руками.'),
('dancer_assassin', 'Танцор-убийца', '💃', 'humanoid', 'dual_blades',
70, 18, 0.05, 0.05, 0.35, 3, 22, 35, 50, 0, 'city',
'Ловкое существо с двумя клинками.'),
('blade_whirl_elem', 'Вихрь клинков', '🌪️', 'elemental', 'dual_blades',
60, 15, 0.10, 0.15, 0.25, 3, 20, 32, 48, 0, 'mountains',
'Из вращающихся лезвий.'),

-- Враги хлыста
('vine_boa', 'Лоза-удав', '🌿', 'animal', 'whip',
75, 14, 0.10, 0.10, 0.05, 2, 15, 25, 40, 0, 'jungle',
'Растение, хватает и душит.'),
('beastmaster', 'Погонщик', '🔗', 'humanoid', 'whip',
80, 16, 0.10, 0.15, 0.15, 2, 20, 32, 48, 0, 'savanna',
'Существо с хлыстом, контролирует других.'),
('chain_spirit', 'Цепной дух', '⛓️', 'elemental', 'whip',
70, 15, 0.05, 0.25, 0.20, 3, 18, 30, 45, 0, 'dark_forest',
'Из цепей, опутывает и сковывает.'),

-- Боссы
('barrier_guardian', 'Страж Барьера', '👁️‍🗨️', 'elemental', 'claymore',
400, 45, 0.35, 0.35, 0.20, 2, 150, 300, 500, 1, NULL,
'Легендарный страж границы миров.'),
('void_sovereign', 'Владыка Пустоты', '🌌', 'elemental', 'storm_staff',
350, 50, 0.25, 0.40, 0.25, 3, 200, 400, 600, 1, NULL,
'Существо из-за барьера.'),
('ancient_devourer', 'Древний Пожиратель', '🐉', 'animal', 'dual_blades',
500, 55, 0.40, 0.20, 0.15, 2, 250, 500, 800, 1, NULL,
'Древнее существо, пожирающее магию.');