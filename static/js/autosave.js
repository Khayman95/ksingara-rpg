// static/js/autosave.js

function getActiveSlot() {
    return parseInt(localStorage.getItem('activeSlot') || '1');
}

function setActiveSlot(slot) {
    localStorage.setItem('activeSlot', slot);
}

async function autosave() {
    const slot = getActiveSlot();
    if (!slot) return;

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
        currentScreen: getCurrentScreen(),
    };

    console.log('Автосохранение:', data);

    try {
        await fetch('/api/autosave/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    } catch(e) {
        console.log('Ошибка автосохранения');
    }
}

function getRaceData() {
    try {
        const r = JSON.parse(localStorage.getItem('selectedRace') || '{}');
        return { id: r.id || 'human', name: r.name || 'Человек', stats: r.stats || {} };
    } catch(e) { return { id: 'human', name: 'Человек', stats: {} }; }
}

function getElementData() {
    try {
        const e = JSON.parse(localStorage.getItem('selectedElement') || '{}');
        return { id: e.id || 'fire', name: e.name || 'Огонь' };
    } catch(e) { return { id: 'fire', name: 'Огонь' }; }
}

function getCurrentScreen() {
    const path = window.location.pathname;
    if (path.includes('map')) return 'map';
    if (path.includes('city')) return 'city';
    if (path.includes('trade-district')) return 'trade_district';
    if (path.includes('admin-district')) return 'admin_district';
    if (path.includes('living-district')) return 'living_district';
    return 'map';
}