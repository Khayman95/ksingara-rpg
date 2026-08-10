from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.shortcuts import render
from .models import Player
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
    """Заглушка для карты (будет дальше)"""
    return HttpResponse("Карта мира — скоро!")
