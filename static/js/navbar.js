// static/js/navbar.js

document.addEventListener('DOMContentLoaded', function() {
    const navbar = document.createElement('div');
    navbar.className = 'game-navbar';
    navbar.innerHTML = `
        <button onclick="goToMenu()" title="В меню">🏠</button>
        <button onclick="saveAndContinue()" title="Сохранить">💾</button>
        <button onclick="openCharacter()" title="Персонаж">👤</button>
        <button onclick="openCodex()" title="Кодекс">📖</button>
        <button onclick="resetDailyStock()" title="Обновить ассортимент (DevMode)">🔄</button>
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

async function resetDailyStock() {
    try {
        const response = await fetch('/api/merchant-reset/', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            alert('🔄 Ассортимент обновлён!');
            location.reload();
        }
    } catch(e) {
        alert('🔄 Ассортимент обновлён (локально)');
        location.reload();
    }
}

async function goToMenu() {
    const currentPath = window.location.pathname;

    // Не сохраняем /character/ как lastScreen
    if (!currentPath.includes('/character/')) {
        localStorage.setItem('lastScreen', currentPath);
    }

    await autosave();
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

function openCharacter() {
    // Сохраняем текущий экран перед уходом
    const currentPath = window.location.pathname;
    localStorage.setItem('returnScreen', currentPath);
    window.location.href = '/character/';
}
