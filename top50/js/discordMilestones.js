(() => {
    'use strict';

    const KEY = 'lcedit_discord_milestones_v2';
    const defaults = { enabled: false, webhook: '', mention: '' };
    let cfg = { ...defaults };
    const notified = new Map();
    const inFlight = new Set();
    let ready = false;

    try { cfg = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}

    const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
    const fmt2 = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const validWebhook = url => {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' && (u.hostname === 'discord.com' || u.hostname === 'discordapp.com') && u.pathname.includes('/api/webhooks/');
        } catch (_) { return false; }
    };
    const save = () => localStorage.setItem(KEY, JSON.stringify(cfg));

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

    function durationParts(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const days = Math.floor(total / 86400);
        const hours = Math.floor((total % 86400) / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const parts = [];
        if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
        if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
        if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
        if (!parts.length || seconds) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
        return parts.join(', ');
    }

    function signedPercent(change, previousMilestone) {
        if (!Number.isFinite(change) || !Number.isFinite(previousMilestone) || previousMilestone <= 0) return '';
        const percent = (change / previousMilestone) * 100;
        const sign = percent > 0 ? '+' : '';
        const direction = percent > 0 ? 'increase' : 'decrease';
        return `${sign}${fmt2(percent)}% ${direction}`;
    }

    async function send(payload) {
        if (!validWebhook(cfg.webhook)) throw new Error('Discord webhook is not configured.');
        const r = await fetch(cfg.webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error(`Discord returned HTTP ${r.status}`);
    }

    function alertPayload(channel, milestone, rank, previousState) {
        const now = new Date();
        const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const name = channel.name || 'Unknown channel';
        const previousMilestone = previousState ? previousState.milestone : null;
        const duration = previousState ? now.getTime() - previousState.at : 0;
        const change = Number.isFinite(previousMilestone) ? milestone - previousMilestone : 0;
        const percentage = signedPercent(change, previousMilestone);
        const decreasing = change < 0;
        const channelUrl = channel.url || channel.link || channel.channelUrl || '';
        const action = decreasing ? 'dropped below' : 'just hit';
        const description = channelUrl
            ? `[${name}](${channelUrl}) ${action} **${fmt(milestone)} subscribers**`
            : `**${name}** ${action} **${fmt(milestone)} subscribers**`;

        return {
            username: 'Livecountsedit',
            content: cfg.mention || undefined,
            embeds: [{
                author: {
                    name: decreasing ? 'YouTube Subscriber Milestone Lost' : 'YouTube Subscriber Update',
                    icon_url: 'https://cdn.simpleicons.org/youtube/FF0000'
                },
                description,
                url: channelUrl || undefined,
                color: decreasing ? 0xE53935 : 0x00C853,
                thumbnail: channel.image ? { url: channel.image } : undefined,
                fields: [
                    ...(previousMilestone != null ? [{ name: '⏪ Previous milestone', value: `${fmt(previousMilestone)} subscribers`, inline: false }] : []),
                    {
                        name: decreasing ? '⏬ Lost milestone' : '⏩ New milestone',
                        value: `**${fmt(milestone)} subscribers**`,
                        inline: false
                    },
                    ...(previousState ? [{ name: '⏱️ Duration', value: durationParts(duration), inline: false }] : []),
                    ...(percentage ? [{ name: '📊 Percentage Change', value: `**${percentage}**`, inline: false }] : []),
                    {
                        name: 'ℹ️ Information',
                        value: `With this subscriber update, **${name}** is currently at **#${rank}** in the Livecountsedit Top 50.`,
                        inline: false
                    }
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
            if (!c) continue;
            const count = Number(c.count);
            if (!Number.isFinite(count) || count < 0) continue;

            const id = String(c.id || `name:${c.name || 'unknown'}`);
            const milestone = milestoneFor(count);
            const previous = notified.get(id);
            const now = Date.now();

            if (previous == null) {
                notified.set(id, { count, milestone, at: now });
                continue;
            }

            const crossed = milestone !== previous.milestone;

            if (crossed && !inFlight.has(id)) {
                inFlight.add(id);
                try {
                    await send(alertPayload(c, milestone, i + 1, previous));
                    notified.set(id, { count, milestone, at: now });
                } catch (err) {
                    console.error('[Discord Milestones] Failed to send milestone:', err);
                } finally {
                    inFlight.delete(id);
                }
            } else if (count !== previous.count && !inFlight.has(id)) {
                notified.set(id, { ...previous, count });
            }
        }
    }

    function styles() {
        if (document.getElementById('dm-styles')) return;
        const s = document.createElement('style');
        s.id = 'dm-styles';
        s.textContent = `#dm-button{margin-left:4px}#dm-panel{display:none;position:fixed;z-index:100000;right:20px;top:70px;width:min(420px,calc(100vw - 40px));padding:16px;background:#fff;color:#111;border:1px solid #aaa;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:Arial,sans-serif}#dm-panel.open{display:block}#dm-panel h3{margin:0 0 10px}#dm-panel label{display:block;margin:9px 0 4px}#dm-panel input[type=text],#dm-panel input[type=password]{width:100%;box-sizing:border-box;padding:7px}#dm-panel .dm-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}#dm-panel button{padding:7px 10px;cursor:pointer}#dm-status{margin-top:10px;font-size:12px}.dm-note{font-size:12px;opacity:.75}.dm-tiers{font-size:12px;line-height:1.5;margin:10px 0}`;
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
        panel.innerHTML = `<h3>Discord Milestone Notifications</h3><p class="dm-note">Alerts automatically when a channel in the displayed Top 50 crosses a milestone in either direction. The webhook is stored only in this browser, not in GitHub.</p><div class="dm-tiers"><b>Automatic tiers:</b><br>&lt;1K → every 1<br>1K–&lt;10K → every 10<br>10K–&lt;100K → every 100<br>100K–&lt;1M → every 1K<br>1M–&lt;10M → every 10K<br>10M–&lt;100M → every 100K<br>100M–&lt;1B → every 1M</div><label><input id="dm-enabled" type="checkbox" style="width:auto"> Enable notifications</label><label>Discord webhook URL</label><input id="dm-webhook" type="password" placeholder="https://discord.com/api/webhooks/..." autocomplete="off"><label>Optional mention</label><input id="dm-mention" type="text" placeholder="e.g. &lt;@&amp;123456789&gt;"><div class="dm-row"><button id="dm-save">Save</button><button id="dm-test">Send test</button><button id="dm-close">Close</button></div><div id="dm-status"></div>`;
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
            save(); notified.clear(); inFlight.clear();
            status.textContent = 'Saved. Existing milestones will not fire immediately.';
        };
        panel.querySelector('#dm-test').onclick = async () => {
            const url = webhook.value.trim();
            if (!validWebhook(url)) return void (status.textContent = 'Enter a valid Discord webhook URL first.');
            status.textContent = 'Sending test...';
            const old = cfg;
            cfg = { ...cfg, enabled: true, webhook: url, mention: mention.value.trim() };
            try {
                await send({
                    username: 'Livecountsedit',
                    content: cfg.mention || undefined,
                    embeds: [{
                        author: { name: 'YouTube Subscriber Update', icon_url: 'https://cdn.simpleicons.org/youtube/FF0000' },
                        description: '**Example Channel** just hit **20,000,000 subscribers**',
                        color: 0x00C853,
                        thumbnail: { url: 'https://cdn.simpleicons.org/youtube/FF0000' },
                        fields: [
                            { name: '⏪ Previous milestone', value: '19,900,000 subscribers', inline: false },
                            { name: '⏩ New milestone', value: '**20,000,000 subscribers**', inline: false },
                            { name: '⏱️ Duration', value: '17 hours, 35 minutes, 40 seconds', inline: false },
                            { name: '📊 Percentage Change', value: '**+0.50% increase**', inline: false },
                            { name: 'ℹ️ Information', value: 'With this subscriber update, **Example Channel** is currently at **#1** in the Livecountsedit Top 50.', inline: false }
                        ],
                        footer: { text: 'Update powered by Livecountsedit • Today at 07:36' },
                        timestamp: new Date().toISOString()
                    }]
                });
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
