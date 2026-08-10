from django.contrib import admin
from django.urls import path, include
from game import views as game_views

urlpatterns = [
    path('', game_views.index, name='index'),
    path('intro/', game_views.intro, name='intro'),
    path('race-select/', game_views.race_select, name='race_select'),
    path('element-select/', game_views.element_select, name='element_select'),
    path('finalize/', game_views.finalize, name='finalize'),        # ← Эта строка
    path('save-game/', game_views.save_game, name='save_game'),
    path('map/', game_views.map_view, name='map'),
    path('admin/', admin.site.urls),
    path('api/', include('game.urls')),
]