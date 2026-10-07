(() => {
    const KEY = 'akshatmittalcompare-growth-rate-history';
    const SAMPLE_INTERVAL = 60000;
    const WINDOW = 24 * 60 * 60 * 1000;
    let history = [];
    let lastSample = 0;

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
        if (!base) return null;
        const current = Number(data.data[side].getDisplayedCount());
        const baseCount = side === 0 ? base.left : base.right;
        const elapsed = (Date.now() - base.time) / 60000;
        return elapsed > 0 ? (current - baseCount) / elapsed * (windowMs / 60000) : null;
    }

    function format(value) {
        if (value === null || !Number.isFinite(value)) return 'Collecting...';
        return `${value >= 0 ? '+' : ''}${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}`;
    }

    function render() {
        const panel = document.getElementById('growthRatePanel');
        const body = document.getElementById('growthRateBody');
        const toggle = document.getElementById('growthRateToggle');
        if (!panel || !body || !toggle || !window.data?.data) return;
        panel.style.display = toggle.checked ? '' : 'none';
        if (!toggle.checked) return;
        const windows = [['Per minute', 60000], ['Per hour', 3600000], ['Per day', 86400000]];
        const leftName = data.data[0].name || 'Left';
        const rightName = data.data[1].name || 'Right';
        body.innerHTML = windows.map(([label, ms]) => `<tr><td><strong>${label}</strong></td><td>${leftName}: ${format(rate(0, ms))}</td><td>${rightName}: ${format(rate(1, ms))}</td></tr>`).join('');
    }

    function init() {
        loadHistory();
        const menu = document.querySelector('.menu');
        if (!menu || document.getElementById('growthRatePanel') || !window.data?.data) return false;
        const card = document.createElement('div');
        card.className = 'container';
        card.style.cssText = 'margin-top:20px;margin-bottom:20px;';
        card.innerHTML = `<div class="card main-card"><div class="card-block"><label style="display:block;cursor:pointer;margin:0 0 10px;"><input type="checkbox" id="growthRateToggle" style="margin-right:8px;">Show growth rates</label><div id="growthRatePanel" style="display:none;"><h4 style="margin-top:8px;">Subscriber Growth</h4><div class="table-responsive"><table style="width:100%;line-height:1.9;"><tbody id="growthRateBody"></tbody></table></div><small style="opacity:.7;">Refreshes every 2 seconds.</small></div></div></div>`;
        menu.parentNode.insertBefore(card, menu);
        const toggle = document.getElementById('growthRateToggle');
        toggle.checked = localStorage.getItem('akshatmittalcompare-show-growth-rates') === '1';
        toggle.addEventListener('change', () => {
            localStorage.setItem('akshatmittalcompare-show-growth-rates', toggle.checked ? '1' : '0');
            render();
        });
        setInterval(() => { sample(); render(); }, 2000);
        sample(true);
        render();
        return true;
    }

    function waitForCounter() {
        if (init()) return;
        setTimeout(waitForCounter, 250);
    }

    if (document.readyState === 'complete') waitForCounter();
    else window.addEventListener('load', waitForCounter, { once: true });
})();
