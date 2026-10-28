from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from game.models import GamePlayer
from core.database import db


class Command(BaseCommand):
    help = 'Создаёт тестовый аккаунт Terstor с прокачанным персонажем'

    def handle(self, *args, **options):
        USERNAME = 'Terstor'
        PASSWORD = 'V@8267473r'

        # ============ 1. СОЗДАЁМ ИЛИ НАХОДИМ USER ============
        user, created = User.objects.get_or_create(username=USERNAME)

        if created:
            user.set_password(PASSWORD)
            user.save()
            self.stdout.write(self.style.SUCCESS(f'✅ Пользователь {USERNAME} создан'))
        else:
            # Обновляем пароль на случай если забыли
            user.set_password(PASSWORD)
            user.save()
            self.stdout.write(self.style.WARNING(f'⚠️ Пользователь {USERNAME} уже существует, пароль обновлён'))

        # ============ 2. СОЗДАЁМ ИЛИ ОБНОВЛЯЕМ 3 СЛОТА ============
        for slot in [1, 2, 3]:
            GamePlayer.objects.get_or_create(
                user=user, slot=slot,
                defaults={'is_empty': True}
            )

        # ============ 3. ЗАПОЛНЯЕМ СЛОТ 1 ПРОКАЧАННЫМ ПЕРСОНАЖОМ ============
        gp = GamePlayer.objects.get(user=user, slot=1)
        gp.is_empty = False
        gp.name = 'Тестовый Герой'
        gp.gender = 'male'
        gp.race = 'human'
        gp.element = 'fire'
        gp.gold = 999999

        # Характеристики
        gp.strength = 50
        gp.agility = 50
        gp.intelligence = 50

        # HP/MP
        gp.max_health = 1000
        gp.current_health = 1000
        gp.max_mana = 500
        gp.current_mana = 500

        # Защита
        gp.armor = 0.2
        gp.energy_shield = 0.2
        gp.dodge = 0.1

        # Оружие (клеймор по умолчанию)
        gp.weapon = {
            'weapon_type': 'claymore',
            'name': 'Клеймор',
            'icon': '⚔️',
            'level': 9,
            'rarity': 'legendary',
            'speed': 2,
            'physical': 2,
            'magic': 2,
        }

        # Владение оружием — все 9 по 100%
        gp.weapon_mastery = {
            'dagger': 100.0,
            'rapier': 100.0,
            'battle_axe': 100.0,
            'crystal_wand': 100.0,
            'whip': 100.0,
            'claymore': 100.0,
            'war_hammer': 100.0,
            'storm_staff': 100.0,
            'dual_blades': 100.0,
        }

        # Навыки оружия — все 27 на 9 уровне
        cursor = db.conn.cursor()
        cursor.execute("SELECT id FROM weapon_skills")
        all_weapon_skills = [row['id'] for row in cursor.fetchall()]

        gp.weapon_skills = {}
        for skill_id in all_weapon_skills:
            gp.weapon_skills[skill_id] = {
                'level': 9,
                'exp': 0,
                'path': None,
            }

        # Заклинания — все 27 на 9 уровне
        cursor.execute("SELECT id FROM element_spells")
        all_spells = [row['id'] for row in cursor.fetchall()]

        gp.element_spells = {}
        for spell_id in all_spells:
            gp.element_spells[spell_id] = {
                'level': 9,
                'exp': 0,
                'path': None,
            }

        # Владение стихией — 100%
        gp.element_mastery = 100.0

        # Благословения
        gp.blessings = {
            'combat': {'level': 9, 'active': True},
            'magic': {'level': 9, 'active': True},
        }

        # Инвентарь — оружие в инвентаре
        gp.inventory = {
            'max_slots': 9,
            'items': [
                {'id': 'dagger', 'quantity': 1},
                {'id': 'rapier', 'quantity': 1},
                {'id': 'battle_axe', 'quantity': 1},
                {'id': 'crystal_wand', 'quantity': 1},
                {'id': 'whip', 'quantity': 1},
                {'id': 'war_hammer', 'quantity': 1},
                {'id': 'storm_staff', 'quantity': 1},
                {'id': 'dual_blades', 'quantity': 1},
                {'id': 'health_potion', 'quantity': 9},
            ]
        }

        # Экипировка
        gp.equipment = {
            'helmet': None, 'armor': None, 'pants': None,
            'gloves_left': None, 'gloves_right': None,
            'boots_left': None, 'boots_right': None,
            'ring_left': None, 'ring_right': None,
            'amulet': None, 'belt': None, 'cloak': None
        }

        # Кодекс
        gp.codex = {
            'monsters': {},
            'quests': {'active': [], 'completed': []},
            'recipes': [],
            'cities_visited': []
        }

        # Позиция (в столице)
        gp.player_x = 13
        gp.player_y = 13
        gp.city_selected = True
        gp.current_screen = 'city'

        gp.save()

        # ============ 4. ОЧИЩАЕМ СЛОТЫ 2 И 3 ============
        for slot in [2, 3]:
            other = GamePlayer.objects.get(user=user, slot=slot)
            other.is_empty = True
            other.name = 'Герой'
            other.race = None
            other.element = None
            other.weapon = None
            other.weapon_skills = {}
            other.element_spells = {}
            other.save()

        # ============ 5. ВЫВОД ============
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('=' * 50))
        self.stdout.write(self.style.SUCCESS('✅ ТЕСТОВЫЙ АККАУНТ ГОТОВ!'))
        self.stdout.write(self.style.SUCCESS('=' * 50))
        self.stdout.write(f'👤 Логин:  {USERNAME}')
        self.stdout.write(f'🔑 Пароль: {PASSWORD}')
        self.stdout.write('')
        self.stdout.write('📋 Персонаж:')
        self.stdout.write(f'   Имя: {gp.name}')
        self.stdout.write(f'   HP: {gp.max_health}')
        self.stdout.write(f'   MP: {gp.max_mana}')
        self.stdout.write(f'   Сила/Лов/Инт: {gp.strength}/{gp.agility}/{gp.intelligence}')
        self.stdout.write(f'   Золото: {gp.gold}')
        self.stdout.write(f'   Навыков оружия: {len(gp.weapon_skills)}')
        self.stdout.write(f'   Заклинаний: {len(gp.element_spells)}')
        self.stdout.write(f'   Стихия: {gp.element}')
        self.stdout.write(f'   Позиция: [{gp.player_x}, {gp.player_y}] — город')
        self.stdout.write('')
        self.stdout.write('🌐 Открой: http://127.0.0.1:8000/login/')
        self.stdout.write(self.style.SUCCESS('=' * 50))