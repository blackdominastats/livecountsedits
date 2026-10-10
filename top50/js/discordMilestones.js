(() => {
    'use strict';

    const KEY = 'lcedit_discord_milestones_v2';
    const defaults = { enabled: false, webhook: '', mention: '' };
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

    // Automatic milestone tiers:
    // <1K: every 1
    // 1K-<10K: every 10
    // 10K-<100K: every 100
    // 100K-<1M: every 1K
    // 1M-<10M: every 10K
    // 10M-<100M: every 100K
    // 100M-<1B: every 1M
    // 1B+: continue at every 1M until another tier is defined.
    function milestoneStep(count) {
        if (count < 1_000) return 1;
        if (count < 10_000) return 10;
        if (count < 100_000) return 100;
        if (count < 1_000_000) return 1_000;
        if (count < 10_000_000) return 10_000;
        if (count < 100_000_000) return 100_000;
        return 1_000_000;
    }

    function milestoneFor(count) {
        const step = milestoneStep(count);
        return Math.floor(count / step) * step;
    }

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
        const now = new Date();
        const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const name = channel.name || 'Unknown channel';
        const subscribers = fmt(channel.count);
        const milestoneText = fmt(milestone);
        const step = fmt(milestoneStep(Number(channel.count)));

        return {
            username: 'Livecountsedit',
            content: cfg.mention || undefined,
            embeds: [{
                title: '📺 YouTube Subscriber Milestone',
                description: `**${name}** just hit **${milestoneText} subscribers**`,
                color: 0x00C853,
                thumbnail: channel.image ? { url: channel.image } : undefined,
                fields: [
                    { name: '🏆 Milestone', value: `**${milestoneText} subscribers**`, inline: false },
                    { name: '📊 Current Subscribers', value: `${subscribers} subscribers`, inline: true },
                    { name: '🏅 Top 50 Rank', value: `#${rank}`, inline: true },
                    { name: '⚡ Automatic Tier', value: `Every ${step} subscribers`, inline: true }
                ],
                footer: { text: `Update powered by Livecountsedit • Today at ${time}` },
                timestamp: now.toISOString()
            }]
        };
    }

    async function check() {
        if (!cfg.enabled || !validWebhook(cfg.webhook)) return;
        if (typeof data === 'undefined' || !data || !Array.isArray(data.data)) return;

        const channels = data.data.slice(0, 50);
        for (let i = 0; i < channels.length; i++) {
            const c = channels[i];
            if (!c || !c.id) continue;
            const count = Number(c.count);
            if (!Number.isFinite(count) || count < 0) continue;

            const milestone = milestoneFor(count);
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
        s.textContent = `#dm-button{margin-left:4px}#dm-panel{display:none;position:fixed;z-index:100000;right:20px;top:70px;width:min(420px,calc(100vw - 40px));padding:16px;background:#fff;color:#111;border:1px solid #aaa;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:Arial,sans-serif}#dm-panel.open{display:block}#dm-panel h3{margin:0 0 10px}#dm-panel label{display:block;margin:9px 0 4px}#dm-panel input[type=text],#dm-panel input[type=password]{width:100%;box-sizing:border-box;padding:7px}#dm-panel .dm-row{display:flex;gap:8px;margin-top:10px}#dm-panel button{padding:7px 10px;cursor:pointer}#dm-status{margin-top:10px;font-size:12px}.dm-note{font-size:12px;opacity:.75}.dm-tiers{font-size:12px;line-height:1.5;margin:10px 0}`;
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
        panel.innerHTML = `<h3>Discord Milestone Notifications</h3><p class="dm-note">Alerts automatically when a channel in the displayed Top 50 crosses a milestone. The webhook is stored only in this browser, not in GitHub.</p><div class="dm-tiers"><b>Automatic tiers:</b><br>&lt;1K → every 1<br>1K–&lt;10K → every 10<br>10K–&lt;100K → every 100<br>100K–&lt;1M → every 1K<br>1M–&lt;10M → every 10K<br>10M–&lt;100M → every 100K<br>100M–&lt;1B → every 1M</div><label><input id="dm-enabled" type="checkbox" style="width:auto"> Enable notifications</label><label>Discord webhook URL</label><input id="dm-webhook" type="password" placeholder="https://discord.com/api/webhooks/..." autocomplete="off"><label>Optional mention</label><input id="dm-mention" type="text" placeholder="e.g. &lt;@&amp;123456789&gt;"><div class="dm-row"><button id="dm-save">Save</button><button id="dm-test">Send test</button><button id="dm-close">Close</button></div><div id="dm-status"></div>`;
        document.body.appendChild(panel);

        const enabled = panel.querySelector('#dm-enabled');
        const webhook = panel.querySelector('#dm-webhook');
        const mention = panel.querySelector('#dm-mention');
        const status = panel.querySelector('#dm-status');
        enabled.checked = cfg.enabled; webhook.value = cfg.webhook; mention.value = cfg.mention;

        button.onclick = () => panel.classList.toggle('open');
        panel.querySelector('#dm-close').onclick = () => panel.classList.remove('open');
        panel.querySelector('#dm-save').onclick = () => {
            if (enabled.checked && !validWebhook(webhook.value.trim())) return void (status.textContent = 'Enter a valid Discord webhook URL.');
            cfg = { enabled: enabled.checked, webhook: webhook.value.trim(), mention: mention.value.trim() };
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
                await send({ username: 'Livecountsedit', content: cfg.mention || undefined, embeds: [{ title: '📺 YouTube Subscriber Milestone', description: '**Example Channel** just hit **1,000,000 subscribers**', color: 0x00C853, fields: [{ name: '🏆 Milestone', value: '**1,000,000 subscribers**', inline: false }, { name: '📊 Current Subscribers', value: '1,000,000 subscribers', inline: true }, { name: '🏅 Top 50 Rank', value: '#1', inline: true }, { name: '⚡ Automatic Tier', value: 'Every 10,000 subscribers', inline: true }], footer: { text: 'Update powered by Livecountsedit • Discord milestone alert' }, timestamp: new Date().toISOString() }] });
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
