from django.urls import path
from . import views

urlpatterns = [
    path('status/', views.api_status, name='api_status'),
    path('new_game/', views.api_new_game, name='api_new_game'),
    path('player/<int:player_id>/stats/', views.api_player_stats, name='api_player_stats'),
    path('map-data/', views.api_map_data, name='api_map_data'),
    path('save/<int:slot>/', views.api_save_game, name='api_save_game'),
    path('load/<int:slot>/', views.api_load_game, name='api_load_game'),
    path('saves/', views.api_all_saves, name='api_all_saves'),
    path('delete-save/<int:slot>/', views.api_delete_save, name='api_delete_save'),
    path('autosave/', views.api_autosave, name='api_autosave'),
]