"""
Тестовый скрипт для проверки боевой системы.
Запускается отдельно от Django: python test_battle.py
"""

import os
import sys
import time

# Убеждаемся, что работаем из корня проекта
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from core.player import player
from core.enemy import Enemy
from core.battle import BattleSystem

# ============ ПОДГОТОВКА ИГРОКА ============
print("=" * 50)
print("ПОДГОТОВКА ИГРОКА")
print("=" * 50)

player.name = "Тестовый Герой"
player.element = "fire"
player.stats = {"strength": 10, "agility": 8, "intelligence": 12}
player.calculate_derived_stats()

# Даём оружие
player.weapon = {
    'weapon_type': 'claymore',
    'name': 'Клеймор теней',
    'level': 1,
    'rarity': 'common',
    'speed': 2,
    'physical': 2,
    'magic': 2,
}

# Изучаем навык оружия
player.learn_weapon_skill('claymore_straight')
player.learn_weapon_skill('claymore_rising')

# Изучаем заклинание
player.learn_spell('fire_fist')

print(f"❤️ HP: {player.combat['current_health']}/{player.combat['max_health']}")
print(f"💙 MP: {player.combat['current_mana']}/{player.combat['max_mana']}")
print(f"⚔️ Оружие: {player.weapon['name']}")
print(f"🗡️ Навыки: {list(player.weapon_skills.keys())}")
print(f"✨ Заклинания: {list(player.element_spells.keys())}")

# ============ СОЗДАНИЕ ВРАГОВ ============
print("\n" + "=" * 50)
print("СОЗДАНИЕ ВРАГОВ")
print("=" * 50)

enemies = [
    Enemy('glass_wasp'),
    Enemy('shadow_whisper'),
]

for e in enemies:
    print(f"🐾 {e.name} ({e.element})")
    print(f"   ❤️ {e.hp} HP | ⚔️ {e.damage} | 🛡️ {e.armor * 100:.0f}%")
    print(f"   Способности: {e.weapon_skill['name']}, {e.element_spell['name']}")

# ============ НАЧАЛО БОЯ ============
print("\n" + "=" * 50)
print("НАЧАЛО БОЯ")
print("=" * 50)

battle = BattleSystem(enemies)

for line in battle.log:
    print(line)

# ============ РУЧНОЕ УПРАВЛЕНИЕ ============
print("\n" + "=" * 50)
print("РУЧНОЙ ХОД")
print("=" * 50)

# Игрок использует навык
print("\n--- Игрок использует 'Прямой удар' ---")
result = battle.player_use_skill('claymore_straight')
print(f"Результат: {result}")

for line in battle.log[-3:]:
    print(line)

# Игрок использует заклинание
print("\n--- Игрок использует 'Огненный кулак' ---")
result = battle.player_use_spell('fire_fist')
print(f"Результат: {result}")

for line in battle.log[-3:]:
    print(line)

# ============ АВТОМАТИЧЕСКИЙ БОЙ ============
print("\n" + "=" * 50)
print("АВТОМАТИЧЕСКИЙ БОЙ (симуляция)")
print("=" * 50)

# Симулируем бой — каждый тик 0.5 сек
tick = 0
while not battle.is_over and tick < 100:
    battle.update(0.5)
    tick += 1

    # Каждые 4 тика (2 сек) игрок атакует
    if tick % 4 == 0 and not battle.is_over:
        # Пробуем навык, если кулдаун готов
        result = battle.player_use_skill('claymore_straight')
        if not result['success']:
            # Если не готов — пробуем заклинание
            battle.player_use_spell('fire_fist')

# ============ ИТОГ ============
print("\n" + "=" * 50)
print("ИТОГ БОЯ")
print("=" * 50)

state = battle.get_state()
print(f"Победа: {state['player_won']}")
print(f"Длительность: {state['elapsed']} сек")
print(f"❤️ HP игрока: {state['player']['hp']}/{state['player']['max_hp']}")

print("\n📜 Последние 10 строк лога:")
for line in state['log']:
    print(f"  {line}")

print(f"\n💰 Золото: {player.gold}")

print("\n" + "=" * 50)
print("✅ Проверка завершена!")
print("=" * 50)