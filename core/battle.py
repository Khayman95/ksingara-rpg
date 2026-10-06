import random
import time
from core.player import player
from core.enemy import Enemy
from core.database import db


class BattleSystem:
    def __init__(self, enemies):
        self.player = player
        self.enemies = enemies  # Список объектов Enemy
        self.target_index = 0  # Текущая цель
        self.log = []
        self.is_over = False
        self.player_won = False
        self.start_time = time.time()
        self.elapsed = 0

        # Статистика для награды
        self.skills_used = {}  # {skill_id: count}
        self.weapon_hits = 0

        # Кулдауны игрока
        self.player_cooldowns = {}  # {skill_id: remaining}

        self.add_log(f"⚔️ Бой начался! Врагов: {len(enemies)}")
        for e in enemies:
            self.add_log(f"  • {e.icon} {e.name} ({e.element}) — ❤️{e.hp}")

    def add_log(self, message):
        """Добавляет сообщение в лог боя"""
        self.log.append(message)
        # Ограничиваем лог 50 сообщениями
        if len(self.log) > 50:
            self.log = self.log[-50:]

    # ============ ОБНОВЛЕНИЕ БОЯ ============

    def update(self, dt):
        """Вызывается каждые 0.1 сек"""
        if self.is_over:
            return

        self.elapsed += dt

        # 1. Обновляем эффекты игрока
        player_dot = self.player.effects.update(dt)
        if player_dot > 0:
            self.player.combat['current_health'] -= player_dot
            self.add_log(f"🩸 Ты получил {int(player_dot)} урона от эффектов")
            if self.player.combat['current_health'] <= 0:
                self._end_battle(False)
                return

        # 2. Обновляем кулдауны игрока
        for skill_id in list(self.player_cooldowns.keys()):
            self.player_cooldowns[skill_id] -= dt
            if self.player_cooldowns[skill_id] <= 0:
                del self.player_cooldowns[skill_id]

        # 3. Обновляем эффекты и атаки врагов
        for enemy in self.enemies:
            if enemy.hp <= 0:
                continue

            # DOT врага
            enemy_dot = enemy.effects.update(dt)
            if enemy_dot > 0:
                damage, killed = enemy.take_damage(enemy_dot, is_dot=True)
                self.add_log(f"🩸 {enemy.name} получил {int(damage)} урона")
                if killed:
                    self.add_log(f"💀 {enemy.name} погиб от эффекта!")
                    continue

            # Получаем действие заранее (для расчёта кулдауна)
            action = enemy.choose_action()
            if not action:
                continue

            skill = action['skill']
            cooldown = enemy.attack_cooldown * skill['cooldown_multiplier']

            # Обновляем таймер
            speed_mult = enemy.effects.get_speed_multiplier()
            enemy.attack_timer += dt * speed_mult

            if enemy.attack_timer >= cooldown:
                enemy.attack_timer = 0
                self._enemy_attack(enemy, action)

                if self.player.combat['current_health'] <= 0:
                    self._end_battle(False)
                    return

        # 4. Проверка победы
        alive = [e for e in self.enemies if e.hp > 0]
        if not alive:
            self._end_battle(True)

    # ============ АТАКА ИГРОКА ============

    def player_use_skill(self, skill_id):
        """Игрок использует навык оружия"""
        if self.is_over:
            return {'success': False, 'message': 'Бой окончен'}

        # Проверка контроля
        if not self.player.effects.can_attack('weapon'):
            return {'success': False, 'message': 'Вы не можете атаковать оружием!'}

        # Проверка кулдауна
        if skill_id in self.player_cooldowns:
            return {'success': False, 'message': f'Кулдаун: {self.player_cooldowns[skill_id]:.1f} сек'}

        # Получаем навык
        skill = db.get_weapon_skill(skill_id)
        if not skill:
            return {'success': False, 'message': 'Навык не найден'}

        # Проверка маны
        mana_cost = skill['mana_cost']
        if self.player.combat['current_mana'] < mana_cost:
            return {'success': False, 'message': 'Недостаточно маны'}

        self.player.combat['current_mana'] -= mana_cost

        # Кулдаун = скорость оружия × модификатор
        weapon_speed = self.player.weapon['speed'] if self.player.weapon else 2
        cooldown = weapon_speed * skill['cooldown_multiplier']
        self.player_cooldowns[skill_id] = cooldown

        # Выбираем цель
        target = self._get_current_target()
        if not target:
            return {'success': False, 'message': 'Нет живой цели'}

        # Расчёт урона
        damage = self._calculate_weapon_damage(skill)

        # Учёт сопротивлений врага
        final_damage, killed = target.take_damage(damage, 'physical')

        if final_damage == 0:
            self.add_log(f"💨 {target.name} уклонился от {skill['name']}!")
            return {'success': True, 'message': 'Уклонение!'}

        # Крит
        is_crit = random.random() * 100 < self._get_crit_chance(skill)
        if is_crit:
            final_damage *= 2

        self.add_log(f"⚔️ {skill['name']} → {target.name}: -{int(final_damage)} HP" + (" (КРИТ!)" if is_crit else ""))

        # Статистика
        self.skills_used[skill_id] = self.skills_used.get(skill_id, 0) + 1
        self.weapon_hits += 1

        # Накладываем эффекты навыка
        self._apply_skill_effects(skill, target, final_damage)

        # Прерываем невидимость
        if self.player.effects.has('invisibility'):
            self.player.effects.remove('invisibility')
            self.add_log("👻 Невидимость прервана!")

        if killed:
            self.add_log(f"💀 {target.name} повержен!")

        return {'success': True, 'damage': int(final_damage), 'is_crit': is_crit}

    def player_use_spell(self, spell_id):
        """Игрок использует заклинание"""
        if self.is_over:
            return {'success': False, 'message': 'Бой окончен'}

        # Проверка контроля
        if not self.player.effects.can_attack('spell'):
            return {'success': False, 'message': 'Вы не можете колдовать!'}

        # Проверка кулдауна
        if spell_id in self.player_cooldowns:
            return {'success': False, 'message': f'Кулдаун: {self.player_cooldowns[spell_id]:.1f} сек'}

        spell = db.get_element_spell(spell_id)
        if not spell:
            return {'success': False, 'message': 'Заклинание не найдено'}

        # Проверка маны
        mana_cost = spell['mana_cost']
        if self.player.combat['current_mana'] < mana_cost:
            return {'success': False, 'message': 'Недостаточно маны'}

        self.player.combat['current_mana'] -= mana_cost

        # Кулдаун
        weapon_speed = self.player.weapon['speed'] if self.player.weapon else 2
        cooldown = weapon_speed * spell['cooldown_multiplier']
        self.player_cooldowns[spell_id] = cooldown

        # Цели
        targets = self._get_spell_targets(spell['target_type'])
        if not targets:
            return {'success': False, 'message': 'Нет живых целей'}

        # Урон по каждой цели
        for target in targets:
            damage = self._calculate_spell_damage(spell)
            final_damage, killed = target.take_damage(damage, self.player.element)

            if final_damage == 0:
                self.add_log(f"💨 {target.name} уклонился!")
                continue

            self.add_log(f"✨ {spell['name']} → {target.name}: -{int(final_damage)} HP")

            # Эффекты
            self._apply_spell_effects(spell, target, final_damage)

            if killed:
                self.add_log(f"💀 {target.name} повержен!")

        self.skills_used[spell_id] = self.skills_used.get(spell_id, 0) + 1

        return {'success': True}

    # ============ АТАКА ВРАГА ============

    def _enemy_attack(self, enemy, action=None):
        """Враг атакует (action передаётся из update)"""
        # Проверка контроля врага
        if not enemy.effects.can_attack('weapon'):
            self.add_log(f"⏸️ {enemy.name} не может атаковать!")
            return

        if not action:
            action = enemy.choose_action()
            if not action:
                return

        skill = action['skill']

        # Расчёт урона со штрафом −50%
        base_damage = skill['base_damage'] + enemy.damage
        final_damage = int(base_damage * 0.5)

        # Уклонение игрока
        dodge = self.player.dodge + self.player.effects.get_dodge_bonus()
        if random.random() * 100 < dodge:
            self.add_log(f"💨 Ты уклонился от {enemy.name}!")
            return

        final_damage *= self.player.effects.get_damage_multiplier()

        if action['type'] == 'weapon':
            final_damage *= (1 - self.player.armor)
        else:
            final_damage *= (1 - self.player.energy_shield)

        final_damage = max(1, int(final_damage))
        self.player.combat['current_health'] -= final_damage
        self.add_log(f"🗡️ {enemy.name} → {skill['name']}: -{final_damage} HP")

        # Уклонение игрока (с бонусом невидимости)
        dodge = self.player.dodge + self.player.effects.get_dodge_bonus()
        if random.random() * 100 < dodge:
            self.add_log(f"💨 Ты уклонился от {enemy.name}!")
            return

        # Урон с учётом множителей
        final_damage *= self.player.effects.get_damage_multiplier()

        # Снижение от брони/щита
        if action['type'] == 'weapon':
            final_damage *= (1 - self.player.armor)
        else:
            final_damage *= (1 - self.player.energy_shield)

        final_damage = max(1, int(final_damage))
        self.player.combat['current_health'] -= final_damage
        self.add_log(f"🗡️ {enemy.name} → {skill['name']}: -{final_damage} HP")

    # ============ ВСПОМОГАТЕЛЬНЫЕ ============

    def _get_current_target(self):
        """Возвращает текущую живую цель"""
        alive = [e for e in self.enemies if e.hp > 0]
        if not alive:
            return None
        if self.target_index >= len(self.enemies) or self.enemies[self.target_index].hp <= 0:
            self.target_index = 0
            for i, e in enumerate(self.enemies):
                if e.hp > 0:
                    self.target_index = i
                    break
        return self.enemies[self.target_index]

    def _get_spell_targets(self, target_type):
        """Возвращает цели заклинания"""
        alive = [e for e in self.enemies if e.hp > 0]
        if target_type == 'all':
            return alive
        elif target_type == 'single':
            t = self._get_current_target()
            return [t] if t else []
        elif target_type == 'chain':
            # 2-3 цели
            return alive[:3]
        return alive[:1]

    def _calculate_weapon_damage(self, skill):
        """Расчёт физического урона"""
        base = skill['base_damage']
        level = self.player.get_skill_level(skill['id'])
        per_level = skill['damage_per_level']

        # Множитель физ. урона оружия
        phys_mult = {0: 0.0, 1: 0.8, 2: 1.0, 3: 1.3}.get(self.player.weapon['physical'], 1.0)

        damage = (base + (level - 1) * per_level) * phys_mult
        damage += self.player.stats['strength'] * 1.5

        return int(damage)

    def _calculate_spell_damage(self, spell):
        """Расчёт магического урона"""
        base = spell['base_damage']
        level = self.player.get_spell_level(spell['id'])
        per_level = spell['damage_per_level']

        # Множитель проводимости оружия
        magic_mult = {0: 0.0, 1: 0.7, 2: 1.0, 3: 1.3}.get(self.player.weapon['magic'], 1.0)

        damage = (base + (level - 1) * per_level) * magic_mult
        damage += self.player.stats['intelligence'] * 1.5

        return int(damage)

    def _get_crit_chance(self, skill):
        """Шанс крита"""
        base = 10  # 10% базовый
        # + бонусы от навыков/эффектов
        return base + self.player.effects.get_crit_bonus()

    def _apply_skill_effects(self, skill, target, damage):
        """Накладывает эффекты навыка"""
        # Проверяем, есть ли эффект у навыка
        # (Например, от пути развития)
        pass

    def _apply_spell_effects(self, spell, target, damage):
        """Накладывает эффекты заклинания"""
        pass

    # ============ КОНЕЦ БОЯ ============

    def _end_battle(self, player_won):
        """Завершает бой"""
        self.is_over = True
        self.player_won = player_won

        if player_won:
            self.add_log("🎉 ПОБЕДА!")
            self._give_rewards()
        else:
            self.add_log("💀 ПОРАЖЕНИЕ...")
            self._handle_defeat()

    def _give_rewards(self):
        """Выдаёт награду за победу"""
        # Золото
        total_gold = sum(random.randint(e.gold_min, e.gold_max) for e in self.enemies)
        self.player.gold += total_gold
        self.add_log(f"💰 Получено золота: {total_gold}")

        # Опыт — распределяем между использованными навыками
        total_exp = sum(e.exp_reward for e in self.enemies)
        self._distribute_exp(total_exp)

        # % владения оружием
        if self.player.weapon:
            weapon_type = self.player.weapon['weapon_type']
            mastery_gain = 0.001 * self.weapon_hits

            # Инициализируем если нет
            if weapon_type not in self.player.weapon_mastery:
                self.player.weapon_mastery[weapon_type] = 0.0

            old_mastery = self.player.weapon_mastery[weapon_type]
            self.player.weapon_mastery[weapon_type] = min(100.0, old_mastery + mastery_gain)
            new_mastery = self.player.weapon_mastery[weapon_type]

            self.add_log(f"📈 Владение {weapon_type}: {old_mastery:.3f}% → {new_mastery:.3f}%")

    def _distribute_exp(self, total_exp):
        """Распределяет опыт между использованными навыками"""
        if not self.skills_used:
            return

        total_uses = sum(self.skills_used.values())
        for skill_id, count in self.skills_used.items():
            exp_share = int(total_exp * (count / total_uses))
            self.player.add_skill_exp(skill_id, exp_share)
            self.add_log(f"⭐ {skill_id}: +{exp_share} опыта")

    def _handle_defeat(self):
        """Обработка поражения"""
        # Возрождение в городе с 1 HP
        self.player.combat['current_health'] = 1
        self.add_log("🏥 Ты возрождён в городе с 1 HP")

    def try_escape(self):
        """Попытка сбежать"""
        escape_chance = self.player.stats['agility'] * 2
        if random.random() * 100 < escape_chance:
            self.is_over = True
            self.add_log("🏃 Ты сбежал из боя!")
            return True
        else:
            self.add_log("❌ Не удалось сбежать! Кулдаун 10 сек")
            return False

    # ============ СОСТОЯНИЕ ============

    def get_state(self):
        """Возвращает состояние боя для фронтенда"""
        return {
            'player': {
                'hp': self.player.combat['current_health'],
                'max_hp': self.player.combat['max_health'],
                'mp': self.player.combat['current_mana'],
                'max_mp': self.player.combat['max_mana'],
                'effects': self.player.effects.to_dict(),
                'cooldowns': {k: round(v, 1) for k, v in self.player_cooldowns.items()},
            },
            'enemies': [
                {
                    **e.to_dict(),
                    'is_target': i == self.target_index,
                }
                for i, e in enumerate(self.enemies)
            ],
            'log': self.log[-10:],
            'is_over': self.is_over,
            'player_won': self.player_won,
            'elapsed': round(self.elapsed, 1),
        }

    def select_target(self, index):
        """Выбор цели"""
        if 0 <= index < len(self.enemies) and self.enemies[index].hp > 0:
            self.target_index = index
            self.add_log(f"🎯 Цель: {self.enemies[index].name}")

current_battle = None

def start_battle(enemies_ids):
    """Начинает бой с врагами по ID"""
    global current_battle
    enemies = [Enemy(eid) for eid in enemies_ids]
    current_battle = BattleSystem(enemies)
    return current_battle
