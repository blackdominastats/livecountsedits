(() => {
    'use strict';

    const KEY = 'lcedit_discord_milestones_v2';
    const STATE_KEY = 'lcedit_discord_milestone_state_v1';
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

    function saveState() {
        try {
            const state = {};
            notified.forEach((value, key) => { state[key] = value; });
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (_) {}
    }

    try {
        const savedState = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        Object.entries(savedState).forEach(([key, value]) => {
            if (value && Number.isFinite(Number(value.milestone)) && Number.isFinite(Number(value.at))) {
                notified.set(key, {
                    count: Number(value.count) || 0,
                    milestone: Number(value.milestone),
                    at: Number(value.at),
                    durationMs: Number(value.durationMs) || 0,
                    previousMilestone: Number(value.previousMilestone) || 0
                });
            }
        });
    } catch (_) {}

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

    function discordTimestamp(ms, style) {
        return `<t:${Math.floor(ms / 1000)}:${style}>`;
    }

    function averageValues(change, durationMs) {
        if (!Number.isFinite(change) || change === 0 || !Number.isFinite(durationMs) || durationMs <= 0) return null;
        return {
            perDay: change / (durationMs / 86400000),
            perHour: change / (durationMs / 3600000),
            perMinute: change / (durationMs / 60000)
        };
    }

    function averageComparison(currentValues, previousValues) {
        if (!currentValues || !previousValues || !Number.isFinite(previousValues.perDay)) return null;
        const delta = currentValues.perDay - previousValues.perDay;
        if (!Number.isFinite(delta) || currentValues.perDay === 0) return null;
        const percent = Math.abs(delta / currentValues.perDay * 100);
        return {
            delta,
            percent,
            direction: delta < 0 ? 'decrease' : 'increase'
        };
    }

    function averageLines(values, previousValues) {
        if (!values) return '';
        const comparison = averageComparison(values, previousValues);
        const line = (value, previousKey) => {
            let suffix = '';
            if (previousValues && Number.isFinite(previousValues[previousKey])) {
                const delta = value - previousValues[previousKey];
                suffix = ` ***(${delta >= 0 ? '+' : ''}${fmt(delta)})***`;
            }
            return `**${fmt2(value)}** subscribers per ${previousKey === 'perDay' ? 'day' : previousKey === 'perHour' ? 'hour' : 'minute'}${suffix}`;
        };
        return [
            line(values.perDay, 'perDay'),
            line(values.perHour, 'perHour'),
            line(values.perMinute, 'perMinute')
        ].join('\n');
    }

    function subscriberComparison(values, previousValues) {
        const comparison = averageComparison(values, previousValues);
        if (!comparison) return '';
        return `${comparison.direction === 'decrease' ? '⏬' : '⏫'} ${fmt2(comparison.percent)}% ${comparison.direction}`;
    }

    function embedColor(change, durationMs, previousState) {
        if (!previousState || !Number.isFinite(previousState.durationMs) || previousState.durationMs <= 0) {
            return change < 0 ? 0x8B0000 : 0x1F8B4C;
        }
        const faster = durationMs < previousState.durationMs;
        if (change >= 0) return faster ? 0x57F287 : 0x1F8B4C;
        return faster ? 0x8B0000 : 0xF38BA8;
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
        const nowMs = now.getTime();
        const name = channel.name || 'Unknown channel';
        const previousMilestone = previousState ? previousState.milestone : null;
        const duration = previousState ? nowMs - previousState.at : 0;
        const change = Number.isFinite(previousMilestone) ? milestone - previousMilestone : 0;
        const averages = averageValues(change, duration);

        // Compare this milestone's subscriber rate with the rate of the previous milestone.
        const previousChange = previousState && Number.isFinite(previousState.previousMilestone)
            ? previousState.milestone - previousState.previousMilestone
            : 0;
        const previousAverages = previousState && previousState.durationMs > 0
            ? averageValues(previousChange, previousState.durationMs)
            : null;
        const comparison = subscriberComparison(averages, previousAverages);
        const averageText = averageLines(averages, previousAverages);

        const decreasing = change < 0;
        const channelUrl = channel.url || channel.link || channel.channelUrl || '';
        const action = decreasing ? 'dropped below' : 'just hit';
        const actionAmount = decreasing && Number.isFinite(previousMilestone) ? previousMilestone : milestone;
        const description = channelUrl
            ? `[${name}](${channelUrl}) ${action} **${fmt(actionAmount)} subscribers**`
            : `**${name}** ${action} **${fmt(actionAmount)} subscribers**`;

        return {
            username: 'Livecountsedit',
            content: cfg.mention || undefined,
            embeds: [{
                author: {
                    name: 'YouTube Subscriber Update',
                    icon_url: 'https://pngdownload.io/wp-content/uploads/2023/12/YouTube-Logo-PNG-Symbol-for-Video-Platform-Transparent-jpg.webp'
                },
                description,
                url: channelUrl || undefined,
                color: embedColor(change, duration, previousState),
                thumbnail: channel.image ? { url: channel.image } : undefined,
                fields: [
                    ...(previousMilestone != null ? [{
                        name: '⏪ Previous milestone',
                        value: `${fmt(previousMilestone)} subscribers\n${discordTimestamp(previousState.at, 'F')} - ${discordTimestamp(previousState.at, 'R')}`,
                        inline: false
                    }] : []),
                    {
                        name: '⏩ New milestone',
                        value: `**${fmt(milestone)} subscribers**\n${discordTimestamp(nowMs, 'F')} - ${discordTimestamp(nowMs, 'R')}`,
                        inline: false
                    },
                    ...(previousState ? [{ name: '⏱️ Duration', value: durationParts(duration), inline: false }] : []),
                    ...(averageText ? [{
                        name: `✳️ Subscriber Averages${comparison ? ` (${comparison})` : ''}`,
                        value: averageText,
                        inline: false
                    }] : []),
                    {
                        name: '🔮 Information',
                        value: `🤝 **${name}** is currently ranked **#${rank}** in the Livecountsedit rankings.`,
                        inline: false
                    }
                ],
                footer: { text: 'Update powered by Livecountsedit' },
                timestamp: now.toISOString()
            }]
        };
    }

    async function check() {
        if (!cfg.enabled || !validWebhook(cfg.webhook)) return;
        if (typeof data === 'undefined' || !data || !Array.isArray(data.data)) return;

        const channels = data.data;
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
                notified.set(id, { count, milestone, at: now, durationMs: 0, previousMilestone: 0 });
                saveState();
                continue;
            }

            const crossed = milestone !== previous.milestone;

            if (crossed && !inFlight.has(id)) {
                inFlight.add(id);
                try {
                    await send(alertPayload(c, milestone, i + 1, previous));
                    const duration = now - previous.at;
                    notified.set(id, {
                        count,
                        milestone,
                        at: now,
                        durationMs: duration,
                        previousMilestone: previous.milestone
                    });
                    saveState();
                } catch (err) {
                    console.error('[Discord Milestones] Failed to send milestone:', err);
                } finally {
                    inFlight.delete(id);
                }
            } else if (count !== previous.count && !inFlight.has(id)) {
                notified.set(id, { ...previous, count });
                saveState();
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
        panel.innerHTML = `<h3>Discord Milestone Notifications</h3><p class="dm-note">Alerts automatically when any channel in the live data crosses a milestone in either direction. The webhook is stored only in this browser, not in GitHub.</p><div class="dm-tiers"><b>Automatic tiers:</b><br>&lt;1K → every 1<br>1K–&lt;10K → every 10<br>10K–&lt;100K → every 100<br>100K–&lt;1M → every 1K<br>1M–&lt;10M → every 10K<br>10M–&lt;100M → every 100K<br>100M–&lt;1B → every 1M</div><label><input id="dm-enabled" type="checkbox" style="width:auto"> Enable notifications</label><label>Discord webhook URL</label><input id="dm-webhook" type="password" placeholder="https://discord.com/api/webhooks/..." autocomplete="off"><label>Optional mention</label><input id="dm-mention" type="text" placeholder="e.g. &lt;@&amp;123456789&gt;"><div class="dm-row"><button id="dm-save">Save</button><button id="dm-test">Send test</button><button id="dm-close">Close</button></div><div id="dm-status"></div>`;
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
            save();
            notified.clear();
            inFlight.clear();
            try { localStorage.removeItem(STATE_KEY); } catch (_) {}
            status.textContent = 'Saved. Existing milestones will not fire immediately.';
        };
        panel.querySelector('#dm-test').onclick = async () => {
            const url = webhook.value.trim();
            if (!validWebhook(url)) return void (status.textContent = 'Enter a valid Discord webhook URL first.');
            status.textContent = 'Sending test...';
            const old = cfg;
            cfg = { ...cfg, enabled: true, webhook: url, mention: mention.value.trim() };
            try {
                const testNow = Date.now();
                const testPrevious = testNow - (17 * 3600000 + 35 * 60000 + 40000);
                const testPreviousMilestone = 19_900_000;
                const testMilestone = 20_000_000;
                const testChange = testMilestone - testPreviousMilestone;
                const testDuration = 17 * 3600000 + 35 * 60000 + 40000;
                const testAverages = averageValues(testChange, testDuration);
                await send({
                    username: 'Livecountsedit',
                    content: cfg.mention || undefined,
                    embeds: [{
                        author: { name: 'YouTube Subscriber Update', icon_url: 'https://pngdownload.io/wp-content/uploads/2023/12/YouTube-Logo-PNG-Symbol-for-Video-Platform-Transparent-jpg.webp' },
                        description: '**Example Channel** just hit **20,000,000 subscribers**',
                        color: 0x57F287,
                        thumbnail: { url: 'https://pngdownload.io/wp-content/uploads/2023/12/YouTube-Logo-PNG-Symbol-for-Video-Platform-Transparent-jpg.webp' },
                        fields: [
                            { name: '⏪ Previous milestone', value: `${fmt(testPreviousMilestone)} subscribers\n${discordTimestamp(testPrevious, 'F')} - ${discordTimestamp(testPrevious, 'R')}`, inline: false },
                            { name: '⏩ New milestone', value: `**${fmt(testMilestone)} subscribers**\n${discordTimestamp(testNow, 'F')} - ${discordTimestamp(testNow, 'R')}`, inline: false },
                            { name: '⏱️ Duration', value: durationParts(testDuration), inline: false },
                            { name: '✳️ Subscriber Averages', value: averageLines(testAverages, null), inline: false },
                            { name: '🔮 Information', value: '🤝 **Example Channel** is currently ranked **#1** in the Livecountsedit rankings.', inline: false }
                        ],
                        footer: { text: 'Update powered by Livecountsedit' },
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
    window.addEventListener('beforeunload', () => {
        try { saveState(); } catch (_) {}
        clearInterval(timer);
    }, { once: true });
})();
