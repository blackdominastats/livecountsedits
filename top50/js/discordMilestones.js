(() => {
    'use strict';

    const KEY = 'lcedit_discord_milestones_v1';
    const defaults = { enabled: false, webhook: '', step: 1000000, mention: '' };
    let cfg = { ...defaults };
    const notified = new Map();
    let ready = false;

    try { cfg = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}

    const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
    const validWebhook = url => {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' && u.hostname === 'discord.com' && u.pathname.includes('/api/webhooks/');
        } catch (_) { return false; }
    };
    const save = () => localStorage.setItem(KEY, JSON.stringify(cfg));

    async function send(payload) {
        if (!validWebhook(cfg.webhook)) return;
        const r = await fetch(cfg.webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error(`Discord returned HTTP ${r.status}`);
    }

    function alertPayload(channel, milestone, rank) {
        return {
            username: 'Livecountsedit',
            content: cfg.mention || undefined,
            embeds: [{
                title: '🏆 Top 50 Milestone Reached',
                description: `**${channel.name || 'Unknown channel'}** just reached **${fmt(milestone)} subscribers**.`,
                color: 0x5865F2,
                thumbnail: channel.image ? { url: channel.image } : undefined,
                fields: [
                    { name: 'Subscribers', value: fmt(channel.count), inline: true },
                    { name: 'Rank', value: `#${rank}`, inline: true },
                    { name: 'Milestone', value: fmt(milestone), inline: true }
                ],
                footer: { text: 'Livecountsedit • Discord milestone alert' },
                timestamp: new Date().toISOString()
            }]
        };
    }

    async function check() {
        if (!cfg.enabled || !validWebhook(cfg.webhook)) return;
        if (typeof data === 'undefined' || !data || !Array.isArray(data.data)) return;
        const step = Number(cfg.step);
        if (!Number.isFinite(step) || step <= 0) return;

        const channels = data.data.slice(0, 50);
        for (let i = 0; i < channels.length; i++) {
            const c = channels[i];
            if (!c || !c.id) continue;
            const count = Number(c.count);
            if (!Number.isFinite(count) || count < step) continue;

            const milestone = Math.floor(count / step) * step;
            const id = String(c.id);
            const previous = notified.get(id);

            // Establish the current milestone without sending a startup notification.
            if (previous == null) {
                notified.set(id, milestone);
                continue;
            }

            if (milestone > previous) {
                notified.set(id, milestone);
                try { await send(alertPayload(c, milestone, i + 1)); }
                catch (err) { console.error('[Discord Milestones]', err); }
            }
        }
    }

    function styles() {
        if (document.getElementById('dm-styles')) return;
        const s = document.createElement('style');
        s.id = 'dm-styles';
        s.textContent = `
#dm-button{margin-left:4px}#dm-panel{display:none;position:fixed;z-index:100000;right:20px;top:70px;width:min(420px,calc(100vw - 40px));padding:16px;background:#fff;color:#111;border:1px solid #aaa;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:Arial,sans-serif}#dm-panel.open{display:block}#dm-panel h3{margin:0 0 10px}#dm-panel label{display:block;margin:9px 0 4px}#dm-panel input[type=text],#dm-panel input[type=password],#dm-panel input[type=number]{width:100%;box-sizing:border-box;padding:7px}#dm-panel .dm-row{display:flex;gap:8px;margin-top:10px}#dm-panel button{padding:7px 10px;cursor:pointer}#dm-status{margin-top:10px;font-size:12px}.dm-note{font-size:12px;opacity:.75}`;
        document.head.appendChild(s);
    }

    function ui() {
        if (ready) return;
        const host = document.querySelector('.topSettings') || document.getElementById('settings');
        if (!host) return;
        styles();

        const button = document.createElement('button');
        button.id = 'dm-button';
        button.textContent = 'Discord Milestones';
        host.appendChild(button);

        const panel = document.createElement('div');
        panel.id = 'dm-panel';
        panel.innerHTML = `
            <h3>Discord Milestone Notifications</h3>
            <p class="dm-note">Alerts when a channel in the displayed Top 50 crosses a new milestone. The webhook is stored only in this browser, not in GitHub.</p>
            <label><input id="dm-enabled" type="checkbox" style="width:auto"> Enable notifications</label>
            <label>Discord webhook URL</label><input id="dm-webhook" type="password" placeholder="https://discord.com/api/webhooks/..." autocomplete="off">
            <label>Milestone every (subscribers)</label><input id="dm-step" type="number" min="1" step="1" placeholder="1000000">
            <label>Optional mention</label><input id="dm-mention" type="text" placeholder="e.g. &lt;@&amp;123456789&gt;">
            <div class="dm-row"><button id="dm-save">Save</button><button id="dm-test">Send test</button><button id="dm-close">Close</button></div>
            <div id="dm-status"></div>`;
        document.body.appendChild(panel);

        const enabled = panel.querySelector('#dm-enabled');
        const webhook = panel.querySelector('#dm-webhook');
        const step = panel.querySelector('#dm-step');
        const mention = panel.querySelector('#dm-mention');
        const status = panel.querySelector('#dm-status');
        enabled.checked = cfg.enabled; webhook.value = cfg.webhook; step.value = cfg.step; mention.value = cfg.mention;

        button.onclick = () => panel.classList.toggle('open');
        panel.querySelector('#dm-close').onclick = () => panel.classList.remove('open');
        panel.querySelector('#dm-save').onclick = () => {
            const n = Number(step.value);
            if (!Number.isFinite(n) || n <= 0) return void (status.textContent = 'Milestone size must be greater than 0.');
            if (enabled.checked && !validWebhook(webhook.value.trim())) return void (status.textContent = 'Enter a valid Discord webhook URL.');
            cfg = { enabled: enabled.checked, webhook: webhook.value.trim(), step: n, mention: mention.value.trim() };
            save(); notified.clear();
            status.textContent = 'Saved. Existing milestones will not fire immediately.';
        };
        panel.querySelector('#dm-test').onclick = async () => {
            const url = webhook.value.trim();
            if (!validWebhook(url)) return void (status.textContent = 'Enter a valid Discord webhook URL first.');
            status.textContent = 'Sending test...';
            const old = cfg;
            cfg = { ...cfg, enabled: true, webhook: url, mention: mention.value.trim() };
            try {
                await send({ username: 'Livecountsedit', content: cfg.mention || undefined, embeds: [{ title: '🔔 Discord Milestone Test', description: 'Your Livecountsedit Top 50 milestone notifications are connected.', color: 0x5865F2, footer: { text: 'Livecountsedit • Discord milestone alert' }, timestamp: new Date().toISOString() }] });
                status.textContent = 'Test sent successfully.';
            } catch (err) { status.textContent = `Test failed: ${err.message}`; }
            cfg = old;
        };
        ready = true;
    }

    const timer = setInterval(() => {
        try { ui(); check(); } catch (err) { console.error('[Discord Milestones]', err); }
    }, 1000);
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
})();
