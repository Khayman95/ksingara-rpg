from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.shortcuts import render
from .db_utils import get_db_connection
from .models import Player
from datetime import datetime
import json
import random
from datetime import date, datetime

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

def api_player_stats(request, player_id):
    """Получить статистику игрока"""
    try:
        player = Player.objects.get(id=player_id)
        return JsonResponse({
            'name': player.name,
            'race': player.race,
            'element': player.element,
            'hp': f"{player.current_health}/{player.max_health}",
            'mp': f"{player.current_mana}/{player.max_mana}",
            'gold': player.gold,
            'strength': player.strength,
            'agility': player.agility,
            'intelligence': player.intelligence,
        })
    except Player.DoesNotExist:
        return JsonResponse({'error': 'Игрок не найден'}, status=404)

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


def get_daily_stock():
    """Возвращает сегодняшний ассортимент торговца"""
    from .db_utils import get_db_connection

    conn = get_db_connection()
    cursor = conn.cursor()

    today = date.today().isoformat()

    # Проверяем, есть ли уже ассортимент на сегодня
    cursor.execute("SELECT COUNT(*) FROM merchant_daily_stock WHERE stock_date = ?", (today,))
    count = cursor.fetchone()[0]

    if count == 0:
        # Генерируем новый ассортимент
        cursor.execute("SELECT * FROM merchant_items")
        all_items = cursor.fetchall()

        # Выбираем 4-6 случайных предметов
        selected = random.sample(list(all_items), min(4, len(all_items)))

        for item in selected:
            # Цена колеблется ±30% от базовой
            base = item['base_price']
            variation = random.uniform(-0.3, 0.3)
            price = max(item['min_price'], min(item['max_price'], int(base * (1 + variation))))

            cursor.execute(
                "INSERT INTO merchant_daily_stock (item_id, price, stock_date) VALUES (?, ?, ?)",
                (item['id'], price, today)
            )
        conn.commit()

    # Получаем сегодняшний ассортимент
    cursor.execute('''
        SELECT mds.id, mds.price, mds.sold_out, mi.name, mi.icon, mi.description
        FROM merchant_daily_stock mds
        JOIN merchant_items mi ON mds.item_id = mi.id
        WHERE mds.stock_date = ?
    ''', (today,))
    stock = cursor.fetchall()
    conn.close()

    return [dict(item) for item in stock]


def api_merchant_stock(request):
    """API: ассортимент торговца"""
    stock = get_daily_stock()
    return JsonResponse({'stock': stock, 'date': date.today().isoformat()})


@csrf_exempt
def api_merchant_buy(request):
    """API: купить предмет у торговца"""
    if request.method == 'POST':
        data = json.loads(request.body)
        stock_id = data.get('stock_id')

        from .db_utils import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM merchant_daily_stock WHERE id = ?", (stock_id,))
        item = cursor.fetchone()

        if not item or item['sold_out']:
            conn.close()
            return JsonResponse({'success': False, 'message': 'Товар недоступен'})

        # Здесь проверяем золото игрока и списываем
        # Пока заглушка — просто отмечаем проданным
        cursor.execute("UPDATE merchant_daily_stock SET sold_out = 1 WHERE id = ?", (stock_id,))
        conn.commit()
        conn.close()

        return JsonResponse({'success': True, 'message': 'Предмет куплен!'})

    return JsonResponse({'success': False, 'message': 'Неверный запрос'})

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

def codex(request):
    """Кодекс (база знаний)"""
    return render(request, 'codex.html')

def index(request):
    return render(request, 'index.html')

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

def map_view(request):
    """Карта мира"""
    return render(request, 'map.html')

def load_game(request):
    """Экран загрузки игры"""
    return render(request, 'load_game.html')

def city_view(request):
    """Экран города"""
    return render(request, 'city.html')

def trade_district(request):
    """Торговый район"""
    return render(request, 'trade_district.html')

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

def merchant(request):
    """Торговец"""
    return render(request, 'merchant.html')

def character(request):
    """Экран персонажа"""
    return render(request, 'character.html')
