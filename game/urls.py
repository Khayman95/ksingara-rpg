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
    path('merchant-stock/', views.api_merchant_stock, name='api_merchant_stock'),
    path('merchant-buy/', views.api_merchant_buy, name='api_merchant_buy'),
    path('merchant-reset/', views.api_merchant_reset, name='api_merchant_reset'),
    path('blacksmith-recipes/', views.api_blacksmith_recipes, name='api_blacksmith_recipes'),
    path('blacksmith-craft/', views.api_blacksmith_craft, name='api_blacksmith_craft'),
    path('blacksmith-learn/', views.api_blacksmith_learn_recipe, name='api_blacksmith_learn_recipe'),
    path('world-market/', views.api_world_market, name='api_world_market'),
    path('world-market-sell/', views.api_world_market_sell, name='api_world_market_sell'),
    path('world-market-buy/', views.api_world_market_buy, name='api_world_market_buy'),
    path('currencies/', views.api_currencies, name='api_currencies'),
    path('exchange-currency/', views.api_exchange_currency, name='api_exchange_currency'),
]