import random
import json
import sqlite3
import os


class GameDatabase:
    def __init__(self, db_path='data/game.db'):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.create_tables()
        self.seed_data()

    def create_tables(self):
        cursor = self.conn.cursor()
        cursor.executescript('''
            CREATE TABLE IF NOT EXISTS biomes (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
                color_r REAL DEFAULT 0.5, color_g REAL DEFAULT 0.5,
                color_b REAL DEFAULT 0.5, color_a REAL DEFAULT 1.0,
                description TEXT, movement_cost INTEGER DEFAULT 1,
                passable_without_boat INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS settlements (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
                race TEXT, description TEXT, icon TEXT, services TEXT
            );
            CREATE TABLE IF NOT EXISTS map_cells (
                x INTEGER, y INTEGER, biome_id TEXT, passable INTEGER DEFAULT 1,
                settlement_id TEXT, event_id TEXT, description TEXT,
                PRIMARY KEY (x, y)
            );
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
                description TEXT, chance REAL DEFAULT 0.3, message TEXT,
                damage INTEGER, heal_percent INTEGER, heal_mana_percent INTEGER,
                dungeon_id TEXT
            );
            CREATE TABLE IF NOT EXISTS event_biomes (
                event_id TEXT, biome_id TEXT,
                PRIMARY KEY (event_id, biome_id)
            );
            CREATE TABLE IF NOT EXISTS mobs (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, health INTEGER DEFAULT 30,
                damage INTEGER DEFAULT 5, defense INTEGER DEFAULT 0,
                exp_reward INTEGER DEFAULT 10, icon TEXT
            );
            CREATE TABLE IF NOT EXISTS mob_biomes (
                mob_id TEXT, biome_id TEXT,
                PRIMARY KEY (mob_id, biome_id)
            );
        ''')
        self.conn.commit()

    def seed_data(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM biomes")
        if cursor.fetchone()[0] > 0:
            return

        # Биомы
        biomes = [
            ("desert", "Пустыня", "biomes/desert.png", 0.85, 0.7, 0.25, 1.0, "Бескрайние пески", 2, 1),
            ("forest", "Лес", "biomes/forest.png", 0.15, 0.45, 0.15, 1.0, "Густой лиственный лес", 1, 1),
            ("sea", "Море", "biomes/sea.png", 0.1, 0.35, 0.7, 1.0, "Тёплое море", 3, 0),
            ("ocean", "Океан", "biomes/ocean.png", 0.05, 0.2, 0.55, 1.0, "Глубокий океан", 4, 0),
            ("beach", "Пляж", "biomes/beach.png", 0.9, 0.85, 0.6, 1.0, "Песчаный берег", 1, 1),
            ("savanna", "Саванна", "biomes/savanna.png", 0.75, 0.65, 0.2, 1.0, "Золотые травы", 1, 1),
            ("taiga", "Тайга", "biomes/taiga.png", 0.1, 0.35, 0.25, 1.0, "Холодный хвойный лес", 2, 1),
            ("jungle", "Джунгли", "biomes/jungle.png", 0.08, 0.4, 0.1, 1.0, "Густые влажные джунгли", 2, 1),
            ("mountains", "Горы", "biomes/mountains.png", 0.5, 0.45, 0.4, 1.0, "Высокие каменистые пики", 2, 1)
        ]
        cursor.executemany("INSERT INTO biomes VALUES (?,?,?,?,?,?,?,?,?,?)", biomes)

        # Поселения
        settlements = [
            ("ksin_daros", "Ксин-Дарос", "city", None, "Великая столица королевства Ксингара",
             "settlements/city_capital.png", "inn,shop,blacksmith,guild,temple,library"),
            ("izumrudny_port", "Порт Изумрудных Ветров", "city", None, "Крупнейший порт королевства",
             "settlements/city_port.png", "inn,shop,shipyard,tavern"),
            ("citadel_vechnogo_lda", "Цитадель Вечного Льда", "city", None, "Суровая северная крепость",
             "settlements/city_fortress.png", "inn,blacksmith,temple,barracks"),
            ("el_arin", "Эл'Арин", "village", "elf", "Эльфийская деревня", "settlements/village_elf.png",
             "inn,herbalist"),
            ("kamenny_gorn", "Каменный Горн", "village", "dwarf", "Дварфийская деревня",
             "settlements/village_dwarf.png", "inn,blacksmith"),
            ("ork_tar", "Орк'Тар", "village", "orc", "Оркское поселение", "settlements/village_orc.png", "inn,arena"),
            ("tihaya_gavan", "Тихая Гавань", "village", "halfling", "Деревня полуросликов",
             "settlements/village_halfling.png", "inn,shop"),
            ("zvezdny_shpil", "Звёздный Шпиль", "village", "human", "Человеческая деревня",
             "settlements/village_human.png", "inn,observatory"),
            ("gnomiy_mechanism", "Гномий Механизм", "village", "gnome", "Деревня гномов",
             "settlements/village_gnome.png", "inn,workshop"),
            ("drakoniy_klyk", "Драконий Клык", "village", "dragonborn", "Поселение драконорождённых",
             "settlements/village_dragonborn.png", "inn,temple"),
            ("temny_ugol", "Тёмный Угол", "village", "tiefling", "Поселение тифлингов",
             "settlements/village_tiefling.png", "inn,shadow_market"),
            ("svetly_holm", "Светлый Холм", "village", "aasimar", "Поселение аасимаров",
             "settlements/village_aasimar.png", "inn,temple")
        ]
        cursor.executemany("INSERT INTO settlements VALUES (?,?,?,?,?,?,?)", settlements)

        # События
        events = [
            ("nothing", "Тишина", "nothing", "Вокруг тихо.", 0.5, "Ничего не происходит...", None, None, None, None),
            ("oasis", "Оазис", "heal", "Оазис в пустыне.", 0.1, "Ты отдыхаешь!", None, 30, None, None),
            ("sandstorm", "Песчаная буря", "danger", "Буря!", 0.12, "Песок хлещет!", 10, None, None, None),
            ("wolf_ambush", "Волчья засада", "battle", "Волки!", 0.2, "Волки атакуют!", None, None, None, None),
            ("find_herbs", "Целебные травы", "loot", "Травы.", 0.15, "Ты собрал травы!", None, None, None, None),
            ("shipwreck", "Обломки корабля", "loot", "Обломки.", 0.1, "Ты нашёл предметы!", None, None, None, None),
            ("blizzard", "Вьюга", "danger", "Вьюга!", 0.15, "Ледяной ветер!", 12, None, None, None),
            ("cave_entrance", "Вход в пещеру", "dungeon", "Пещера.", 0.1, "Вход в пещеру.", None, None, None,
             "mountain_cave"),
            ("rockslide", "Камнепад", "danger", "Камни!", 0.1, "Камни падают!", 15, None, None, None)
        ]
        cursor.executemany("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?)", events)

        # Связи событий с биомами
        eb = [
            ("nothing", "desert"), ("oasis", "desert"), ("sandstorm", "desert"),
            ("nothing", "forest"), ("wolf_ambush", "forest"), ("find_herbs", "forest"),
            ("nothing", "sea"), ("shipwreck", "sea"),
            ("nothing", "taiga"), ("blizzard", "taiga"), ("wolf_ambush", "taiga"),
            ("nothing", "mountains"), ("cave_entrance", "mountains"), ("rockslide", "mountains")
        ]
        cursor.executemany("INSERT INTO event_biomes VALUES (?,?)", eb)

        # Мобы
        mobs = [
            ("wolf", "Волк", 30, 8, 2, 15, "mobs/wolf.png"),
            ("bear", "Медведь", 60, 15, 5, 30, "mobs/bear.png"),
            ("giant_scorpion", "Гигантский скорпион", 45, 12, 6, 25, "mobs/scorpion.png"),
            ("sea_serpent", "Морской змей", 70, 18, 8, 45, "mobs/sea_serpent.png"),
            ("mountain_troll", "Горный тролль", 90, 22, 15, 55, "mobs/troll.png"),
            ("dragon_whelp", "Драконий детёныш", 75, 20, 10, 60, "mobs/dragon_whelp.png")
        ]
        cursor.executemany("INSERT INTO mobs VALUES (?,?,?,?,?,?,?)", mobs)

        # Связи мобов с биомами
        mb = [
            ("wolf", "forest"), ("bear", "forest"), ("bear", "taiga"),
            ("giant_scorpion", "desert"), ("sea_serpent", "sea"),
            ("mountain_troll", "mountains"), ("dragon_whelp", "mountains")
        ]
        cursor.executemany("INSERT INTO mob_biomes VALUES (?,?)", mb)

        self.generate_base_map()
        self.conn.commit()

    def generate_base_map(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM map_cells")
        if cursor.fetchone()[0] > 0:
            return

        for x in range(27):
            for y in range(27):
                dist = ((x - 13) ** 2 + (y - 13) ** 2) ** 0.5
                if dist < 3:
                    biome = "forest"
                elif dist < 6:
                    biome = random.choice(["forest", "savanna", "jungle"])
                elif dist < 9:
                    biome = random.choice(["forest", "mountains", "taiga"])
                elif dist < 12:
                    biome = random.choice(["mountains", "desert", "taiga", "beach"])
                elif dist < 15:
                    biome = random.choice(["desert", "beach", "sea"])
                else:
                    biome = random.choice(["ocean", "sea", "desert"])

                passable = 0 if biome in ("sea", "ocean") else 1
                cursor.execute(
                    "INSERT INTO map_cells (x, y, biome_id, passable, description) VALUES (?,?,?,?,?)",
                    (x, y, biome, passable, f"[{x},{y}]")
                )

        settlements_pos = {
            "ksin_daros": (13, 13), "izumrudny_port": (25, 5), "citadel_vechnogo_lda": (4, 24),
            "el_arin": (3, 5), "kamenny_gorn": (20, 8), "ork_tar": (22, 18),
            "tihaya_gavan": (6, 20), "zvezdny_shpil": (15, 3), "gnomiy_mechanism": (10, 22),
            "drakoniy_klyk": (24, 24), "temny_ugol": (2, 14), "svetly_holm": (8, 8)
        }
        for sid, (sx, sy) in settlements_pos.items():
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    nx, ny = sx + dx, sy + dy
                    if 0 <= nx < 27 and 0 <= ny < 27:
                        sid_val = sid if dx == 0 and dy == 0 else None
                        cursor.execute(
                            "UPDATE map_cells SET biome_id='savanna', settlement_id=? WHERE x=? AND y=?",
                            (sid_val, nx, ny)
                        )
        self.conn.commit()

    # ============ МЕТОДЫ ============

    def get_map_cell(self, x, y):
        cursor = self.conn.cursor()
        cursor.execute('''
            SELECT mc.*, b.name as biome_name, b.color_r, b.color_g, b.color_b, b.color_a,
                   b.description as biome_desc, b.movement_cost,
                   s.name as settlement_name, s.type as settlement_type,
                   s.description as settlement_desc, s.icon as settlement_icon, s.services
            FROM map_cells mc
            JOIN biomes b ON mc.biome_id = b.id
            LEFT JOIN settlements s ON mc.settlement_id = s.id
            WHERE mc.x = ? AND mc.y = ?
        ''', (x, y))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_map_size(self):
        return 27

    def get_biome(self, biome_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM biomes WHERE id = ?", (biome_id,))
        row = cursor.fetchone()
        if row:
            return {
                "id": row["id"], "name": row["name"], "icon": row["icon"],
                "color": [row["color_r"], row["color_g"], row["color_b"], row["color_a"]],
                "description": row["description"], "movement_cost": row["movement_cost"],
                "passable_without_boat": bool(row["passable_without_boat"])
            }
        return None

    def get_settlement(self, settlement_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM settlements WHERE id = ?", (settlement_id,))
        row = cursor.fetchone()
        if row:
            return {
                "name": row["name"], "type": row["type"], "race": row["race"],
                "description": row["description"], "icon": row["icon"],
                "services": row["services"].split(",") if row["services"] else []
            }
        return None

    def get_random_event(self, biome_id):
        cursor = self.conn.cursor()
        cursor.execute('''
            SELECT e.* FROM events e
            JOIN event_biomes eb ON e.id = eb.event_id
            WHERE eb.biome_id = ?
        ''', (biome_id,))
        events = [dict(row) for row in cursor.fetchall()]
        for event in events:
            if random.random() < event.get('chance', 0.5):
                return event
        return {"id": "nothing", "name": "Тишина", "type": "nothing"}

    def get_random_mobs(self, biome_id, count=None):
        cursor = self.conn.cursor()
        cursor.execute('''
            SELECT m.* FROM mobs m
            JOIN mob_biomes mb ON m.id = mb.mob_id
            WHERE mb.biome_id = ?
            ORDER BY RANDOM()
            LIMIT ?
        ''', (biome_id, count or random.randint(1, 3)))
        return [dict(row) for row in cursor.fetchall()]

    def get_mob(self, mob_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM mobs WHERE id = ?", (mob_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    # ============ ВРАГИ ============

    def get_enemy(self, enemy_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM enemies WHERE id = ?", (enemy_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_all_enemies(self, biome=None, is_boss=None):
        cursor = self.conn.cursor()
        query = "SELECT * FROM enemies WHERE 1=1"
        params = []
        if biome:
            query += " AND biome = ?"
            params.append(biome)
        if is_boss is not None:
            query += " AND is_boss = ?"
            params.append(1 if is_boss else 0)
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]

    def get_element_resistances(self, element):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM element_resistances WHERE element = ?", (element,))
        return {row['resist_element']: row['value'] for row in cursor.fetchall()}

    # ============ НАВЫКИ И ЗАКЛИНАНИЯ ============

    def get_weapon_skills(self, weapon_type):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM weapon_skills WHERE weapon_type = ?", (weapon_type,))
        return [dict(row) for row in cursor.fetchall()]

    def get_element_spells(self, element):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM element_spells WHERE element = ?", (element,))
        return [dict(row) for row in cursor.fetchall()]

    def get_weapon_skill(self, skill_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM weapon_skills WHERE id = ?", (skill_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_element_spell(self, spell_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM element_spells WHERE id = ?", (spell_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_status_effect(self, effect_id):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM status_effects WHERE id = ?", (effect_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_all_status_effects(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM status_effects")
        return [dict(row) for row in cursor.fetchall()]

    def close(self):
        self.conn.close()


# Глобальный объект БД
db = GameDatabase()