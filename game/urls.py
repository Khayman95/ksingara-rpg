from django.urls import path
from . import views

urlpatterns = [
    path('status/', views.api_status, name='api_status'),
    path('new_game/', views.api_new_game, name='api_new_game'),
    path('player/<int:player_id>/stats/', views.api_player_stats, name='api_player_stats'),
]