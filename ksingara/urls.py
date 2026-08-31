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
    path('city/', game_views.city_view, name='city'),
    path('trade-district/', game_views.trade_district, name='trade_district'),
    path('admin-district/', game_views.admin_district, name='admin_district'),
    path('living-district/', game_views.living_district, name='living_district'),
    path('circle-of-access/', game_views.circle_of_access, name='circle_of_access'),
    path('circle-of-greats/', game_views.circle_of_greats, name='circle_of_greats'),
    path('circle-of-bladces/', game_views.circle_of_blades, name='circle_of_blades'),
    path('load-game/', game_views.load_game, name='load_game'),
    path('codex/', game_views.codex, name='codex'),
    path('admin/', admin.site.urls),
    path('api/', include('game.urls')),
]