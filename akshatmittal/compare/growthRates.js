(() => {
    const KEY = 'akshatmittalcompare-growth-rate-history';
    const SAMPLE_INTERVAL = 60000;
    const WINDOW = 24 * 60 * 60 * 1000;
    const SETTING_PATH = 'showGrowthRates';
    let history = [];
    let lastSample = 0;
    let started = false;

    function loadHistory() {
        try { history = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { history = []; }
        if (!Array.isArray(history)) history = [];
        const cutoff = Date.now() - WINDOW;
        history = history.filter(x => x && Number.isFinite(x.time) && x.time >= cutoff);
        lastSample = history.length ? history[history.length - 1].time : 0;
    }

    function sample(force = false) {
        if (!window.data?.data || data.data.length < 2) return;
        const now = Date.now();
        if (!force && lastSample && now - lastSample < SAMPLE_INTERVAL) return;
        const left = Number(data.data[0].getDisplayedCount());
        const right = Number(data.data[1].getDisplayedCount());
        if (!Number.isFinite(left) || !Number.isFinite(right)) return;
        history.push({ time: now, left, right });
        lastSample = now;
        history = history.filter(x => x.time >= now - WINDOW);
        try { localStorage.setItem(KEY, JSON.stringify(history)); } catch (_) {}
    }

    function baseline(windowMs) {
        const now = Date.now();
        const target = now - windowMs;
        let best = null;
        let distance = Infinity;
        for (const item of history) {
            const age = now - item.time;
            if (age < windowMs * 0.9) continue;
            const d = Math.abs(item.time - target);
            if (d < distance) { best = item; distance = d; }
        }
        return best;
    }

    function rate(side, windowMs) {
        const base = baseline(windowMs);
        if (!base || !window.data?.data) return null;
        const current = Number(data.data[side].getDisplayedCount());
        const baseCount = side === 0 ? base.left : base.right;
        const elapsed = (Date.now() - base.time) / 60000;
        return elapsed > 0 ? (current - baseCount) / elapsed * (windowMs / 60000) : null;
    }

    function format(value) {
        if (value === null || !Number.isFinite(value)) return 'Collecting...';
        const magnitude = Math.abs(value) >= 100 ? Math.abs(value).toFixed(0) : Math.abs(value).toFixed(1);
        return `${value > 0 ? '+' : value < 0 ? '-' : ''}${magnitude}`;
    }

    function showEnabled() {
        return !!data?.akshatmittalSettings?.[SETTING_PATH];
    }

    function render() {
        const panel = document.getElementById('growthRatePanel');
        const body = document.getElementById('growthRateBody');
        if (!panel || !body || !window.data?.data) return;
        panel.style.display = showEnabled() ? '' : 'none';
        if (!showEnabled()) return;
        const windows = [['Per minute', 60000], ['Per hour', 3600000], ['Per day', 86400000]];
        const leftName = data.data[0].name || 'Left';
        const rightName = data.data[1].name || 'Right';
        body.innerHTML = windows.map(([label, ms]) => `<tr><td><strong>${label}</strong></td><td>${leftName}: ${format(rate(0, ms))}</td><td>${rightName}: ${format(rate(1, ms))}</td></tr>`).join('');
    }

    function addTechnicalMenuItem() {
        if (typeof MENU === 'undefined' || !Array.isArray(MENU.tabs)) return false;
        const technical = MENU.tabs.find(x => x.title === 'Technical Settings');
        if (!technical || !Array.isArray(technical.items)) return false;
        if (technical.items.some(x => x.path === 'data.akshatmittalSettings.' + SETTING_PATH)) return false;
        technical.items.push({
            title: 'Show per minute, per hour and per day growth rates',
            value: !!data?.akshatmittalSettings?.[SETTING_PATH],
            type: 'checkbox',
            path: 'data.akshatmittalSettings.' + SETTING_PATH
        });
        return true;
    }

    function ensureRatePanel() {
        const menu = document.querySelector('.menu');
        if (!menu || document.getElementById('growthRatePanel') || !window.data?.data) return;
        const card = document.createElement('div');
        card.className = 'container';
        card.style.cssText = 'margin-top:20px;margin-bottom:20px;';
        card.innerHTML = `<div class="card main-card"><div class="card-block"><div id="growthRatePanel" style="display:none;"><h4 style="margin-top:0;">Subscriber Growth</h4><div class="table-responsive"><table style="width:100%;line-height:1.9;"><tbody id="growthRateBody"></tbody></table></div></div></div></div>`;
        menu.parentNode.insertBefore(card, menu);
    }

    async function init() {
        if (started || !window.data?.data) return false;
        started = true;
        if (!data.akshatmittalSettings) data.akshatmittalSettings = {};
        if (typeof data.akshatmittalSettings[SETTING_PATH] !== 'boolean') data.akshatmittalSettings[SETTING_PATH] = false;
        loadHistory();
        ensureRatePanel();
        sample(true);
        render();
        setInterval(() => {
            sample();
            render();
        }, 2000);
        return true;
    }

    function installAfterMainLoad() {
        const originalOnload = window.onload;
        window.onload = async function (...args) {
            if (originalOnload) await originalOnload.apply(this, args);
            if (!window.data?.data) return;
            if (!data.akshatmittalSettings) data.akshatmittalSettings = {};
            if (typeof data.akshatmittalSettings[SETTING_PATH] !== 'boolean') data.akshatmittalSettings[SETTING_PATH] = false;
            const added = addTechnicalMenuItem();
            if (added && typeof drawMenu === 'function') {
                drawMenu(MENU, document.querySelector('.tabs'), document.querySelector('.tab-stuff'), document.querySelector('.tab-controls'));
                if (typeof afterDrawingMenu === 'function') afterDrawingMenu();
            }
            await init();
        };
    }

    installAfterMainLoad();
})();
