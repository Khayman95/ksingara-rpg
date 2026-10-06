import json
import os
from datetime import datetime
from core.effects import EffectManager


class PlayerData:
    def __init__(self):
        # ============ БАЗОВЫЕ ПАРАМЕТРЫ ============
        self.name = ""
        self.gender = None
        self.race = None
        self.element = None
        self.gold = 100

        # ============ ХАРАКТЕРИСТИКИ ============
        self.stats = {
            "strength": 0,
            "agility": 0,
            "intelligence": 0
        }

        # ============ БОЕВЫЕ ПАРАМЕТРЫ ============
        self.combat = {
            "max_health": 0,
            "current_health": 0,
            "max_mana": 0,
            "current_mana": 0,
            "level": 1,
            "experience": 0,
            "exp_to_next": 100
        }

        # ============ ЗАЩИТА ============
        self.armor = 0.0
        self.energy_shield = 0.0
        self.dodge = 0.0

        # ============ ЭКИПИРОВКА ============
        self.equipment = {
            "helmet": None, "armor": None, "pants": None,
            "gloves_left": None, "gloves_right": None,
            "boots_left": None, "boots_right": None,
            "ring_left": None, "ring_right": None,
            "amulet": None, "belt": None, "cloak": None
        }

        # ============ ОРУЖИЕ (словарь) ============
        self.weapon = None
        self.weapon_mastery = {}  # {weapon_type: percent}
        self.weapon_skills = {}  # {skill_id: {level, exp, path}}

        # ============ СТИХИЯ ============
        self.element_mastery = 0.0
        self.element_spells = {}  # {spell_id: {level, exp, path}}
        self.blessings = {
            "combat": {"level": 0, "active": False},
            "magic": {"level": 0, "active": False}
        }

        # ============ ИНВЕНТАРЬ ============
        self.inventory = {"max_slots": 9, "items": []}

        # ============ ЭФФЕКТЫ ============
        self.effects = EffectManager(self)

        # ============ ПРОЧЕЕ ============
        self.active_slot = None
        self.codex = {
            "monsters": {},
            "quests": {"active": [], "completed": []},
            "recipes": [],
            "cities_visited": []
        }

        self.items_data = {}
        self.load_game_data()

    def load_game_data(self):
        """Загружает JSON-файлы"""
        try:
            with open('data/items.json', 'r', encoding='utf-8') as f:
                self.items_data = {item['id']: item for item in json.load(f)['items']}
        except:
            self.items_data = {}

    # ============ ПРОИЗВОДНЫЕ ============

    def calculate_derived_stats(self):
        """Пересчитывает HP/MP"""
        bonuses = self.get_equipment_bonuses()

        self.combat['max_health'] = 50 + (self.stats['strength'] * 10) + bonuses.get('max_health', 0)
        self.combat['current_health'] = self.combat['max_health']
        self.combat['max_mana'] = 20 + (self.stats['intelligence'] * 5) + bonuses.get('max_mana', 0)
        self.combat['current_mana'] = self.combat['max_mana']

    def get_equipment_bonuses(self):
        """Бонусы от экипировки"""
        bonuses = {
            'strength': 0, 'agility': 0, 'intelligence': 0,
            'armor': 0, 'energy_shield': 0, 'dodge': 0,
            'max_health': 0, 'max_mana': 0,
        }

        for slot, item_id in self.equipment.items():
            if item_id and item_id in self.items_data:
                item_stats = self.items_data[item_id].get('stats', {})
                for key in bonuses:
                    if key in item_stats:
                        bonuses[key] += item_stats[key]

        if self.weapon:
            bonuses['strength'] += self.weapon.get('bonus_strength', 0)
            bonuses['agility'] += self.weapon.get('bonus_agility', 0)
            bonuses['intelligence'] += self.weapon.get('bonus_intelligence', 0)

        return bonuses

    def get_total_defense(self):
        return self.get_equipment_bonuses().get('armor', 0)

    # ============ ОРУЖИЕ ============

    def equip_weapon(self, weapon_data):
        """Надевает оружие (словарь)"""
        can_use, message = self.can_use_weapon(weapon_data)
        if not can_use:
            return False, message

        self.weapon = weapon_data

        weapon_type = weapon_data['weapon_type']
        if weapon_type not in self.weapon_mastery:
            self.weapon_mastery[weapon_type] = 0.0

        return True, "Оружие экипировано"

    def can_use_weapon(self, weapon_data):
        """Проверка требований оружия"""
        weapon_level = weapon_data.get('level', 1)
        weapon_rarity = weapon_data.get('rarity', 'common')
        weapon_type = weapon_data['weapon_type']

        # Максимальная степень среди навыков и заклинаний
        all_levels = []
        for skill in self.weapon_skills.values():
            all_levels.append(skill['level'])
        for spell in self.element_spells.values():
            all_levels.append(spell['level'])

        max_skill_level = max(all_levels) if all_levels else 0

        if weapon_level > max_skill_level:
            return False, f"Нужна степень {weapon_level} в любом навыке/заклинании (у вас {max_skill_level})"

        # Проверка редкости
        mastery = self.weapon_mastery.get(weapon_type, 0.0)
        rarity_req = {'common': 0, 'rare': 30, 'legendary': 70}
        required = rarity_req.get(weapon_rarity, 0)

        if mastery < required:
            return False, f"Нужно {required}% владения (у вас {mastery:.1f}%)"

        return True, "OK"

    # ============ НАВЫКИ И ЗАКЛИНАНИЯ ============

    def learn_weapon_skill(self, skill_id):
        """Изучает навык оружия"""
        if skill_id not in self.weapon_skills:
            self.weapon_skills[skill_id] = {
                'level': 1,
                'exp': 0,
                'path': None
            }
            return True
        return False

    def learn_spell(self, spell_id):
        """Изучает заклинание"""
        if spell_id not in self.element_spells:
            self.element_spells[spell_id] = {
                'level': 1,
                'exp': 0,
                'path': None
            }
            return True
        return False

    def get_skill_level(self, skill_id):
        if skill_id in self.weapon_skills:
            return self.weapon_skills[skill_id]['level']
        return 0

    def get_spell_level(self, spell_id):
        if spell_id in self.element_spells:
            return self.element_spells[spell_id]['level']
        return 0

    def add_skill_exp(self, skill_id, exp_amount):
        """Добавляет опыт навыку"""
        if skill_id not in self.weapon_skills:
            self.learn_weapon_skill(skill_id)

        skill = self.weapon_skills[skill_id]
        skill['exp'] += exp_amount

        exp_to_next = skill['level'] * 100
        while skill['exp'] >= exp_to_next and skill['level'] < 9:
            skill['exp'] -= exp_to_next
            skill['level'] += 1
            exp_to_next = skill['level'] * 100
            print(f"🎉 Навык {skill_id} → уровень {skill['level']}")

    def add_spell_exp(self, spell_id, exp_amount):
        """Добавляет опыт заклинанию"""
        if spell_id not in self.element_spells:
            self.learn_spell(spell_id)

        spell = self.element_spells[spell_id]
        spell['exp'] += exp_amount

        exp_to_next = spell['level'] * 100
        while spell['exp'] >= exp_to_next and spell['level'] < 9:
            spell['exp'] -= exp_to_next
            spell['level'] += 1
            exp_to_next = spell['level'] * 100
            print(f"🎉 Заклинание {spell_id} → уровень {spell['level']}")

    # ============ ИНВЕНТАРЬ ============

    def add_to_inventory(self, item_id, quantity=1):
        for item in self.inventory['items']:
            if isinstance(item, dict) and item.get('id') == item_id:
                item['quantity'] = item.get('quantity', 1) + quantity
                return True

        if len(self.inventory['items']) < self.inventory['max_slots']:
            self.inventory['items'].append({'id': item_id, 'quantity': quantity})
            return True
        return False

    def remove_from_inventory(self, item_id, quantity=1):
        for item in self.inventory['items'][:]:
            if isinstance(item, dict) and item.get('id') == item_id:
                item['quantity'] = item.get('quantity', 1) - quantity
                if item['quantity'] <= 0:
                    self.inventory['items'].remove(item)
                return True
        return False

    def has_item(self, item_id):
        for item in self.inventory['items']:
            if isinstance(item, dict) and item.get('id') == item_id:
                return True
        return False

    # ============ ЭКИПИРОВКА ============

    def equip_item(self, item_id, slot=None):
        if item_id not in self.items_data:
            return False

        item = self.items_data[item_id]
        slot = slot or item.get('slot')

        if slot and slot in self.equipment:
            old = self.equipment[slot]
            if old:
                self.add_to_inventory(old)

            self.equipment[slot] = item_id
            self.remove_from_inventory(item_id)
            self.calculate_derived_stats()
            return True
        return False

    def unequip_item(self, slot):
        if slot in self.equipment and self.equipment[slot]:
            if self.add_to_inventory(self.equipment[slot]):
                self.equipment[slot] = None
                self.calculate_derived_stats()
                return True
        return False

    # ============ СИЛА ИГРОКА ============

    def calculate_power_level(self):
        """Сила игрока для скалирования врагов"""
        weapon_levels = [s['level'] for s in self.weapon_skills.values()]
        avg_weapon = sum(weapon_levels) / len(weapon_levels) if weapon_levels else 0

        spell_levels = [s['level'] for s in self.element_spells.values()]
        avg_spell = sum(spell_levels) / len(spell_levels) if spell_levels else 0

        avg_skill = (avg_weapon + avg_spell) / 2 if (weapon_levels or spell_levels) else 1

        avg_stats = (self.stats['strength'] + self.stats['agility'] + self.stats['intelligence']) / 3
        defense = self.get_total_defense()

        power = (avg_skill * 0.5) + (avg_stats * 0.3) + (defense * 0.2)
        return max(1.0, power)

    # ============ СОХРАНЕНИЕ ============

    def save_to_file(self, slot=1, current_screen='map'):
        """Сохраняет игру"""
        self.active_slot = slot
        filename = f"savegame_{slot}.json"

        data = {
            "slot": slot,
            "timestamp": datetime.now().strftime("%d.%m.%Y %H:%M"),
            "name": self.name,
            "gender": self.gender,
            "race": self.race,
            "element": self.element,
            "gold": self.gold,
            "stats": self.stats,
            "combat": self.combat,
            "armor": self.armor,
            "energy_shield": self.energy_shield,
            "dodge": self.dodge,
            "equipment": self.equipment,
            "weapon": self.weapon,
            "weapon_mastery": self.weapon_mastery,
            "weapon_skills": self.weapon_skills,
            "element_mastery": self.element_mastery,
            "element_spells": self.element_spells,
            "blessings": self.blessings,
            "inventory": self.inventory,
            "codex": self.codex,
            "current_screen": current_screen,
        }

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"💾 Сохранено в слот {slot} (экран: {current_screen})")

    def load_from_file(self, slot=1):
        """Загружает игру"""
        self.active_slot = slot
        filename = f"savegame_{slot}.json"

        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.name = data.get("name", "")
            self.gender = data.get("gender")
            self.race = data.get("race")
            self.element = data.get("element")
            self.gold = data.get("gold", 100)
            self.stats = data.get("stats", {"strength": 0, "agility": 0, "intelligence": 0})
            self.combat = data.get("combat", {})
            self.armor = data.get("armor", 0.0)
            self.energy_shield = data.get("energy_shield", 0.0)
            self.dodge = data.get("dodge", 0.0)
            self.equipment = data.get("equipment", {})
            self.weapon = data.get("weapon")
            self.weapon_mastery = data.get("weapon_mastery", {})
            self.weapon_skills = data.get("weapon_skills", {})
            self.element_mastery = data.get("element_mastery", 0.0)
            self.element_spells = data.get("element_spells", {})
            self.blessings = data.get("blessings", {"combat": {"level": 0}, "magic": {"level": 0}})
            self.inventory = data.get("inventory", {"max_slots": 9, "items": []})
            self.codex = data.get("codex", {"monsters": {}, "quests": {"active": [], "completed": []}, "recipes": [],
                                            "cities_visited": []})

            self._loaded_screen = data.get("current_screen", 'map')

            print(f"📂 Загружено из слота {slot}")
            return True
        except Exception as e:
            print(f"❌ Ошибка загрузки: {e}")
            return False

    def has_save(self, slot=1):
        return os.path.exists(f"savegame_{slot}.json")

    def get_save_info(self, slot=1):
        filename = f"savegame_{slot}.json"
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return {
                "exists": True,
                "name": data.get("name", "???"),
                "race": data.get("race", "???"),
                "element": data.get("element", "???"),
                "level": data.get("combat", {}).get("level", 1),
                "timestamp": data.get("timestamp", "Неизвестно")
            }
        except:
            return {"exists": False}

    def delete_save(self, slot=1):
        filename = f"savegame_{slot}.json"
        if os.path.exists(filename):
            os.remove(filename)
            return True
        return False


# Глобальный объект игрока
player = PlayerData()