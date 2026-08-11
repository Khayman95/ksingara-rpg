// static/js/navbar.js

document.addEventListener('DOMContentLoaded', function() {
    const navbar = document.createElement('div');
    navbar.className = 'game-navbar';
    navbar.innerHTML = `
        <button onclick="goToMenu()" title="В меню">🏠</button>
        <button onclick="saveAndContinue()" title="Сохранить">💾</button>
        <button onclick="openCodex()" title="Кодекс">📖</button>
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
        body {
            padding-top: 10px;
        }
    `;
    document.head.appendChild(style);
});

async function goToMenu() {
    // Принудительно сохраняем ТЕКУЩИЙ экран перед уходом
    const currentScreen = getCurrentScreen();

    const slot = getActiveSlot();
    const race = getRaceData();
    const element = getElementData();

    const data = {
        slot: slot,
        name: localStorage.getItem('playerName') || 'Герой',
        gender: localStorage.getItem('selectedGender') || 'male',
        race: race.id || 'human',
        raceName: race.name || 'Человек',
        element: element.id || 'fire',
        elementName: element.name || 'Огонь',
        stats: race.stats || {},
        playerX: parseInt(localStorage.getItem('playerX') || '13'),
        playerY: parseInt(localStorage.getItem('playerY') || '13'),
        citySelected: localStorage.getItem('citySelected') === 'true',
        currentScreen: currentScreen,  // ← Сохраняем ЭТОТ экран, а не save-game
    };

    await fetch('/api/autosave/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });

    window.location.href = '/';
}

async function saveAndContinue() {
    await autosave();
    const btn = document.querySelector('.game-navbar button:nth-child(2)');
    btn.style.background = '#2a5a2a';
    setTimeout(() => btn.style.background = 'rgba(30, 30, 50, 0.8)', 500);
}

function openCodex() {
    window.location.href = '/codex/';
}