import random
import time


class StatusEffect:
    def __init__(self, effect_id, name, icon, effect_type, duration,
                 value_per_tick=0, value_percent=0, damage_type=None,
                 tick_interval=1.0, is_positive=False):
        self.id = effect_id
        self.name = name
        self.icon = icon
        self.type = effect_type
        self.duration = duration
        self.remaining = duration
        self.value_per_tick = value_per_tick
        self.value_percent = value_percent
        self.damage_type = damage_type
        self.tick_interval = tick_interval
        self.time_since_tick = 0
        self.is_positive = is_positive

    def update(self, dt):
        """Обновляет таймер эффекта. Возвращает урон за тик (если есть)"""
        self.remaining -= dt

        damage = 0
        if self.type == 'dot':
            self.time_since_tick += dt
            if self.time_since_tick >= self.tick_interval:
                self.time_since_tick -= self.tick_interval
                damage = self.value_per_tick

        return damage

    def is_expired(self):
        return self.remaining <= 0


class EffectManager:
    def __init__(self, owner):
        self.owner = owner
        self.effects = []
        self.immunities = {}  # {effect_id: remaining_time}

    def apply(self, effect_id, duration=None, value_per_tick=0,
              value_percent=0, source_damage=0):
        """Накладывает эффект"""
        from core.database import db

        effect_data = db.get_status_effect(effect_id)
        if not effect_data:
            return False

        # Проверка иммунитета (для стана)
        if effect_id in self.immunities and self.immunities[effect_id] > 0:
            print(f"⚠️ {self.owner.name} имеет иммунитет к {effect_data['name']}")
            return False

        # Проверка на дубликаты
        existing = self.find(effect_id)

        if existing:
            if effect_data['extendable']:
                # Продлеваем до базового (не складываем)
                existing.remaining = max(existing.remaining, effect_data['duration_seconds'])
                print(f"⏱️ {effect_data['name']} продлён до {existing.remaining} сек")
                return True
            else:
                # Нельзя наложить повторно (например, стан уже активен)
                print(f"⚠️ {effect_data['name']} уже активен")
                return False

        # Рассчитываем урон за тик от источника
        if source_damage:
            tick_damage = source_damage * effect_data['value_per_tick_percent'] / 100
        else:
            tick_damage = 0

        # Создаём эффект
        effect = StatusEffect(
            effect_id=effect_id,
            name=effect_data['name'],
            icon=effect_data['icon'],
            effect_type=effect_data['effect_type'],
            duration=duration or effect_data['duration_seconds'],
            value_per_tick=tick_damage,
            value_percent=effect_data['value_percent'],
            damage_type=effect_data['damage_type'],
            tick_interval=effect_data['tick_interval'],
            is_positive=bool(effect_data['is_positive']),
        )

        self.effects.append(effect)
        print(f"✨ {self.owner.name}: наложен эффект {effect.name}")
        return True

    def update(self, dt):
        """Обновляет все эффекты. Возвращает суммарный урон"""
        total_damage = 0

        for effect in self.effects[:]:
            damage = effect.update(dt)
            if damage:
                total_damage += damage

            if effect.is_expired():
                # При окончании стана — даём временный иммунитет
                if effect.type == 'stun':
                    self.immunities['stun'] = 3.0  # 3 секунды иммунитета

                self.effects.remove(effect)
                print(f"❌ {self.owner.name}: эффект {effect.name} закончился")

        # Обновляем иммунитеты
        for immunity_id in list(self.immunities.keys()):
            self.immunities[immunity_id] -= dt
            if self.immunities[immunity_id] <= 0:
                del self.immunities[immunity_id]

        return total_damage

    def find(self, effect_id):
        """Находит эффект по ID"""
        for e in self.effects:
            if e.id == effect_id:
                return e
        return None

    def has(self, effect_id):
        """Проверяет наличие эффекта"""
        return self.find(effect_id) is not None

    def remove_negative(self):
        """Снимает все негативные эффекты (очищение)"""
        removed = []
        for e in self.effects[:]:
            if not e.is_positive:
                removed.append(e.name)
                self.effects.remove(e)
        print(f"🧼 Сняты эффекты: {', '.join(removed)}")
        return removed

    def can_attack(self, attack_type='weapon'):
        """Проверяет, может ли цель атаковать"""
        if self.has('stun'):
            return False  # Полный пропуск хода
        if self.has('immobilize') and attack_type == 'weapon':
            return False  # Оружие заблокировано
        return True

    def get_dodge_bonus(self):
        """Бонус к уклонению"""
        bonus = 0
        for e in self.effects:
            if e.type == 'invisibility' or e.id == 'dodge_buff':
                bonus += e.value_percent
        return bonus

    def get_crit_bonus(self):
        """Бонус к шансу крита от эффектов"""
        bonus = 0
        for e in self.effects:
            if e.id == 'crit_buff':
                bonus += e.value_percent
        return bonus

    def get_attack_bonus(self):
        """Бонус к урону от эффектов"""
        bonus = 0
        for e in self.effects:
            if e.id == 'attack_buff':
                bonus += e.value_percent
        return bonus

    def get_speed_multiplier(self):
        """Множитель скорости"""
        multiplier = 1.0
        for e in self.effects:
            if e.type == 'slow':
                multiplier -= e.value_percent / 100
            elif e.id == 'speed_buff':
                multiplier += e.value_percent / 100
        return max(0.1, multiplier)

    def get_damage_multiplier(self):
        """Множитель получаемого урона"""
        multiplier = 1.0
        for e in self.effects:
            if e.type == 'vulnerability':
                multiplier += e.value_percent / 100
        return multiplier

    def to_dict(self):
        """Для сохранения/отправки на фронт"""
        return [
            {
                'id': e.id,
                'name': e.name,
                'icon': e.icon,
                'remaining': round(e.remaining, 1),
                'duration': e.duration,
                'is_positive': e.is_positive,
            }
            for e in self.effects
        ]