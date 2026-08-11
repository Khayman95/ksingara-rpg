from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.shortcuts import render
from .db_utils import get_db_connection
from .models import Player
from datetime import datetime
import json


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
    return HttpResponse("Торговый район — скоро!")

def admin_district(request):
    return HttpResponse("Административный район — скоро!")

def living_district(request):
    return HttpResponse("Жилой район — скоро!")