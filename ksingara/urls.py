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
    path('merchant/', game_views.merchant, name='merchant'),
    path('blacksmith/', game_views.blacksmith, name='blacksmith'),
    path('black-market/', game_views.black_market, name='black_market'),
    path('merchant-stock/', game_views.api_merchant_stock, name='api_merchant_stock'),
    path('merchant-buy/', game_views.api_merchant_buy, name='api_merchant_buy'),
    path('tavern/', game_views.tavern, name='tavern'),
    path('kennel/', game_views.kennel, name='kennel'),
    path('brothel/', game_views.brothel, name='brothel'),
    path('admin-district/', game_views.admin_district, name='admin_district'),
    path('living-district/', game_views.living_district, name='living_district'),
    path('circle-of-access/', game_views.circle_of_access, name='circle_of_access'),
    path('circle-of-greats/', game_views.circle_of_greats, name='circle_of_greats'),
    path('circle-of-blades/', game_views.circle_of_blades, name='circle_of_blades'),
    path('weapon-skills/', game_views.weapon_skills, name='weapon_skills'),
    path('training-dummy/', game_views.training_dummy, name='training_dummy'),
    path('blessing-check/', game_views.blessing_check, name='blessing_check'),
    path('blessing-check-magic/', game_views.blessing_check_magic, name='blessing_check_magic'),
    path('load-game/', game_views.load_game, name='load_game'),
    path('character/', game_views.character, name='character'),
    path('codex/', game_views.codex, name='codex'),
    path('admin/', admin.site.urls),
    path('api/', include('game.urls')),
]