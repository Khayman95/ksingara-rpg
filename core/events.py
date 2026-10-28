import random
from core.player import player
from core.database import db
from core.world_map import world_map
import core.battle as battle_module


class EventSystem:
    """Система обработки событий на карте"""

    BATTLE_CHANCE = 0.3
    EVENT_CHANCE = 0.2

    @classmethod
    def check_cell(cls):
        """Вызывается при каждом шаге по карте"""
        cell = world_map.get_cell(*world_map.player_pos)
        if not cell:
            return {'type': 'nothing', 'data': {'message': 'Здесь ничего нет.'}}

        # Поселение
        settlement = cell.get('settlement')
        if settlement:
            return {
                'type': 'settlement',
                'data': {'settlement': settlement}
            }

        # Случайная встреча
        biome_id = cell.get('biome_id', 'forest')
        roll = random.random()

        if roll < cls.BATTLE_CHANCE:
            return cls._start_battle(biome_id)
        elif roll < cls.BATTLE_CHANCE + cls.EVENT_CHANCE:
            return cls._trigger_event(biome_id)
        else:
            return {
                'type': 'nothing',
                'data': {'message': 'Всё спокойно. Можно двигаться дальше.'}
            }

    @classmethod
    def _start_battle(cls, biome_id):
        """Запускает бой"""
        enemies = db.get_random_mobs(biome_id)
        if enemies:
            enemy_ids = [e['id'] for e in enemies]
            battle = battle_module.start_battle(enemy_ids)
            return {
                'type': 'battle',
                'data': {
                    'enemies': enemy_ids,
                    'message': f"⚔️ На вас напали: {', '.join(e['name'] for e in enemies)}!"
                }
            }
        return {'type': 'nothing', 'data': {'message': 'Врагов поблизости нет.'}}

    @classmethod
    def _trigger_event(cls, biome_id):
        """Вызывает случайное событие"""
        event = world_map.get_random_event()
        if not event:
            return {'type': 'nothing', 'data': {'message': 'Ничего не произошло.'}}

        event_type = event.get('type', 'nothing')
        handlers = {
            'heal': cls._handle_heal,
            'danger': cls._handle_danger,
            'loot': cls._handle_loot,
            'sighting': cls._handle_sighting,
            'dungeon': cls._handle_dungeon,
            'choice': cls._handle_choice,
        }

        handler = handlers.get(event_type, cls._handle_nothing)
        return handler(event)

    @classmethod
    def _handle_heal(cls, event):
        heal_pct = event.get('heal_percent', 20)
        heal_amount = int(player.combat['max_health'] * heal_pct / 100)
        player.combat['current_health'] = min(
            player.combat['current_health'] + heal_amount,
            player.combat['max_health']
        )
        return {
            'type': 'heal',
            'data': {
                'message': f"💚 {event.get('message', 'Ты восстановил силы.')} (+{heal_amount} HP)",
                'heal_amount': heal_amount
            }
        }

    @classmethod
    def _handle_danger(cls, event):
        damage = event.get('damage', 10)
        player.combat['current_health'] -= damage
        message = f"💥 {event.get('message', 'Ты получил урон.')} (-{damage} HP)"

        if player.combat['current_health'] <= 0:
            player.combat['current_health'] = 1
            message += "\n⚠️ Ты едва выжил!"

        return {
            'type': 'danger',
            'data': {'message': message, 'damage': damage}
        }

    @classmethod
    def _handle_loot(cls, event):
        return {
            'type': 'loot',
            'data': {'message': f"🎁 {event.get('message', 'Ты что-то нашёл.')}"}
        }

    @classmethod
    def _handle_sighting(cls, event):
        return {
            'type': 'sighting',
            'data': {'message': f"👀 {event.get('message', 'Ты что-то заметил.')}"}
        }

    @classmethod
    def _handle_dungeon(cls, event):
        return {
            'type': 'dungeon',
            'data': {
                'message': f"🏚️ {event.get('message', 'Ты обнаружил вход в подземелье.')}",
                'dungeon_id': event.get('dungeon_id')
            }
        }

    @classmethod
    def _handle_choice(cls, event):
        return {
            'type': 'choice',
            'data': {
                'message': event.get('message', 'Нужно принять решение.'),
                'choices': event.get('choices', [])
            }
        }

    @classmethod
    def _handle_nothing(cls, event):
        return {
            'type': 'nothing',
            'data': {'message': event.get('message', 'Ничего не произошло.')}
        }

    @classmethod
    def set_chances(cls, battle=None, event=None):
        """Изменяет шансы (для DevMode)"""
        if battle is not None:
            cls.BATTLE_CHANCE = battle
        if event is not None:
            cls.EVENT_CHANCE = event