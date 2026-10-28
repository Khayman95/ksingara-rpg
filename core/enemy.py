import random
from core.database import db
from core.effects import EffectManager


class Enemy:
    def __init__(self, enemy_id):
        data = db.get_enemy(enemy_id)
        if not data:
            raise ValueError(f"Враг {enemy_id} не найден")

        self.id = data['id']
        self.name = data['name']
        self.icon = data['icon']
        self.category = data['category']
        self.weapon_type = data['weapon_type']

        # Статы
        self.max_hp = data['hp']
        self.hp = data['hp']
        self.damage = data['damage']
        self.armor = data['armor']
        self.energy_shield = data['energy_shield']
        self.dodge = data['dodge']
        self.speed = data['speed']
        self.is_boss = bool(data['is_boss'])

        # Награды
        self.gold_min = data['gold_min']
        self.gold_max = data['gold_max']
        self.exp_reward = data['exp_reward']

        # Случайная стихия
        self.element = random.choice([
            'fire', 'water', 'wind', 'boiling_shadow', 'plasma',
            'ice', 'storm', 'crystal_storm', 'phoenix_blood'
        ])

        # Сопротивления
        self.resistances = db.get_element_resistances(self.element)

        # Способности
        weapon_skills = db.get_weapon_skills(self.weapon_type)
        element_spells = db.get_element_spells(self.element)

        self.weapon_skill = random.choice(weapon_skills) if weapon_skills else None
        self.element_spell = random.choice(element_spells) if element_spells else None

        # Таймер атаки (скорость 1=3сек, 2=2сек, 3=1сек)
        self.attack_timer = 0
        self.attack_cooldown = {
            1: 6.0,
            2: 5.0,
            3: 4.0,
        }.get(self.speed, 5.0)

        # Эффекты
        self.effects = EffectManager(self)

    def take_damage(self, damage, damage_type='physical'):
        """Наносит урон с учётом защиты и сопротивлений"""
        # Уклонение
        if random.random() * 100 < self.dodge:
            return 0, False

        # Снижение урона
        if damage_type == 'physical':
            damage *= (1 - self.armor)
        elif damage_type in self.resistances:
            resist = self.resistances[damage_type]
            damage *= (1 - resist)

        damage = max(1, int(damage))
        self.hp -= damage

        if self.hp <= 0:
            self.hp = 0
            return damage, True
        return damage, False

    def choose_action(self):
        """50/50 между оружием и стихией"""
        if random.random() < 0.5 and self.weapon_skill:
            return {'type': 'weapon', 'skill': self.weapon_skill}
        elif self.element_spell:
            return {'type': 'spell', 'skill': self.element_spell}
        elif self.weapon_skill:
            return {'type': 'weapon', 'skill': self.weapon_skill}
        return None

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'icon': self.icon,
            'hp': self.hp,
            'max_hp': self.max_hp,
            'damage': self.damage,
            'armor': self.armor,
            'energy_shield': self.energy_shield,
            'dodge': self.dodge,
            'speed': self.speed,
            'element': self.element,
            'is_boss': self.is_boss,
            'effects': self.effects.to_dict(),
        }