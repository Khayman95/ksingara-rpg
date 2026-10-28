from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.shortcuts import render
from .db_utils import get_db_connection
from .models import Player
from datetime import datetime
from core.battle import current_battle, start_battle
import core.battle as battle_module
import json
import random
from datetime import date, datetime
import re
from django.contrib.auth import authenticate, login, logout
from django.shortcuts import redirect, render
from .models import GamePlayer
from django.views.decorators.csrf import ensure_csrf_cookie
from core.time_system import game_clock

def api_status(request):
    """Проверка, что сервер работает"""
    return JsonResponse({
        'status': 'ok',
        'message': 'Ксингар API работает'
    })

@csrf_exempt
def api_new_game(request):
    """Создать нового персонажа"""
    if request.method == 'POST':
        data = json.loads(request.body)

        # Пока сохраняем в сессию (потом в БД)
        request.session['character'] = {
            'name': data.get('name', 'Герой'),
            'gender': data.get('gender'),
            'race': data.get('race', {}).get('id'),
            'element': data.get('element', {}).get('id'),
            'strength': data.get('stats', {}).get('strength', 5),
            'agility': data.get('stats', {}).get('agility', 5),
            'intelligence': data.get('stats', {}).get('intelligence', 5),
        }
        request.session.save()

        return JsonResponse({
            'success': True,
            'player_id': 1,
            'player_name': data.get('name', 'Герой'),
            'message': 'Персонаж создан!'
        })


def load_active_player(request):
    """Загружает активного игрока из БД"""
    from core.player import player as p
    from core.world_map import world_map
    from .models import GamePlayer
    from .db_utils import get_db_connection

    if not request.user.is_authenticated:
        return None

    player_id = request.session.get('active_player_id')
    if not player_id:
        return None

    try:
        gp = GamePlayer.objects.get(id=player_id, user=request.user)
    except GamePlayer.DoesNotExist:
        return None

    if gp.is_empty:
        return None

    # Загружаем ВСЁ в player
    p.name = gp.name
    p.gender = gp.gender
    p.race = gp.race
    p.element = gp.element
    p.gold = gp.gold
    p.stats = {
        'strength': gp.strength,
        'agility': gp.agility,
        'intelligence': gp.intelligence,
    }
    p.combat = {
        'max_health': gp.max_health,
        'current_health': gp.current_health,
        'max_mana': gp.max_mana,
        'current_mana': gp.current_mana,
    }
    p.armor = gp.armor
    p.energy_shield = gp.energy_shield
    p.dodge = gp.dodge
    p.weapon = gp.weapon
    p.weapon_mastery = gp.weapon_mastery or {}
    p.weapon_skills = gp.weapon_skills or {}
    p.element_mastery = gp.element_mastery
    p.element_spells = gp.element_spells or {}
    p.blessings = gp.blessings or {'combat': {'level': 0}, 'magic': {'level': 0}}
    p.inventory = gp.inventory or {'max_slots': 9, 'items': []}
    p.equipment = gp.equipment or {}
    p.codex = gp.codex or {}

    world_map.player_pos = [gp.player_x, gp.player_y]
    world_map.city_selected = gp.city_selected

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM merchant_items")
    items_data = {}
    for row in cursor.fetchall():
        row_dict = dict(row)
        items_data[row_dict['id']] = {
            'id': row_dict['id'],
            'name': row_dict['name'],
            'icon': row_dict['icon'],
            'description': row_dict.get('description', ''),
            'slot': row_dict.get('slot'),
        }
    # ✅ ДОБАВЛЯЕМ ОРУЖИЕ
    cursor.execute("SELECT * FROM weapons")
    for row in cursor.fetchall():
        row_dict = dict(row)
        items_data[row_dict['id']] = {
            'id': row_dict['id'],
            'name': row_dict['name'],
            'icon': row_dict['icon'],
            'description': row_dict.get('description', ''),
            'slot': 'weapon',
            'category': 'weapon',
        }

    conn.close()
    p.items_data = items_data

    return gp

def api_player_stats(request):
    from core.player import player

    gp = load_active_player(request)

    if not gp:
        return JsonResponse({'success': False, 'message': 'Персонаж не активен'})

    # Загружаем items_data из БД
    from .db_utils import get_db_connection
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM merchant_items")
    items_data = {}
    for row in cursor.fetchall():
        items_data[row['id']] = {
            'id': row['id'],
            'name': row['name'],
            'icon': row['icon'],
            'description': row['description'],
        }
    conn.close()

    return JsonResponse({
        'success': True,
        'name': player.name or 'Герой',
        'race': player.race or 'human',
        'element': player.element or 'fire',
        'gender': player.gender,
        'gold': player.gold,
        'hp': player.combat.get('current_health', 0),
        'max_hp': player.combat.get('max_health', 0),
        'mp': player.combat.get('current_mana', 0),
        'max_mp': player.combat.get('max_mana', 0),
        'strength': player.stats['strength'],
        'agility': player.stats['agility'],
        'intelligence': player.stats['intelligence'],
        'armor': player.armor,
        'energy_shield': player.energy_shield,
        'dodge': player.dodge,
        'weapon': player.weapon,
        'weapon_mastery': player.weapon_mastery,
        'weapon_skills': player.weapon_skills,
        'element_spells': player.element_spells,
        'equipment': player.equipment,
        'inventory': player.inventory,
        'items_data': player.items_data,
    })

def register_view(request):
    """Регистрация"""
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        password2 = request.POST.get('password2', '')

        # Валидация логина
        if not username or len(username) < 3:
            return render(request, 'register.html', {
                'error': 'Логин должен быть минимум 3 символа',
                'username': username,
            })

        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            return render(request, 'register.html', {
                'error': 'Логин может содержать только буквы, цифры и _',
                'username': username,
            })

        if User.objects.filter(username=username).exists():
            return render(request, 'register.html', {
                'error': 'Такой логин уже занят',
                'username': username,
            })

        # Валидация пароля
        if len(password) < 8:
            return render(request, 'register.html', {
                'error': 'Пароль минимум 8 символов',
                'username': username,
            })
        if not re.search(r'[A-Z]', password):
            return render(request, 'register.html', {
                'error': 'Пароль должен содержать заглавную букву',
                'username': username,
            })
        if not re.search(r'[a-z]', password):
            return render(request, 'register.html', {
                'error': 'Пароль должен содержать строчную букву',
                'username': username,
            })
        if not re.search(r'[0-9]', password):
            return render(request, 'register.html', {
                'error': 'Пароль должен содержать цифру',
                'username': username,
            })
        if not re.search(r'[!@#$%^&*(),.?":{}|<>_\-+=]', password):
            return render(request, 'register.html', {
                'error': 'Пароль должен содержать спецсимвол',
                'username': username,
            })

        if password != password2:
            return render(request, 'register.html', {
                'error': 'Пароли не совпадают',
                'username': username,
            })

        # Создаём User + 3 пустых слота
        user = User.objects.create_user(username=username, password=password)

        for slot in [1, 2, 3]:
            GamePlayer.objects.create(user=user, slot=slot, is_empty=True)

        # Логиним
        login(request, user)

        # Перенаправляем в главное меню
        return redirect('/')

    return render(request, 'register.html')

def login_view(request):
    """Вход"""
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)
            # Всегда в главное меню (там решим что делать)
            return redirect('/')
        else:
            return render(request, 'login.html', {
                'error': 'Неверный логин или пароль',
            })

    return render(request, 'login.html')


def logout_view(request):
    """Выход"""
    logout(request)
    return redirect('/')

def api_map_data(request):
    """Возвращает данные карты из базы"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT mc.x, mc.y, mc.biome_id, mc.passable, mc.settlement_id,
                   b.name as biome_name, b.color_r, b.color_g, b.color_b,
                   s.name as settlement_name, s.type as settlement_type
            FROM map_cells mc
            JOIN biomes b ON mc.biome_id = b.id
            LEFT JOIN settlements s ON mc.settlement_id = s.id
            ORDER BY mc.x, mc.y
        ''')
        rows = cursor.fetchall()
        conn.close()

        cells = {}
        for row in rows:
            key = f"{row['x']},{row['y']}"
            cells[key] = {
                'biome': row['biome_id'],
                'biome_name': row['biome_name'],
                'color': f"rgb({int(row['color_r'] * 255)},{int(row['color_g'] * 255)},{int(row['color_b'] * 255)})",
                'passable': bool(row['passable']),
                'settlement_name': row['settlement_name'],
                'settlement_type': row['settlement_type'],
                'settlement_id': row['settlement_id'],  # ← ДОБАВЛЕНО
            }

        return JsonResponse({
            'map_size': 27,
            'cells': cells,
        })
    except Exception as e:
        return JsonResponse({
            'map_size': 27,
            'cells': {},
            'error': str(e)
        })

def api_create_player(request):
    """Создаёт персонажа в выбранном слоте"""
    from .models import GamePlayer

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    if request.method == 'POST':
        data = json.loads(request.body)
        slot = int(data.get('slot', 1))

        try:
            game_player = GamePlayer.objects.get(user=request.user, slot=slot)
        except GamePlayer.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Слот не найден'})

        if not game_player.is_empty:
            return JsonResponse({'success': False, 'message': 'Слот занят'})

        # Заполняем данными
        game_player.is_empty = False
        game_player.name = data.get('name', 'Герой')
        game_player.gender = data.get('gender')
        game_player.race = data.get('race')
        game_player.element = data.get('element')

        # Статы
        stats = data.get('stats', {})
        game_player.strength = stats.get('strength', 5)
        game_player.agility = stats.get('agility', 5)
        game_player.intelligence = stats.get('intelligence', 5)

        # HP/MP
        from core.player import player as temp_player
        temp_player.stats = {
            'strength': game_player.strength,
            'agility': game_player.agility,
            'intelligence': game_player.intelligence,
        }
        temp_player.calculate_derived_stats()

        game_player.max_health = temp_player.combat['max_health']
        game_player.current_health = temp_player.combat['max_health']
        game_player.max_mana = temp_player.combat['max_mana']
        game_player.current_mana = temp_player.combat['max_mana']

        print(
            f"🔍 Создан {game_player.name}: HP={game_player.max_health}, статы={game_player.strength}/{game_player.agility}/{game_player.intelligence}")

        game_player.weapon_mastery = {}
        game_player.weapon_skills = {}
        game_player.element_spells = {}
        game_player.blessings = {'combat': {'level': 0}, 'magic': {'level': 0}}
        game_player.inventory = {'max_slots': 9, 'items': []}
        game_player.equipment = {
            'helmet': None, 'armor': None, 'pants': None,
            'gloves_left': None, 'gloves_right': None,
            'boots_left': None, 'boots_right': None,
            'ring_left': None, 'ring_right': None,
            'amulet': None, 'belt': None, 'cloak': None
        }
        game_player.codex = {'monsters': {}, 'quests': {'active': [], 'completed': []}, 'recipes': [],
                             'cities_visited': []}

        game_player.save()

        request.session['active_player_id'] = game_player.id

        return JsonResponse({
            'success': True,
            'player_id': game_player.id,
            'slot': slot,
            'message': f'Персонаж создан в слоте {slot}',
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

def api_all_weapons(request):
    """Возвращает ВСЕ оружия (для выбора на манекене)"""
    from core.database import db

    cursor = db.conn.cursor()
    cursor.execute("SELECT * FROM weapons")
    weapons = [dict(row) for row in cursor.fetchall()]

    return JsonResponse({'weapons': weapons})

def api_weapon_skills(request, weapon_type):
    """Навыки конкретного оружия"""
    from core.database import db

    cursor = db.conn.cursor()
    cursor.execute(
        "SELECT * FROM weapon_skills WHERE weapon_type = ?",
        (weapon_type,)
    )
    skills = [dict(row) for row in cursor.fetchall()]

    return JsonResponse({'skills': skills})

def api_get_players(request):
    """Возвращает 3 слота игрока"""
    from .models import GamePlayer

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'players': []})

    # Русские названия
    RACE_NAMES = {
        'human': 'Человек', 'elf': 'Эльф', 'gnome': 'Гном',
        'alfir': 'Альфир', 'hardl': 'Хардлы', 'elgarn': 'Эльгарн',
        'adamantin': 'Адамантин', 'luminar': 'Люминар', 'kinetik': 'Кинетик',
    }

    ELEMENT_NAMES = {
        'fire': 'Огонь', 'water': 'Вода', 'wind': 'Ветер',
        'boiling_shadow': 'Кипящая Тень', 'plasma': 'Плазма',
        'ice': 'Лёд', 'storm': 'Молния',
        'crystal_storm': 'Хрустальная Буря', 'phoenix_blood': 'Кровь Феникса',
    }

    players = GamePlayer.objects.filter(user=request.user).order_by('slot')

    result = []
    for p in players:
        result.append({
            'slot': p.slot,
            'is_empty': p.is_empty,
            'name': p.name if not p.is_empty else None,
            'race': RACE_NAMES.get(p.race, p.race) if not p.is_empty else None,
            'element': ELEMENT_NAMES.get(p.element, p.element) if not p.is_empty else None,
            'level': 1,
            'updated_at': p.updated_at.strftime('%d.%m.%Y %H:%M'),
        })

    return JsonResponse({'success': True, 'players': result})


@csrf_exempt
def api_load_player(request):
    from .models import GamePlayer

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    if request.method == 'POST':
        data = json.loads(request.body)
        slot = int(data.get('slot', 1))

        try:
            gp = GamePlayer.objects.get(user=request.user, slot=slot)
        except GamePlayer.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Слот не найден'})

        if gp.is_empty:
            return JsonResponse({'success': False, 'message': 'Слот пуст'})

        from core.player import player as p

        # КЛЮЧЕВОЕ: заполняем ВСЕ поля
        p.name = gp.name
        p.gender = gp.gender
        p.race = gp.race
        p.element = gp.element
        p.gold = gp.gold
        p.stats = {
            'strength': gp.strength,
            'agility': gp.agility,
            'intelligence': gp.intelligence,
        }
        p.combat = {
            'max_health': gp.max_health,
            'current_health': gp.current_health,
            'max_mana': gp.max_mana,
            'current_mana': gp.current_mana,
        }
        p.armor = gp.armor
        p.energy_shield = gp.energy_shield
        p.dodge = gp.dodge
        p.weapon = gp.weapon
        p.weapon_mastery = gp.weapon_mastery
        p.weapon_skills = gp.weapon_skills
        p.element_mastery = gp.element_mastery
        p.element_spells = gp.element_spells
        p.blessings = gp.blessings
        p.inventory = gp.inventory
        p.equipment = gp.equipment
        p.codex = gp.codex

        # Карта
        from core.world_map import world_map
        world_map.player_pos = [gp.player_x, gp.player_y]
        world_map.city_selected = gp.city_selected

        request.session['active_player_id'] = gp.id

        load_active_player(request)

        return JsonResponse({
            'success': True,
            'screen': gp.current_screen or 'map',
            'message': f'Загружен: {gp.name}',
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_delete_player(request):
    """Удаляет персонажа из слота"""
    from .models import GamePlayer

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    if request.method == 'POST':
        data = json.loads(request.body)
        slot = int(data.get('slot', 1))

        try:
            game_player = GamePlayer.objects.get(user=request.user, slot=slot)
            game_player.is_empty = True
            game_player.name = 'Герой'
            game_player.race = None
            game_player.element = None
            game_player.weapon = None
            game_player.weapon_skills = {}
            game_player.element_spells = {}
            game_player.save()
            return JsonResponse({'success': True, 'message': 'Персонаж удалён'})
        except GamePlayer.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Слот не найден'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


def save_active_player(request):
    """Сохраняет текущего player в GamePlayer"""
    from core.player import player as p
    from core.world_map import world_map
    from .models import GamePlayer

    if not request.user.is_authenticated:
        return False

    player_id = request.session.get('active_player_id')
    if not player_id:
        return False

    try:
        gp = GamePlayer.objects.get(id=player_id, user=request.user)
    except GamePlayer.DoesNotExist:
        return False

    # ЗАЩИТА
    if p.combat.get('max_health', 0) == 0 or p.stats.get('strength', 0) == 0:
        print(f"⚠️ save_active_player: player пустой, пропускаем")
        return False

    gp.gold = p.gold
    gp.strength = p.stats['strength']
    gp.agility = p.stats['agility']
    gp.intelligence = p.stats['intelligence']
    gp.current_health = p.combat['current_health']
    gp.max_health = p.combat['max_health']
    gp.current_mana = p.combat['current_mana']
    gp.max_mana = p.combat['max_mana']
    gp.armor = p.armor
    gp.energy_shield = p.energy_shield
    gp.dodge = p.dodge
    gp.weapon = p.weapon
    gp.weapon_mastery = p.weapon_mastery
    gp.weapon_skills = p.weapon_skills
    gp.element_mastery = p.element_mastery
    gp.element_spells = p.element_spells
    gp.blessings = p.blessings
    gp.inventory = p.inventory
    gp.equipment = p.equipment
    gp.codex = p.codex  # ← ВАЖНО: сохраняем кодекс

    gp.player_x = world_map.player_pos[0]
    gp.player_y = world_map.player_pos[1]
    gp.city_selected = world_map.city_selected

    gp.save()
    return True


@csrf_exempt
def api_save_player(request):
    """Сохраняет текущего player в GamePlayer"""
    from .models import GamePlayer
    from core.player import player as p
    from core.world_map import world_map

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    player_id = request.session.get('active_player_id')
    if not player_id:
        return JsonResponse({'success': False, 'message': 'Персонаж не активен'})

    try:
        gp = GamePlayer.objects.get(id=player_id, user=request.user)
    except GamePlayer.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Персонаж не найден'})

    # ЗАЩИТА: не сохраняем если player пустой
    if p.combat.get('max_health', 0) == 0 or p.stats.get('strength', 0) == 0:
        print(f"⚠️ api_save_player: player пустой, пропускаем сохранение")
        return JsonResponse({'success': False, 'message': 'Данные не загружены'})

    # Сохраняем данные ИЗ ПАМЯТИ (не из БД!)
    gp.gold = p.gold
    gp.strength = p.stats['strength']
    gp.agility = p.stats['agility']
    gp.intelligence = p.stats['intelligence']
    gp.current_health = p.combat['current_health']
    gp.max_health = p.combat['max_health']
    gp.current_mana = p.combat['current_mana']
    gp.max_mana = p.combat['max_mana']
    gp.armor = p.armor
    gp.energy_shield = p.energy_shield
    gp.dodge = p.dodge
    gp.weapon = p.weapon
    gp.weapon_mastery = p.weapon_mastery
    gp.weapon_skills = p.weapon_skills
    gp.element_mastery = p.element_mastery
    gp.element_spells = p.element_spells
    gp.blessings = p.blessings
    gp.inventory = p.inventory
    gp.equipment = p.equipment
    gp.codex = p.codex

    gp.player_x = world_map.player_pos[0]
    gp.player_y = world_map.player_pos[1]
    gp.city_selected = world_map.city_selected

    # Экран
    if request.method == 'POST':
        try:
            data = json.loads(request.body) if request.body else {}
            new_screen = data.get('current_screen')
            if new_screen:
                gp.current_screen = new_screen
                print(f"💾 Сохраняю экран: {new_screen}")
        except Exception as e:
            print(f"Ошибка парсинга: {e}")

    gp.save()
    print(f"💾 Сохранено: {gp.name}, HP={gp.max_health}, gold={gp.gold}, экран: {gp.current_screen}")

    return JsonResponse({
        'success': True,
        'message': 'Сохранено',
        'screen': gp.current_screen,
    })

@csrf_exempt
def api_merchant_buy(request):
    from core.player import player
    from .models import GamePlayer
    from .db_utils import get_db_connection

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        stock_id = data.get('stock_id')

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT mds.*, mi.id as item_id, mi.name, mi.icon
            FROM merchant_daily_stock mds
            JOIN merchant_items mi ON mds.item_id = mi.id
            WHERE mds.id = ? AND mds.character_id = ?
        ''', (stock_id, request.session.get('active_player_id', 0)))
        item = cursor.fetchone()

        if not item or item['sold_out']:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Товар недоступен'})

        if player.gold < item['price']:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Недостаточно золота'})

        # Списываем золото
        player.gold -= item['price']

        # Добавляем в инвентарь
        player.add_to_inventory(item['item_id'])

        # Отмечаем проданным
        cursor.execute("UPDATE merchant_daily_stock SET sold_out = 1 WHERE id = ?", (stock_id,))
        conn.commit()
        conn.close()

        # Сохраняем в БД
        player_id = request.session.get('active_player_id')
        if player_id:
            gp = GamePlayer.objects.get(id=player_id)
            gp.gold = player.gold
            gp.inventory = player.inventory
            gp.save()

        save_active_player(request)

        return JsonResponse({
            'success': True,
            'message': f"Куплено: {item['name']}",
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_delete_player(request):
    """Удаляет персонажа из слота (очищает)"""
    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    if request.method == 'POST':
        data = json.loads(request.body)
        slot = int(data.get('slot', 1))

        try:
            game_player = GamePlayer.objects.get(user=request.user, slot=slot)
            game_player.is_empty = True
            game_player.name = 'Герой'
            game_player.race = None
            game_player.element = None
            game_player.weapon = None
            game_player.save()
            return JsonResponse({'success': True, 'message': 'Персонаж удалён'})
        except GamePlayer.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Слот не найден'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_save_game(request, slot):
    """Сохраняет игру в указанный слот"""
    if request.method == 'POST':
        data = json.loads(request.body)

        # Сохраняем в базу (пока в файл JSON, потом в таблицу)
        import os
        from django.conf import settings

        save_dir = os.path.join(settings.BASE_DIR, 'saves')
        os.makedirs(save_dir, exist_ok=True)

        save_file = os.path.join(save_dir, f'savegame_{slot}.json')
        with open(save_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return JsonResponse({'success': True, 'message': f'Игра сохранена в слот {slot}'})

def api_load_game(request, slot):
    """Загружает игру из указанного слота"""
    import os
    from django.conf import settings

    save_file = os.path.join(settings.BASE_DIR, 'saves', f'savegame_{slot}.json')

    try:
        with open(save_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return JsonResponse({'success': True, 'data': data})
    except FileNotFoundError:
        return JsonResponse({'success': False, 'data': None, 'message': 'Слот пуст'})

def api_all_saves(request):
    """Возвращает информацию о всех сохранениях"""
    import os
    from django.conf import settings

    save_dir = os.path.join(settings.BASE_DIR, 'saves')
    saves = {}

    for slot in [1, 2, 3]:
        save_file = os.path.join(save_dir, f'savegame_{slot}.json')
        try:
            with open(save_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            saves[f'slot{slot}'] = {
                'exists': True,
                'name': data.get('name', '???'),
                'race': data.get('raceName', '???'),
                'element': data.get('elementName', '???'),
                'level': data.get('level', 1),
                'timestamp': data.get('timestamp', ''),
            }
        except FileNotFoundError:
            saves[f'slot{slot}'] = {'exists': False}

    return JsonResponse(saves)

@csrf_exempt
def api_delete_save(request, slot):
    """Удаляет сохранение"""
    import os
    from django.conf import settings

    save_file = os.path.join(settings.BASE_DIR, 'saves', f'savegame_{slot}.json')
    try:
        os.remove(save_file)
        return JsonResponse({'success': True})
    except:
        return JsonResponse({'success': False})

@csrf_exempt
def api_autosave(request):
    """Автосохранение текущего состояния"""
    if request.method == 'POST':
        data = json.loads(request.body)

        import os
        from django.conf import settings

        save_dir = os.path.join(settings.BASE_DIR, 'saves')
        os.makedirs(save_dir, exist_ok=True)

        active_slot = data.get('slot', 1)

        # Загружаем существующие данные (если есть), чтобы не потерять имя и расу
        save_file = os.path.join(save_dir, f'savegame_{active_slot}.json')
        existing_data = {}
        try:
            with open(save_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        except:
            pass

        # Обновляем только изменившиеся поля
        for key in ['name', 'gender', 'race', 'raceName', 'element', 'elementName',
                    'stats', 'level', 'gold', 'hp', 'maxHp', 'mp', 'maxMp',
                    'playerX', 'playerY', 'citySelected', 'currentScreen']:
            if key in data and data[key] is not None:
                existing_data[key] = data[key]

        existing_data['timestamp'] = datetime.now().strftime("%d.%m.%Y %H:%M")

        with open(save_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return JsonResponse({'success': True, 'slot': active_slot})

def get_daily_stock(character_id=0):
    """Возвращает ассортимент для конкретного ПЕРСОНАЖА"""
    from .db_utils import get_db_connection
    import random
    from datetime import date

    conn = get_db_connection()
    cursor = conn.cursor()

    today = date.today().isoformat()

    # Проверяем ассортимент ЭТОГО персонажа
    cursor.execute(
        "SELECT COUNT(*) FROM merchant_daily_stock WHERE stock_date = ? AND character_id = ?",
        (today, character_id)
    )
    count = cursor.fetchone()[0]

    print(f"🔍 get_daily_stock: character_id={character_id}, date={today}, найдено={count}")

    if count == 0:
        print(f"   📦 Генерирую новый ассортимент...")
        cursor.execute("SELECT * FROM merchant_items")
        all_items = cursor.fetchall()
        selected = random.sample(list(all_items), min(4, len(all_items)))

        for item in selected:
            base = item['base_price']
            variation = random.uniform(-0.3, 0.3)
            price = max(item['min_price'], min(item['max_price'], int(base * (1 + variation))))

            cursor.execute(
                "INSERT INTO merchant_daily_stock (item_id, price, stock_date, character_id) VALUES (?, ?, ?, ?)",
                (item['id'], price, today, character_id)
            )
        conn.commit()

    # Ассортимент ЭТОГО персонажа
    cursor.execute('''
        SELECT mds.id, mds.price, mds.sold_out, mi.id as item_id, 
               mi.name, mi.icon, mi.description
        FROM merchant_daily_stock mds
        JOIN merchant_items mi ON mds.item_id = mi.id
        WHERE mds.stock_date = ? AND mds.character_id = ?
    ''', (today, character_id))
    stock = cursor.fetchall()
    conn.close()

    print(f"   ✅ Возвращаю {len(stock)} товаров")

    return [dict(item) for item in stock]


def api_merchant_stock(request):
    """API: ассортимент торговца"""
    from datetime import date

    if not request.user.is_authenticated:
        return JsonResponse({'stock': [], 'date': ''})

    player_id = request.session.get('active_player_id')
    if not player_id:
        print("⚠️ api_merchant_stock: нет active_player_id")
        return JsonResponse({'stock': [], 'date': ''})

    print(f"🔍 api_merchant_stock: player_id={player_id}")

    stock = get_daily_stock(player_id)
    return JsonResponse({'stock': stock, 'date': date.today().isoformat()})

@csrf_exempt
def api_merchant_reset(request):
    """Сбрасывает ассортимент торговца (для DevMode)"""
    from .db_utils import get_db_connection
    from datetime import date

    conn = get_db_connection()
    cursor = conn.cursor()

    # Удаляем сегодняшний ассортимент
    today = date.today().isoformat()
    cursor.execute("DELETE FROM merchant_daily_stock WHERE stock_date = ?", (today,))
    conn.commit()
    conn.close()

    return JsonResponse({'success': True, 'message': 'Ассортимент сброшен'})


def api_blacksmith_recipes(request):
    """API: список рецептов кузнеца"""
    from core.player import player
    from .db_utils import get_db_connection

    load_active_player(request)

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT br.*, 
               (SELECT GROUP_CONCAT(ri.item_name || ' x' || ri.quantity) 
                FROM recipe_ingredients ri 
                WHERE ri.recipe_id = br.id) as ingredients
        FROM blacksmith_recipes br
    ''')
    recipes = [dict(row) for row in cursor.fetchall()]
    conn.close()

    # Известные рецепты из кодекса
    known = player.codex.get('recipes', [])

    return JsonResponse({
        'recipes': recipes,
        'known': known,  # ← добавить
    })


@csrf_exempt
def api_blacksmith_craft(request):
    """Изготовление предмета"""
    from core.player import player
    from .models import GamePlayer
    from .db_utils import get_db_connection

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        recipe_id = data.get('recipe_id')

        print(f"🔍 api_blacksmith_craft: recipe_id={recipe_id}")

        conn = get_db_connection()
        cursor = conn.cursor()

        # Получаем рецепт
        cursor.execute("SELECT * FROM blacksmith_recipes WHERE id = ?", (recipe_id,))
        recipe = cursor.fetchone()

        if not recipe:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Рецепт не найден'})

        # Получаем ингредиенты
        cursor.execute(
            "SELECT item_name, quantity FROM recipe_ingredients WHERE recipe_id = ?",
            (recipe_id,)
        )
        ingredients = cursor.fetchall()

        print(f"   Нужно ингредиентов: {len(ingredients)}")

        # Проверяем наличие ингредиентов
        missing = []
        for ing in ingredients:
            item_name = ing['item_name']
            needed = ing['quantity']

            # Считаем в инвентаре
            count = 0
            for item in player.inventory.get('items', []):
                if isinstance(item, dict):
                    item_data = player.items_data.get(item.get('id'), {})
                    if item_data.get('name') == item_name or item.get('name') == item_name:
                        count += item.get('quantity', 1)

            print(f"   {item_name}: нужно {needed}, есть {count}")

            if count < needed:
                missing.append(f"{item_name} ({count}/{needed})")

        if missing:
            conn.close()
            print(f"   ❌ Не хватает: {missing}")
            return JsonResponse({
                'success': False,
                'message': f"Не хватает: {', '.join(missing)}"
            })

        # Списываем ингредиенты
        for ing in ingredients:
            item_name = ing['item_name']
            needed = ing['quantity']
            remaining = needed

            for item in player.inventory['items'][:]:
                if remaining <= 0:
                    break
                if isinstance(item, dict):
                    item_data = player.items_data.get(item.get('id'), {})
                    if item_data.get('name') == item_name or item.get('name') == item_name:
                        take = min(item.get('quantity', 1), remaining)
                        item['quantity'] = item.get('quantity', 1) - take
                        remaining -= take
                        if item['quantity'] <= 0:
                            player.inventory['items'].remove(item)

        # Добавляем результат в инвентарь
        result_item = recipe['result_item']
        result_icon = recipe['result_icon'] or '📦'

        # Ищем ID результата
        result_id = None
        for item_id, item_data in player.items_data.items():
            if item_data.get('name') == result_item:
                result_id = item_id
                break

        if not result_id:
            # Если нет в базе — используем имя как ID
            result_id = result_item.lower().replace(' ', '_')

        player.add_to_inventory(result_id, 1)

        conn.close()

        # СОХРАНЯЕМ В БД
        save_active_player(request)

        print(f"   ✅ Изготовлено: {result_item}")

        return JsonResponse({
            'success': True,
            'message': f"Изготовлено: {result_item}",
            'result_icon': result_icon,
            'result_item': result_item,
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_blacksmith_learn_recipe(request):
    """Изучить рецепт"""
    from core.player import player
    from .models import GamePlayer
    from .db_utils import get_db_connection

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        recipe_id = data.get('recipe_id')
        price = data.get('price', 0)

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM blacksmith_recipes WHERE id = ?", (recipe_id,))
        recipe = cursor.fetchone()

        if not recipe:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Рецепт не найден'})

        # Проверяем золото
        if player.gold < price:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Недостаточно золота'})

        # Списываем золото
        player.gold -= price

        # Добавляем рецепт в кодекс
        if 'recipes' not in player.codex:
            player.codex['recipes'] = []
        if recipe_id not in player.codex['recipes']:
            player.codex['recipes'].append(recipe_id)

        # Сохраняем в БД
        save_active_player(request)

        conn.close()

        return JsonResponse({
            'success': True,
            'message': f"Рецепт изучен: {recipe['name']}",
            'recipe_name': recipe['name'],
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_tavern_buy(request):
    """Покупка еды в таверне"""
    from core.player import player

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        item_id = data.get('item_id')
        price = data.get('price', 0)
        heal = data.get('heal', 0)
        mana = data.get('mana', 0)

        if player.gold < price:
            return JsonResponse({'success': False, 'message': 'Недостаточно золота'})

        player.gold -= price
        player.combat['current_health'] = min(
            player.combat['current_health'] + heal,
            player.combat['max_health']
        )
        if mana:
            player.combat['current_mana'] = min(
                player.combat['current_mana'] + mana,
                player.combat['max_mana']
            )

        save_active_player(request)

        return JsonResponse({'success': True, 'message': f'Куплено!'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_brothel_rest(request):
    """Отдых в борделе"""
    from core.player import player

    print("🔍 api_brothel_rest вызван")

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        price = data.get('price', 0)
        heal_full = data.get('heal_full', False)

        print(f"   price={price}, heal_full={heal_full}, gold={player.gold}")

        if player.gold < price:
            return JsonResponse({'success': False, 'message': 'Недостаточно золота'})

        player.gold -= price

        if heal_full:
            player.combat['current_health'] = player.combat['max_health']
            player.combat['current_mana'] = player.combat['max_mana']

        save_active_player(request)

        print(f"   ✅ Успех. Осталось золота: {player.gold}")

        return JsonResponse({'success': True, 'message': 'Отдых завершён'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_brothel_work(request):
    """Работа в борделе"""
    from core.player import player

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        reward = data.get('reward', 0)

        player.gold += reward

        save_active_player(request)

        return JsonResponse({'success': True, 'message': f'Заработано {reward} золота'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_brothel_work_start(request):
    """Начать работу"""
    from core.player import player
    from .models import GamePlayer
    from datetime import datetime, timedelta

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        reward = data.get('reward', 0)
        hours = data.get('hours', 1)
        name = data.get('name', 'Работа')

        player_id = request.session.get('active_player_id')
        gp = GamePlayer.objects.get(id=player_id)

        # Проверяем, не работает ли уже
        if gp.work_end_time:
            try:
                end_time = datetime.strptime(gp.work_end_time, '%Y-%m-%d %H:%M:%S')
                if datetime.now() < end_time:
                    remaining = int((end_time - datetime.now()).total_seconds() / 60)
                    return JsonResponse({
                        'success': False,
                        'message': f'Ты уже работаешь! Осталось {remaining} мин.'
                    })
            except:
                pass

        # Начинаем работу
        end_time = datetime.now() + timedelta(hours=hours)
        gp.work_end_time = end_time.strftime('%Y-%m-%d %H:%M:%S')
        gp.work_reward = reward
        gp.work_name = name
        gp.save()

        return JsonResponse({
            'success': True,
            'message': f'Начал работу: {name}. Вернись через {hours} ч.',
            'end_time': gp.work_end_time,
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

def api_brothel_work_status(request):
    """Проверить статус работы"""
    from .models import GamePlayer
    from datetime import datetime

    if not request.user.is_authenticated:
        return JsonResponse({'success': False})

    player_id = request.session.get('active_player_id')
    if not player_id:
        return JsonResponse({'success': False})

    try:
        gp = GamePlayer.objects.get(id=player_id)
    except GamePlayer.DoesNotExist:
        return JsonResponse({'success': False})

    if not gp.work_end_time:
        return JsonResponse({'success': True, 'has_work': False})

    try:
        end_time = datetime.strptime(gp.work_end_time, '%Y-%m-%d %H:%M:%S')
    except:
        return JsonResponse({'success': True, 'has_work': False})

    now = datetime.now()

    if now < end_time:
        # Ещё работает
        remaining_seconds = int((end_time - now).total_seconds())
        return JsonResponse({
            'success': True,
            'has_work': True,
            'finished': False,
            'name': gp.work_name,
            'reward': gp.work_reward,
            'remaining_seconds': remaining_seconds,
        })
    else:
        # Работа завершена — можно забрать
        return JsonResponse({
            'success': True,
            'has_work': True,
            'finished': True,
            'name': gp.work_name,
            'reward': gp.work_reward,
        })

@csrf_exempt
def api_brothel_work_claim(request):
    """Забрать награду за работу"""
    from core.player import player
    from .models import GamePlayer
    from datetime import datetime

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        player_id = request.session.get('active_player_id')
        gp = GamePlayer.objects.get(id=player_id)

        if not gp.work_end_time:
            return JsonResponse({'success': False, 'message': 'Нет активной работы'})

        try:
            end_time = datetime.strptime(gp.work_end_time, '%Y-%m-%d %H:%M:%S')
        except:
            return JsonResponse({'success': False, 'message': 'Ошибка времени'})

        if datetime.now() < end_time:
            remaining = int((end_time - datetime.now()).total_seconds() / 60)
            return JsonResponse({
                'success': False,
                'message': f'Работа ещё не завершена. Осталось {remaining} мин.'
            })

        # Начисляем
        reward = gp.work_reward
        player.gold += reward

        # Очищаем работу
        gp.work_end_time = None
        gp.work_reward = 0
        gp.work_name = None
        gp.save()

        # Сохраняем игрока
        save_active_player(request)

        return JsonResponse({
            'success': True,
            'message': f'Получено {reward} золота!',
            'reward': reward,
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

def api_world_market(request):
    """API: товары на мировом рынке"""
    from .db_utils import get_db_connection

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM world_market 
        WHERE sold = 0 
        ORDER BY created_at DESC
    ''')
    items = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return JsonResponse({'items': items})

@csrf_exempt
def api_world_market_sell(request):
    """API: выставить предмет на мировой рынок"""
    if request.method == 'POST':
        data = json.loads(request.body)

        from .db_utils import get_db_connection
        from datetime import datetime

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO world_market (seller_name, item_name, item_icon, price, currency, quantity, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('seller_name', 'Игрок'),
            data.get('item_name'),
            data.get('item_icon', '📦'),
            data.get('price', 10),
            data.get('currency', 'gold'),
            data.get('quantity', 1),
            datetime.now().strftime("%d.%m.%Y %H:%M")
        ))
        conn.commit()
        conn.close()

        return JsonResponse({'success': True, 'message': 'Предмет выставлен на рынок'})

@csrf_exempt
def api_world_market_buy(request):
    """API: купить предмет с мирового рынка"""
    if request.method == 'POST':
        data = json.loads(request.body)
        market_id = data.get('market_id')

        from .db_utils import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM world_market WHERE id = ?", (market_id,))
        item = cursor.fetchone()

        if not item or item['sold']:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Товар недоступен'})

        cursor.execute("UPDATE world_market SET sold = 1 WHERE id = ?", (market_id,))
        conn.commit()
        conn.close()

        return JsonResponse({
            'success': True,
            'message': f"Куплено: {item['item_name']}",
            'item_name': item['item_name'],
            'item_icon': item['item_icon'],
        })

def api_currencies(request):
    """API: курсы валют"""
    from .db_utils import get_db_connection

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM currencies")
    currencies = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return JsonResponse({'currencies': currencies})

@csrf_exempt
def api_exchange_currency(request):
    """API: обмен валюты"""
    if request.method == 'POST':
        data = json.loads(request.body)
        from_currency = data.get('from')
        to_currency = data.get('to')
        amount = data.get('amount', 0)

        from .db_utils import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM currencies WHERE id IN (?, ?)", (from_currency, to_currency))
        rates = {row['id']: row['rate_to_gold'] for row in cursor.fetchall()}
        conn.close()

        if from_currency not in rates or to_currency not in rates:
            return JsonResponse({'success': False, 'message': 'Неверная валюта'})

        # Расчёт: amount * rate_from / rate_to
        result = amount * rates[from_currency] / rates[to_currency]

        return JsonResponse({
            'success': True,
            'from_amount': amount,
            'to_amount': round(result, 2),
            'message': f"Обменяно {amount} на {round(result, 2)}"
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_battle_start(request):
    """Начало боя"""
    if request.method == 'POST':
        data = json.loads(request.body)
        enemies_ids = data.get('enemies', ['glass_wasp'])

        battle = start_battle(enemies_ids)
        return JsonResponse({'success': True, 'state': battle.get_state()})


def api_battle_state(request):
    """Состояние боя"""
    if battle_module.current_battle:
        return JsonResponse(battle_module.current_battle.get_state())
    return JsonResponse({'error': 'Бой не активен'})


def api_arsenal_data(request):
    from core.player import player
    from core.database import db

    load_active_player(request)
    # Все оружия (для отображения)
    cursor = db.conn.cursor()
    cursor.execute("SELECT * FROM weapons")
    all_weapons = [dict(row) for row in cursor.fetchall()]

    # Но показываем только те, что у игрока в инвентаре!
    player_weapon_ids = set()
    for item in player.inventory['items']:
        if isinstance(item, dict) and item.get('id'):
            if item['id'] in [w['id'] for w in all_weapons]:
                player_weapon_ids.add(item['id'])

    # Только доступные
    available_weapons = [w for w in all_weapons if w['id'] in player_weapon_ids]

    current_weapon = player.weapon['weapon_type'] if player.weapon else None

    # Навыки текущего оружия
    skills = []
    if current_weapon:
        cursor.execute("SELECT * FROM weapon_skills WHERE weapon_type = ?", (current_weapon,))
        skill_rows = [dict(row) for row in cursor.fetchall()]

        for skill in skill_rows:
            cursor.execute("SELECT * FROM weapon_skill_paths WHERE skill_id = ?", (skill['id'],))
            paths = [dict(row) for row in cursor.fetchall()]

            level = 1
            if skill['id'] in player.weapon_skills:
                level = player.weapon_skills[skill['id']].get('level', 1)

            skills.append({
                'id': skill['id'],
                'name': skill['name'],
                'icon': skill['icon'],
                'level': level,
                'paths': paths,
            })

    paths = {}
    for skill_id, skill_data in player.weapon_skills.items():
        if skill_data.get('path'):
            paths[skill_id] = skill_data['path']

    return JsonResponse({
        'weapons': available_weapons,
        'current_weapon': current_weapon,
        'skills': skills,
        'paths': paths,
        'weapon_mastery': player.weapon_mastery,  # ← ДОБАВИТЬ
    })


@csrf_exempt
def api_dummy_try_weapon(request):
    """Пробная атака на манекене (не убивает, не наносит урона игроку)"""
    from core.player import player
    from core.database import db
    import random

    print("🔍 api_dummy_try_weapon вызван")

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        weapon_type = data.get('weapon_type')
        skill_id = data.get('skill_id')

        print(f"   weapon_type={weapon_type}, skill_id={skill_id}")

        # Если weapon_type == 'current', берём текущее оружие из player
        if weapon_type == 'current':
            if not player.weapon:
                return JsonResponse({'success': False, 'message': 'Нет оружия'})
            weapon_type = player.weapon['weapon_type']

        cursor = db.conn.cursor()

        cursor.execute("SELECT * FROM weapons WHERE id = ?", (weapon_type,))
        weapon = cursor.fetchone()

        if not weapon:
            print(f"   ❌ Оружие не найдено")
            return JsonResponse({'success': False, 'message': 'Оружие не найдено'})

        cursor.execute("SELECT * FROM weapon_skills WHERE id = ?", (skill_id,))
        skill = cursor.fetchone()

        if not skill:
            print(f"   ❌ Навык не найден")
            return JsonResponse({'success': False, 'message': 'Навык не найден'})

        # Расчёт урона
        base = skill['base_damage']
        phys_mult = {0: 0.0, 1: 0.8, 2: 1.0, 3: 1.3}.get(weapon['physical'], 1.0)

        damage = int((base * phys_mult) + (player.stats['strength'] * 1.5))
        is_crit = random.random() * 100 < 10
        if is_crit:
            damage *= 2

        print(f"   ✅ Урон: {damage}")

        return JsonResponse({
            'success': True,
            'damage': damage,
            'is_crit': is_crit,
            'skill_name': skill['name'],
            'weapon_name': weapon['name'],
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_choose_weapon(request):
    """Финальный выбор оружия (один раз)"""
    from core.player import player
    from .models import GamePlayer
    from core.database import db

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        weapon_type = data.get('weapon_type')

        # Проверка: оружие ещё не выбрано
        if player.weapon:
            return JsonResponse({
                'success': False,
                'message': 'Оружие уже выбрано! Сменить можно только за платную функцию.'
            })

        # Находим оружие
        cursor = db.conn.cursor()
        cursor.execute("SELECT * FROM weapons WHERE id = ?", (weapon_type,))
        weapon = cursor.fetchone()

        if not weapon:
            return JsonResponse({'success': False, 'message': 'Оружие не найдено'})

        # Экипируем
        player.weapon = {
            'weapon_type': weapon['id'],
            'name': weapon['name'],
            'icon': weapon['icon'],
            'level': 1,
            'rarity': 'common',
            'speed': weapon['speed'],
            'physical': weapon['physical'],
            'magic': weapon['magic'],
        }

        # Владение = 0
        player.weapon_mastery = {weapon_type: 0.0}

        # Изучаем 3 навыка на 1 уровне
        cursor.execute("SELECT * FROM weapon_skills WHERE weapon_type = ?", (weapon_type,))
        for skill in cursor.fetchall():
            player.learn_weapon_skill(skill['id'])

        # Добавляем в инвентарь
        player.add_to_inventory(weapon_type, 1)

        # Сохраняем в БД
        save_active_player(request)

        return JsonResponse({
            'success': True,
            'message': f'Выбрано оружие: {weapon["name"]}. Теперь его нельзя изменить!',
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_arsenal_change_weapon(request):
    """Меняет оружие игрока и загружает его навыки"""
    from core.player import player
    from core.database import db

    if request.method == 'POST':
        data = json.loads(request.body)
        weapon_type = data.get('weapon_type')

        if not weapon_type:
            return JsonResponse({'success': False, 'message': 'Не указано оружие'})

        # Находим оружие
        cursor = db.conn.cursor()
        cursor.execute("SELECT * FROM weapons WHERE id = ?", (weapon_type,))
        weapon = cursor.fetchone()

        if not weapon:
            return JsonResponse({'success': False, 'message': 'Оружие не найдено'})

        # Устанавливаем оружие
        player.weapon = {
            'weapon_type': weapon['id'],
            'name': weapon['name'],
            'icon': weapon['icon'],
            'level': 1,
            'rarity': 'common',
            'speed': weapon['speed'],
            'physical': weapon['physical'],
            'magic': weapon['magic'],
        }

        # Сбрасываем навыки оружия (они загрузятся при следующем бое)
        player.weapon_skills = {}

        # Инициализируем владение если нет
        if weapon_type not in player.weapon_mastery:
            player.weapon_mastery[weapon_type] = 0.0

        # Загружаем навыки нового оружия
        cursor.execute("SELECT * FROM weapon_skills WHERE weapon_type = ?", (weapon_type,))
        skill_rows = [dict(row) for row in cursor.fetchall()]

        skills = []
        for skill in skill_rows:
            # Автоматически изучаем все навыки оружия (для теста)
            player.learn_weapon_skill(skill['id'])

            cursor.execute(
                "SELECT * FROM weapon_skill_paths WHERE skill_id = ?",
                (skill['id'],)
            )
            paths = [dict(row) for row in cursor.fetchall()]

            skills.append({
                'id': skill['id'],
                'name': skill['name'],
                'icon': skill['icon'],
                'level': player.weapon_skills[skill['id']]['level'],
                'paths': paths,
            })

        # ✅ СОХРАНЯЕМ В БД
        save_active_player(request)
        print(f"💾 Оружие сохранено: {player.weapon['name']}")

        return JsonResponse({
            'success': True,
            'message': f'Оружие изменено на {weapon["name"]}',
            'skills': skills,
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_arsenal_set_path(request):
    """Устанавливает путь для навыка"""
    from core.player import player

    if request.method == 'POST':
        data = json.loads(request.body)
        skill_id = data.get('skill_id')
        path_id = data.get('path_id')  # Может быть None

        if not skill_id:
            return JsonResponse({'success': False, 'message': 'Не указан навык'})

        if skill_id not in player.weapon_skills:
            return JsonResponse({'success': False, 'message': 'Навык не изучен'})

        # Устанавливаем путь
        player.weapon_skills[skill_id]['path'] = path_id

        return JsonResponse({
            'success': True,
            'message': f'Путь установлен: {path_id or "сброшен"}',
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

def api_magic_data(request):
    """Возвращает данные для вкладки Магия"""
    from core.player import player
    from core.database import db

    load_active_player(request)
    # Все стихии
    cursor = db.conn.cursor()
    cursor.execute("SELECT * FROM element_resistances GROUP BY element")
    # Не подходит — надо список стихий отдельно

    # Список стихий (жёстко, так как таблицы elements нет)
    elements = [
        {'id': 'fire', 'name': 'Огонь', 'icon': '🔥'},
        {'id': 'water', 'name': 'Вода', 'icon': '💧'},
        {'id': 'wind', 'name': 'Ветер', 'icon': '💨'},
        {'id': 'boiling_shadow', 'name': 'Кипящая Тень', 'icon': '🌑'},
        {'id': 'plasma', 'name': 'Плазма', 'icon': '⚡'},
        {'id': 'ice', 'name': 'Лёд', 'icon': '❄️'},
        {'id': 'storm', 'name': 'Молния', 'icon': '🌩️'},
        {'id': 'crystal_storm', 'name': 'Хрустальная Буря', 'icon': '💎'},
        {'id': 'phoenix_blood', 'name': 'Кровь Феникса', 'icon': '🩸'},
    ]

    current_element = player.element

    # Заклинания текущей стихии
    spells = []
    if current_element:
        cursor.execute("SELECT * FROM element_spells WHERE element = ?", (current_element,))
        spell_rows = [dict(row) for row in cursor.fetchall()]

        for spell in spell_rows:
            cursor.execute(
                "SELECT * FROM spell_paths WHERE spell_id = ?",
                (spell['id'],)
            )
            paths = [dict(row) for row in cursor.fetchall()]

            level = 1
            if spell['id'] in player.element_spells:
                level = player.element_spells[spell['id']].get('level', 1)

            spells.append({
                'id': spell['id'],
                'name': spell['name'],
                'icon': spell['icon'],
                'level': level,
                'paths': paths,
            })

    # Пути
    paths = {}
    for spell_id, spell_data in player.element_spells.items():
        if spell_data.get('path'):
            paths[spell_id] = spell_data['path']

    return JsonResponse({
        'elements': elements,
        'current_element': current_element,
        'spells': spells,
        'paths': paths,
    })


@csrf_exempt
def api_magic_change_element(request):
    """Меняет стихию игрока (только для теста!)"""
    from core.player import player
    from core.database import db

    if request.method == 'POST':
        data = json.loads(request.body)
        element = data.get('element')

        if not element:
            return JsonResponse({'success': False, 'message': 'Не указана стихия'})

        player.element = element

        # Для теста — изучаем все заклинания стихии на 9 уровне
        cursor = db.conn.cursor()
        cursor.execute("SELECT * FROM element_spells WHERE element = ?", (element,))
        spell_rows = [dict(row) for row in cursor.fetchall()]

        player.element_spells = {}
        for spell in spell_rows:
            player.learn_spell(spell['id'])
            player.element_spells[spell['id']]['level'] = 9

        return JsonResponse({
            'success': True,
            'message': f'Стихия изменена на {element}',
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_magic_set_path(request):
    """Устанавливает путь для заклинания"""
    from core.player import player

    if request.method == 'POST':
        data = json.loads(request.body)
        spell_id = data.get('spell_id')
        path_id = data.get('path_id')

        if not spell_id:
            return JsonResponse({'success': False, 'message': 'Не указано заклинание'})

        if spell_id not in player.element_spells:
            return JsonResponse({'success': False, 'message': 'Заклинание не изучено'})

        player.element_spells[spell_id]['path'] = path_id

        return JsonResponse({
            'success': True,
            'message': f'Путь установлен: {path_id or "сброшен"}',
        })

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

@csrf_exempt
def api_battle_skill(request):
    """Использование навыка"""
    if request.method == 'POST':
        data = json.loads(request.body)
        skill_id = data.get('skill_id')

        if not battle_module.current_battle:
            return JsonResponse({'success': False, 'message': 'Бой не активен'})

        result = battle_module.current_battle.player_use_skill(skill_id)
        return JsonResponse({
            'success': result['success'],
            'message': result.get('message', ''),
            'state': battle_module.current_battle.get_state(),
        })


@csrf_exempt
def api_battle_spell(request):
    """Использование заклинания"""
    if request.method == 'POST':
        data = json.loads(request.body)
        spell_id = data.get('spell_id')

        if not battle_module.current_battle:
            return JsonResponse({'success': False, 'message': 'Бой не активен'})

        result = battle_module.current_battle.player_use_spell(spell_id)
        return JsonResponse({
            'success': result['success'],
            'message': result.get('message', ''),
            'state': battle_module.current_battle.get_state(),
        })


@csrf_exempt
def api_battle_tick(request):
    """Обновление боя (вызывается каждые 0.1 сек)"""
    if request.method == 'POST':
        data = json.loads(request.body)
        dt = data.get('dt', 0.1)

        if not battle_module.current_battle:
            return JsonResponse({'error': 'Бой не активен'})

        battle_module.current_battle.update(dt)
        return JsonResponse(battle_module.current_battle.get_state())


@csrf_exempt
def api_battle_select_target(request):
    """Выбор цели"""
    if request.method == 'POST':
        data = json.loads(request.body)
        index = data.get('index', 0)

        if battle_module.current_battle:
            battle_module.current_battle.select_target(index)
            return JsonResponse(battle_module.current_battle.get_state())
        return JsonResponse({'error': 'Бой не активен'})


@csrf_exempt
def api_battle_escape(request):
    """Попытка сбежать"""
    if battle_module.current_battle:
        success = battle_module.current_battle.try_escape()
        return JsonResponse({'success': success, 'state': battle_module.current_battle.get_state()})
    return JsonResponse({'error': 'Бой не активен'})

@ensure_csrf_cookie
def battle_view(request):
    """Страница боя"""
    return render(request, 'battle.html')

import core.battle as battle_module
from core.battle import start_battle

@csrf_exempt
def api_battle_start(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        enemies_ids = data.get('enemies', ['glass_wasp'])
        battle = start_battle(enemies_ids)
        return JsonResponse({'success': True, 'state': battle.get_state()})

def api_battle_state(request):
    if battle_module.current_battle:
        return JsonResponse(battle_module.current_battle.get_state())
    return JsonResponse({'error': 'Бой не активен'})

@csrf_exempt
def api_battle_skill(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        skill_id = data.get('skill_id')
        if not battle_module.current_battle:
            return JsonResponse({'success': False, 'message': 'Бой не активен'})
        result = battle_module.current_battle.player_use_skill(skill_id)
        return JsonResponse({
            'success': result['success'],
            'message': result.get('message', ''),
            'state': battle_module.current_battle.get_state(),
        })

@csrf_exempt
def api_battle_spell(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        spell_id = data.get('spell_id')
        if not battle_module.current_battle:
            return JsonResponse({'success': False, 'message': 'Бой не активен'})
        result = battle_module.current_battle.player_use_spell(spell_id)
        return JsonResponse({
            'success': result['success'],
            'message': result.get('message', ''),
            'state': battle_module.current_battle.get_state(),
        })

@csrf_exempt
def api_battle_tick(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        dt = data.get('dt', 0.2)
        if not battle_module.current_battle:
            return JsonResponse({'error': 'Бой не активен'})
        battle_module.current_battle.update(dt)
        return JsonResponse(battle_module.current_battle.get_state())

@csrf_exempt
def api_battle_select_target(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        index = data.get('index', 0)
        if battle_module.current_battle:
            battle_module.current_battle.select_target(index)
            return JsonResponse(battle_module.current_battle.get_state())
        return JsonResponse({'error': 'Бой не активен'})

@csrf_exempt
def api_battle_escape(request):
    if battle_module.current_battle:
        success = battle_module.current_battle.try_escape()
        return JsonResponse({'success': success, 'state': battle_module.current_battle.get_state()})
    return JsonResponse({'error': 'Бой не активен'})

@csrf_exempt
def api_battle_start(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        enemies_ids = data.get('enemies', ['glass_wasp'])

        # ПОДГОТОВКА ИГРОКА (заглушка)
        from core.player import player
        if not player.weapon:
            player.name = "Тестовый Герой"
            player.element = "fire"
            player.stats = {"strength": 10, "agility": 8, "intelligence": 12}
            player.calculate_derived_stats()

            player.weapon = {
                'weapon_type': 'claymore',
                'name': 'Клеймор теней',
                'level': 1,
                'rarity': 'common',
                'speed': 2,
                'physical': 2,
                'magic': 2,
            }

            player.learn_weapon_skill('claymore_straight')
            player.learn_weapon_skill('claymore_rising')
            player.learn_spell('fire_fist')

        battle = start_battle(enemies_ids)
        return JsonResponse({'success': True, 'state': battle.get_state()})

@csrf_exempt
def api_player_equip(request):
    """Надеть предмет"""
    from core.player import player

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        item_id = data.get('item_id')

        if not item_id:
            return JsonResponse({'success': False, 'message': 'Не указан предмет'})

        if not player.has_item(item_id):
            return JsonResponse({'success': False, 'message': 'Предмета нет в инвентаре'})

        if item_id in player.items_data:
            item = player.items_data[item_id]
            slot = item.get('slot')

            if not slot:
                return JsonResponse({'success': False, 'message': 'Этот предмет нельзя надеть'})

            if player.equip_item(item_id, slot):
                # Сохраняем в БД
                from .models import GamePlayer
                player_id = request.session.get('active_player_id')
                if player_id:
                    gp = GamePlayer.objects.get(id=player_id)
                    gp.equipment = player.equipment
                    gp.inventory = player.inventory
                    gp.armor = player.armor
                    gp.energy_shield = player.energy_shield
                    gp.dodge = player.dodge
                    gp.save()

                save_active_player(request)

                return JsonResponse({
                    'success': True,
                    'message': f'Надето: {item["name"]}',
                })

        return JsonResponse({'success': False, 'message': 'Не удалось надеть'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})


@csrf_exempt
def api_player_unequip(request):
    """Снять предмет"""
    from core.player import player

    if not request.user.is_authenticated:
        return JsonResponse({'success': False, 'message': 'Не авторизован'})

    load_active_player(request)

    if request.method == 'POST':
        data = json.loads(request.body)
        slot = data.get('slot')

        if not slot:
            return JsonResponse({'success': False, 'message': 'Не указан слот'})

        if player.unequip_item(slot):
            # Сохраняем в БД
            from .models import GamePlayer
            player_id = request.session.get('active_player_id')
            if player_id:
                gp = GamePlayer.objects.get(id=player_id)
                gp.equipment = player.equipment
                gp.inventory = player.inventory
                gp.save()

            save_active_player(request)

            return JsonResponse({'success': True, 'message': 'Снято'})

        return JsonResponse({'success': False, 'message': 'Не удалось снять'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

def codex(request):
    """Кодекс (база знаний)"""
    return render(request, 'codex.html')

def index(request):
    """Главное меню"""
    from .models import GamePlayer

    has_players = False
    if request.user.is_authenticated:
        has_players = GamePlayer.objects.filter(
            user=request.user,
            is_empty=False
        ).exists()

    return render(request, 'index.html', {
        'has_players': has_players,
    })

def intro(request):
    """Экран волшебника-рассказчика"""
    return render(request, 'intro.html')

def race_select(request):
    """Экран выбора расы"""
    return render(request, 'race_select.html')

def element_select(request):
    """Экран выбора стихии"""
    return render(request, 'element_select.html')

def finalize(request):
    """Экран финализации (имя + пол)"""
    return render(request, 'finalize.html')

def save_game(request):
    """Экран сохранения игры"""
    return render(request, 'save_game.html')

@ensure_csrf_cookie
def map_view(request):
    """Карта мира"""
    return render(request, 'map.html')

@ensure_csrf_cookie
def load_game(request):
    """Экран загрузки игры"""
    return render(request, 'load_game.html')

def city_view(request):
    """Экран города"""
    return render(request, 'city.html')

def trade_district(request):
    """Торговый район"""
    return render(request, 'trade_district.html')

def blacksmith(request):
    """Кузнец"""
    return render(request, 'blacksmith.html')

def black_market(request):
    """Чёрный рынок"""
    return render(request, 'black_market.html')

def admin_district(request):
    """Административный район"""
    return render(request, 'admin_district.html')

def circle_of_access(request):
    """Круг доступа"""
    return render(request, 'circle_of_access.html')

def circle_of_greats(request):
    """Круг Великих"""
    return render(request, 'circle_of_greats.html')

def circle_of_blades(request):
    """Круг Клинков"""
    return render(request, 'circle_of_blades.html')

def weapon_skills(request):
    """Изучение навыков оружия"""
    return render(request, 'weapon_skills.html')

def training_dummy(request):
    """Тренировочный манекен"""
    return render(request, 'training_dummy.html')

def blessing_check(request):
    """Боевое благословение (Круг Клинков)"""
    return render(request, 'blessing_check.html')

def blessing_check_magic(request):
    """Магическое благословение (Круг Великих)"""
    return render(request, 'blessing_check_magic.html')

def living_district(request):
    """Жилой район"""
    return render(request, 'living_district.html')

def tavern(request):
    """Таверна"""
    return render(request, 'tavern.html')

def brothel(request):
    """Бордель"""
    return render(request, 'brothel.html')

def kennel(request):
    """Питомник"""
    return render(request, 'kennel.html')

def merchant(request):
    """Торговец"""
    return render(request, 'merchant.html')

@ensure_csrf_cookie
def character(request):
    """Экран персонажа"""
    return render(request, 'character.html')

def choose_slot(request):
    return render(request, 'choose_slot.html')

@ensure_csrf_cookie
def choose_slot(request):
    return render(request, 'choose_slot.html')

def api_game_time(request):
    """API: текущее игровое время"""
    from core.time_system import game_clock

    time_data = game_clock.current.copy()
    time_data['total_seconds'] = game_clock.current_seconds  # ← ДОБАВИТЬ
    time_data['modifier'] = game_clock.get_today_modifier()

    return JsonResponse(time_data)

def api_current_city(request):
    """API: текущий город игрока"""
    from core.world_map import world_map

    load_active_player(request)

    cell = world_map.get_cell(*world_map.player_pos)

    if cell and cell.get('settlement'):
        return JsonResponse({
            'city_id': cell.get('settlement_id'),
            'city_name': cell['settlement'].get('name'),
        })

    return JsonResponse({'city_id': None, 'city_name': None})


def sell_items(request):
    """Продажа предметов в Круге доступа"""
    return render(request, 'sell_items.html')


def join_beyonders(request):
    """Вступление в Запредельщики"""
    return render(request, 'join_beyonders.html')


def beyond_barrier(request):
    """Выход за барьер"""
    return render(request, 'beyond_barrier.html')


def spell_library(request):
    """Изучение заклинаний"""
    return render(request, 'spell_library.html')


def achievements(request):
    """Доска достижений"""
    return render(request, 'achievements.html')