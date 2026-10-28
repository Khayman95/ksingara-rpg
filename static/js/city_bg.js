// static/js/city_bg.js

(function() {
    const CITY_BACKGROUNDS = {
        'Bergen': 'city_steampunk',
        'Laglou': 'city_magic',
        'Redania': 'city_hybrid',
    };

    // Кэш игрового часа
    let cachedHour = 6;
    let lastFetch = 0;

    async function fetchGameHour() {
        try {
            const response = await fetch('/api/game/time/');
            const data = await response.json();
            cachedHour = data.hour || 6;
            lastFetch = Date.now();
        } catch(e) {
            console.error('Ошибка загрузки времени:', e);
        }
    }

    function getGameHour() {
        // Если данные устарели (> 30 сек) — обновляем
        if (Date.now() - lastFetch > 30000) {
            fetchGameHour();
        }
        return cachedHour;
    }

    async function initCityBg() {
        const bgElement = document.getElementById('bg');
        if (!bgElement) {
            console.warn('Элемент #bg не найден');
            return;
        }

        if (typeof PixelBG === 'undefined') {
            console.warn('PixelBG не загружен');
            return;
        }

        // Загружаем время ДО инициализации фона
        await fetchGameHour();
        console.log('🕐 Стартовое время:', cachedHour);

        const cityId = localStorage.getItem('currentCityId') || 'Bergen';
        const bgLocation = CITY_BACKGROUNDS[cityId] || 'city_magic';

        window.gameBg = PixelBG.mount('#bg', {
            location: bgLocation,
            dayStart: 0,
            nightStart: 10,
            followClock: true,
            fps: 10,
            getHour: getGameHour,
        });

        console.log('✅ Фон:', bgLocation, 'для', cityId, '| час:', cachedHour);

        // Обновляем час каждые 30 секунд
        setInterval(fetchGameHour, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCityBg);
    } else {
        initCityBg();
    }
})();