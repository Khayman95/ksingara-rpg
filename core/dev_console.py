from core.player import player
from core.world_map import world_map


class DevConsole:
    """Режим разработчика"""
    enabled = False

    @classmethod
    def toggle(cls, password):
        """Включает/выключает DevMode"""
        if password == "ksingara_dev_2026":
            cls.enabled = not cls.enabled
            if cls.enabled:
                print("🛠️ DEV MODE ВКЛЮЧЕН")
                player.gold = 999999
            else:
                print("🛠️ DEV MODE ВЫКЛЮЧЕН")
            return True, cls.enabled
        return False, False

    @classmethod
    def max_stats(cls):
        if cls.enabled:
            player.stats = {"strength": 99, "agility": 99, "intelligence": 99}
            player.calculate_derived_stats()
            print("💪 Статы → 99")

    @classmethod
    def heal(cls):
        if cls.enabled:
            player.combat['current_health'] = player.combat['max_health']
            player.combat['current_mana'] = player.combat['max_mana']
            print("❤️ Полное восстановление")

    @classmethod
    def teleport(cls, x, y):
        if cls.enabled:
            world_map.player_pos = [x, y]
            print(f"🗺️ Телепорт в [{x},{y}]")

    @classmethod
    def unlock_all_skills(cls):
        if cls.enabled:
            # Заглушка
            print("📖 Все навыки изучены (заглушка)")

    @classmethod
    def give_gold(cls, amount=10000):
        if cls.enabled:
            player.gold += amount
            print(f"💰 +{amount} золота")