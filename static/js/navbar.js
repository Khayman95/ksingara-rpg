document.addEventListener('DOMContentLoaded', function() {
    const navbar = document.createElement('div');
    navbar.className = 'game-navbar';
    navbar.innerHTML = `
        <div class="game-time" id="gameTime">🕐 ...</div>
        <button onclick="goToMenu()" title="В меню">🏠</button>
        <button onclick="saveAndContinue()" title="Сохранить">💾</button>
        <button onclick="openCharacter()" title="Персонаж">👤</button>
        <button onclick="openCodex()" title="Кодекс">📖</button>
        <button onclick="logoutFromGame()" title="Выйти" class="logout-btn">🚪</button>
    `;

    document.body.insertBefore(navbar, document.body.firstChild);

    const style = document.createElement('style');
    style.textContent = `
        .game-navbar {
            position: fixed;
            top: 0;
            right: 0;
            display: flex;
            gap: 5px;
            padding: 8px 12px;
            background: rgba(10, 10, 15, 0.85);
            border-radius: 0 0 0 12px;
            z-index: 1000;
            align-items: center;
        }
        .game-time {
            padding: 6px 12px;
            background: rgba(30, 30, 50, 0.8);
            border-radius: 6px;
            font-size: 11px;
            color: #f0c040;
            font-weight: bold;
            white-space: nowrap;
            margin-right: auto;
        }
        .game-navbar button {
            width: 36px;
            height: 36px;
            border: none;
            border-radius: 6px;
            font-size: 18px;
            cursor: pointer;
            background: rgba(30, 30, 50, 0.8);
            transition: background 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .game-navbar button:hover {
            background: rgba(50, 50, 80, 0.9);
        }
        .game-navbar .logout-btn {
            background: rgba(110, 42, 42, 0.8);
        }
        .game-navbar .logout-btn:hover {
            background: rgba(140, 50, 50, 0.9);
        }
        body {
            padding-top: 50px;
        }
    `;
    document.head.appendChild(style);

    updateGameTime();
    setInterval(updateGameTime, 5000);
});


// Глобальные переменные
let gameTimeData = null;
let gameTimeLastFetch = 0;
let gameTimeLastSeconds = 0;

async function updateGameTime() {
    try {
        const response = await fetch('/api/game/time/');
        const time = await response.json();

        gameTimeData = time;
        gameTimeLastFetch = Date.now();
        gameTimeLastSeconds = time.total_seconds || 0;

        renderGameTime();
    } catch(e) {
        console.error('Ошибка загрузки времени:', e);
    }
}

function renderGameTime() {
    const el = document.getElementById('gameTime');
    if (!el || !gameTimeData) return;

    const elapsed = Math.floor((Date.now() - gameTimeLastFetch) / 1000);
    const totalSeconds = gameTimeLastSeconds + elapsed;

    const t = secondsToGameTime(totalSeconds);

    if (t.is_timeless) {
        el.textContent = `⚠️ День Безвременья`;
        el.style.color = '#ff4444';
    } else {
        el.textContent = `${t.phase} ${t.time_string} | ${t.day_name} | ${t.month_name} ${t.day_in_month}, ${t.year} г.`;
        el.style.color = t.is_day ? '#f0c040' : '#8888ff';
    }
}

function secondsToGameTime(totalSeconds) {
    const SECONDS_PER_MINUTE = 100;
    const SECONDS_PER_HOUR = 10000;
    const SECONDS_PER_DAY = 200000;
    const DAYS_PER_WEEK = 10;
    const DAYS_PER_MONTH = 40;
    const DAYS_PER_YEAR = 360;
    const DAYS_PER_CYCLE = 1441;

    const DAY_NAMES = ["Пирос", "Гидрос", "Аэрос", "Террос", "Ноктис",
                       "Фульгрис", "Гелиос", "Лумис", "Витрис", "Анима"];
    const MONTH_NAMES = ["Игнис", "Акванис", "Вентрис", "Умбрис", "Астралис",
                         "Гласис", "Темпестис", "Кристаллис", "Фениксис"];

    const secondsInDay = totalSeconds % SECONDS_PER_DAY;
    const hour = Math.floor(secondsInDay / SECONDS_PER_HOUR);
    const minute = Math.floor((secondsInDay % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const second = Math.floor(secondsInDay % SECONDS_PER_MINUTE);

    const totalDays = Math.floor(totalSeconds / SECONDS_PER_DAY);

    const cycles = Math.floor(totalDays / DAYS_PER_CYCLE);
    const daysInCycle = totalDays % DAYS_PER_CYCLE;

    let yearInCycle = Math.floor(daysInCycle / DAYS_PER_YEAR);
    if (yearInCycle > 3) yearInCycle = 3;

    const daysInYear = daysInCycle - (yearInCycle * DAYS_PER_YEAR);
    const year = cycles * 4 + yearInCycle + 1;

    const isTimeless = (yearInCycle === 3) && (daysInYear >= DAYS_PER_YEAR);

    if (isTimeless) {
        return {
            hour, minute, second,
            time_string: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
            day_name: "День Безвременья",
            month_name: "—",
            day_in_month: 0,
            year,
            is_day: hour < 10,
            is_night: hour >= 10,
            is_timeless: true,
            phase: "⚠️ Безвременье"
        };
    }

    const month = Math.floor(daysInYear / DAYS_PER_MONTH);
    const dayInMonth = (daysInYear % DAYS_PER_MONTH) + 1;
    const dayOfWeek = (daysInYear % DAYS_PER_WEEK);
    const dayName = DAY_NAMES[dayOfWeek];

    return {
        hour, minute, second,
        time_string: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
        day_name: dayName,
        month_name: MONTH_NAMES[month],
        day_in_month: dayInMonth,
        year,
        is_day: hour < 10,
        is_night: hour >= 10,
        is_timeless: false,
        phase: hour < 10 ? "☀️ День" : "🌙 Ночь"
    };
}


// ============ СОХРАНЕНИЕ И НАВИГАЦИЯ ============

async function goToMenu() {
    try {
        await fetch('/api/player/save/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({current_screen: getCurrentScreenName()}),
        });
    } catch(e) { console.log('Save error:', e); }
    window.location.href = '/';
}

async function saveAndContinue() {
    try {
        await fetch('/api/player/save/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({current_screen: getCurrentScreenName()}),
        });
        const btn = document.querySelector('.game-navbar button:nth-child(2)');
        if (btn) {
            btn.style.background = '#2a5a2a';
            setTimeout(() => btn.style.background = 'rgba(30, 30, 50, 0.8)', 500);
        }
    } catch(e) { console.log('Save error:', e); }
}

function openCharacter() {
    localStorage.setItem('returnScreen', window.location.pathname);
    window.location.href = '/character/';
}

function openCodex() {
    window.location.href = '/codex/';
}

async function logoutFromGame() {
    if (!confirm('Выйти из аккаунта?')) return;
    try {
        await fetch('/api/player/save/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({current_screen: getCurrentScreenName()}),
        });
    } catch(e) { console.log('Save error:', e); }
    window.location.href = '/logout/';
}


// ============ ОПРЕДЕЛЕНИЕ ЭКРАНА ============

function getCurrentScreenName() {
    const path = window.location.pathname;

    if (path.includes('blessing-check-magic')) return 'blessing_check_magic';
    if (path.includes('blessing-check')) return 'blessing_check';
    if (path.includes('circle-of-blades')) return 'circle_of_blades';
    if (path.includes('circle-of-greats')) return 'circle_of_greats';
    if (path.includes('circle-of-access')) return 'circle_of_access';
    if (path.includes('weapon-skills')) return 'weapon_skills';
    if (path.includes('training-dummy')) return 'training_dummy';
    if (path.includes('trade-district')) return 'trade_district';
    if (path.includes('living-district')) return 'living_district';
    if (path.includes('admin-district')) return 'admin_district';  // ← ДЕФИС
    if (path.includes('black-market')) return 'black_market';
    if (path.includes('blacksmith')) return 'blacksmith';
    if (path.includes('merchant')) return 'merchant';
    if (path.includes('tavern')) return 'tavern';
    if (path.includes('brothel')) return 'brothel';
    if (path.includes('kennel')) return 'kennel';
    if (path.includes('spell-library')) return 'spell_library';   // ← ДЕФИС
    if (path.includes('achievements')) return 'achievements';
    if (path.includes('sell-items')) return 'sell_items';         // ← ДЕФИС
    if (path.includes('join-beyonders')) return 'join_beyonders'; // ← ДЕФИС
    if (path.includes('beyond-barrier')) return 'beyond_barrier'; // ← ДЕФИС
    if (path.includes('character')) return 'character';
    if (path.includes('codex')) return 'codex';
    if (path.includes('map')) return 'map';
    if (path.includes('city')) return 'city';
    return 'map';
}