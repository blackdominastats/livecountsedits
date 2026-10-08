window.onload = async () => {
    COUNTER_THEME = 'akshatmittalcompare';
    example_data.saveType = COUNTER_THEME;
    enableBannerFeature();
    enableCompareMode();

    const extraKeys = {
        boxColor: '#ffffff', bgColor: '#eef5f9', nameColor: '#605a64', mainFont: 'Roboto, sans-serif',
        textColor: '#605a64', footerColor: '#67757c', counterFontWeight: '300', odometerSpeed: 0.5,
        gapMethod: 'absolute',
        akshatmittalSettings: { countEditBox: false, showSocialMedia: true, showSubscribeAndChangeButtons: true, showTrophy: true, subscribeButton: true, milestoneSlowdown: false },
        partialExports: { akshatmittalSettings: true }
    };
    example_data = mergeWithExampleData(extraKeys, example_data);

    const insertedTab = {
        title: 'Technical Settings',
        items: [
            { title: 'Show boxes for editing counts in header', value: false, type: 'checkbox', path: 'data.akshatmittalSettings.countEditBox' },
            { title: 'Pressing "Subscribe" increases count by 1', value: true, type: 'checkbox', path: 'data.akshatmittalSettings.subscribeButton' },
            { title: 'Slow down near subscriber milestones', value: false, type: 'checkbox', path: 'data.akshatmittalSettings.milestoneSlowdown' },
            { title: 'Show social media buttons', value: true, type: 'checkbox', path: 'data.akshatmittalSettings.showSocialMedia' },
            { title: 'Show "Subscribe" and "Change" buttons', value: true, type: 'checkbox', path: 'data.akshatmittalSettings.showSubscribeAndChangeButtons' },
            { title: 'Show trophy icon for leading channel', value: true, type: 'checkbox', path: 'data.akshatmittalSettings.showTrophy' }
        ]
    };
    const partialExportAddition = { title: 'Akshatmittal settings', value: true, type: 'checkbox', path: 'data.partialExports.akshatmittalSettings', className: 'partial-export-option' };
    const styleAdditions = [
        { title: 'Card background color', type: 'color', path: 'data.boxColor' },
        { title: 'Footer color', type: 'color', path: 'data.footerColor' }
    ];
    MENU.tabs.splice(-2, 0, insertedTab);
    MENU.tabs.find(x => x.title === 'Import & Export Data').items.splice(-3, 0, partialExportAddition);
    MENU.tabs.find(x => x.title === 'Design Settings & Styling').items.splice(6, 0, ...styleAdditions);

    try {
        data = await retrieveDataFromBrowser(COUNTER_THEME, 1);
        data = mergeWithExampleData(data, example_data);
    } catch (err) { console.error(err); }
    fixData(2);

    const oldAPIUpdates = localStorage.getItem('akshatmittal-compare-apiUpdates');
    if (oldAPIUpdates) {
        try {
            const jsonData = JSON.parse(oldAPIUpdates);
            const oldSave = {
                apiUpdates: jsonData,
                data: [new Channel({ id: (jsonData.updateSide === '1' ? jsonData.channelID : '') || uuidGen() }), new Channel({ id: (jsonData.updateSide === '2' ? jsonData.channelID : '') || uuidGen() })],
                partialExports: { counters: true, apiUpdates: true }, saveType: COUNTER_THEME
            };
            delete oldSave.apiUpdates.channelID;
            if (confirm('You have old API update settings saved for the Akshatmittal compare counter. Would you like to save a backup just in case?')) {
                const file = new Blob([JSON.stringify(oldSave)], { type: 'text/plain' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = 'akshatmittalcompare-legacy-api-updates.json'; a.click(); delete a;
            }
            delete oldSave.partialExports;
            data = mergeWithExampleData(oldSave, data);
        } catch (err) { console.error(err); }
        localStorage.removeItem('akshatmittal-compare-apiUpdates');
    }
    drawMenu(MENU, document.querySelector('.tabs'), document.querySelector('.tab-stuff'), document.querySelector('.tab-controls'));
    afterDrawingMenu();
    await processImport(data);
};

async function processImport(imported) {
    importingStuff(imported, 2);
    fix();
    updateGainTypes(2);
    displayTrophy(data.data[0].getDisplayedCount(), data.data[1].getDisplayedCount());
    initRaceAnalytics();
    initMilestoneSlowdown();
    return imported;
}

function afterDrawingMenu2() {
    updateGainTypes(2); fillMenus(); saveAPISettings(false); refreshCount();

    // Replace both non-functional "Change" controls with side-specific Unsubscribe buttons.
    document.querySelectorAll('#yt_compare_vs1, #yt_compare_vs2').forEach((element) => {
        if (element.dataset.unsubscribeHandler === 'true') return;

        const side = element.id === 'yt_compare_vs1' ? 0 : 1;
        const label = element.querySelector('.font-light');
        if (label) label.innerHTML = '<i class="fa fa-user-minus"></i> Unsubscribe';
        else element.textContent = 'Unsubscribe';

        element.dataset.unsubscribeHandler = 'true';
        element.style.cursor = 'pointer';
        element.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!data?.data?.[side]) return;
            data.data[side].count -= 1;
            resetMilestoneState(side);
            refreshCount();
            await saveDataInBrowser(COUNTER_THEME, data);
        };
    });

    document.getElementById('saveCountButtonLeft').addEventListener('click', () => {
        const count = parseFloat(document.getElementById('left-input-count').value); if (isFinite(count)) { data.data[0].count = count; resetMilestoneState(0); }
    });
    document.getElementById('saveCountButtonRight').addEventListener('click', () => {
        const count = parseFloat(document.getElementById('right-input-count').value); if (isFinite(count)) { data.data[1].count = count; resetMilestoneState(1); }
    });
}

let milestoneState = [null, null];

function milestoneStep(count) {
    const magnitude = Math.max(0, Math.floor(Math.log10(Math.max(1, Math.abs(count)))));
    return Math.pow(10, Math.max(0, magnitude - 2));
}

function nextMilestone(count) {
    const step = milestoneStep(count);
    return Math.ceil((count + 1) / step) * step;
}

function applyMilestoneSlowdown(side, rawCount) {
    if (!data.akshatmittalSettings.milestoneSlowdown || !Number.isFinite(rawCount)) {
        milestoneState[side] = null;
        return rawCount;
    }

    const previous = milestoneState[side];
    const target = previous && rawCount >= previous.start ? previous.target : nextMilestone(rawCount);
    const start = previous && rawCount >= previous.start ? previous.start : Math.floor((rawCount - 1) / milestoneStep(rawCount)) * milestoneStep(rawCount);
    const step = milestoneStep(rawCount);
    const distance = target - rawCount;
    const interval = Math.max(step, target - start);
    const rawJump = previous && Number.isFinite(previous.raw) ? rawCount - previous.raw : 0;

    if (rawCount >= target) {
        if (rawJump >= 1000) {
            milestoneState[side] = { start: target, target: nextMilestone(target), raw: rawCount };
            return rawCount;
        }
        milestoneState[side] = { start: start, target: target, raw: rawCount };
        return Math.max(start, start + Math.floor(interval * 0.9));
    }

    const progress = Math.max(0, Math.min(1, 1 - (distance / interval)));
    const slowdown = Math.max(0.04, 1 - Math.pow(progress, 3) * 0.96);
    const allowedJump = Math.max(1, Math.floor(Math.max(1, rawJump) * slowdown));
    const effective = previous && Number.isFinite(previous.display) ? Math.min(rawCount, previous.display + allowedJump) : rawCount;

    milestoneState[side] = { start: start, target: target, raw: rawCount, display: effective };
    return effective;
}

function resetMilestoneState(side) { milestoneState[side] = null; }

function initMilestoneSlowdown() {
    milestoneState = [null, null];
}

function updateCounters2(doGains = true) {
    const rawCount1 = data.data[0].getDisplayedCount();
    const rawCount2 = data.data[1].getDisplayedCount();
    const count1 = applyMilestoneSlowdown(0, rawCount1);
    const count2 = applyMilestoneSlowdown(1, rawCount2);
    document.getElementById('yt_subs_vs1').innerText = count1;
    document.getElementById('yt_subs_vs2').innerText = count2;
    const gap = Math.abs(count1 - count2);
    document.getElementById('yt_diff').innerText = gap;
    const leaderCount = Math.max(count1, count2);
    const leadPercent = leaderCount > 0 ? ((gap / leaderCount) * 100).toFixed(2) : '0.00';
    const status = count1 === count2 ? 'Tied' : `Leader: ${count1 > count2 ? (data.data[0].name || 'Left') : (data.data[1].name || 'Right')}`;
    const statusElement = document.getElementById('yt_race_status');
    const percentElement = document.getElementById('yt_lead_percent');
    if (statusElement) statusElement.innerText = status;
    if (percentElement) percentElement.innerText = `Lead: ${leadPercent}%`;
    recordRaceHistory(count1, count2);
    updateRaceStats();
    displayTrophy(count1, count2);
}

function displayTrophy(c1, c2) {
    if (c1 > c2) { document.querySelector('.vs-leader.w-left').style.display = 'block'; document.querySelector('.vs-leader.w-right').style.display = 'none'; }
    else if (c1 < c2) { document.querySelector('.vs-leader.w-left').style.display = 'none'; document.querySelector('.vs-leader.w-right').style.display = 'block'; }
    else { document.querySelector('.vs-leader.w-left').style.display = 'none'; document.querySelector('.vs-leader.w-right').style.display = 'none'; }
}

function fix(noOdo = false) {
    document.querySelectorAll('.vs1_name').forEach(x => x.innerText = data.data[0].name || 'User');
    document.querySelectorAll('.vs2_name').forEach(x => x.innerText = data.data[1].name || 'User');
    document.getElementById('yt_name_vs1').style.color = data.nameColor;
    document.getElementById('yt_name_vs2').style.color = data.nameColor;
    document.getElementById('count_name_1').style.color = data.footerColor;
    document.getElementById('count_name_2').style.color = data.footerColor;
    document.getElementById('yt_diff_name').style.color = data.footerColor;
    document.querySelector('.display-title').style.color = data.footerColor;
    document.querySelectorAll('.main-card .font-light').forEach(x => x.style.color = data.textColor);
    if ((data.data[0].image || '/default.png') !== document.getElementById('yt_profile_vs1').src) document.getElementById('yt_profile_vs1').src = data.data[0].image || '/default.png';
    if ((data.data[0].banner || '/default_banner.png') !== document.getElementById('yt_cover_vs1').src) document.getElementById('yt_cover_vs1').src = data.data[0].banner || '/default_banner.png';
    if ((data.data[1].image || '/default.png') !== document.getElementById('yt_profile_vs2').src) document.getElementById('yt_profile_vs2').src = data.data[1].image || '/default.png';
    if ((data.data[1].banner || '/default_banner.png') !== document.getElementById('yt_cover_vs2').src) document.getElementById('yt_cover_vs2').src = data.data[1].banner || '/default_banner.png';
    document.querySelector('.page-wrapper').style.backgroundColor = data.bgColor;
    document.querySelectorAll('.main-card').forEach(x => x.style.backgroundColor = data.boxColor);
    document.querySelectorAll('.odometer').forEach(x => { x.style.fontFamily = data.mainFont; x.style.fontWeight = data.counterFontWeight; });
    document.getElementById('counterColor').innerText = `#yt_subs_vs1, #yt_subs_vs2 { color: ${data.textColor}; } #yt_diff { color: ${data.textColor} !important; }`;
    document.querySelectorAll('.selcl').forEach(x => { x.style.display = data.akshatmittalSettings.showSocialMedia ? '' : 'none'; });
    document.querySelectorAll('.sub-and-change').forEach(x => {
        if (data.akshatmittalSettings.showSubscribeAndChangeButtons) { x.style.display = ''; document.querySelector('.main-row').style.marginBottom = ''; }
        else { x.style.display = 'none'; document.querySelector('.main-row').style.marginBottom = '20px'; }
    });
    document.querySelectorAll('.manual-input').forEach(x => { x.style.display = data.akshatmittalSettings.countEditBox ? 'block' : 'none'; });
    document.getElementById('noTrophy').innerText = data.akshatmittalSettings.showTrophy ? '' : '.vs-leader { display: none !important; }';
    const cardColor = getComputedStyle(document.querySelector('.selcl')).backgroundColor.replace('rgb(','').replace(')','').split(', ');
    const colorDistanceSquared = (cardColor[0] - 153) ** 2 + (cardColor[1] - 171) ** 2 + (cardColor[2] - 180) ** 2;
    document.getElementById('shareOnTwitterColor').innerText = colorDistanceSquared < 2000 ? '.text-muted { color: white !important; }' : '';
    if (!noOdo) updateOdo();
}
async function unoReverse() {
    alert('This will refresh the page');
    data.data = [data.data[1], data.data[0]];
    await saveDataInBrowser(COUNTER_THEME, data);
    window.location.reload();
}
function subLeft() { if (data.akshatmittalSettings.subscribeButton) data.data[0].count++; }
function subRight() { if (data.akshatmittalSettings.subscribeButton) data.data[1].count++; }

const RACE_HISTORY_KEY = 'akshatmittalcompare-race-history';
const RACE_HISTORY_LIMIT = 500;
let raceHistory = [];
let lastRaceSample = 0;
let raceReplayTimer = null;

function initRaceAnalytics() {
    try { raceHistory = JSON.parse(localStorage.getItem(RACE_HISTORY_KEY) || '[]'); if (!Array.isArray(raceHistory)) raceHistory = []; } catch (_) { raceHistory = []; }
    const menu = document.querySelector('.menu');
    if (!document.getElementById('raceAnalyticsPanel') && menu) {
        menu.insertAdjacentHTML('beforebegin', `<div id="raceAnalyticsPanel" class="container" style="margin-top:20px;margin-bottom:20px;"><div class="card main-card"><div class="card-block"><h3 style="margin-top:0;">Race History &amp; Growth Statistics</h3><div id="raceStats" style="line-height:1.8;">Collecting race data...</div><hr><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button class="btn btn-info" id="raceReplayBtn">Replay Race</button><button class="btn btn-danger" id="raceClearBtn">Clear History</button><input id="raceReplaySlider" type="range" min="0" max="0" value="0" style="flex:1;min-width:180px;"></div><div id="raceReplayDisplay" style="text-align:center;margin-top:14px;font-size:1.05rem;">No history yet.</div></div></div></div>`);
        document.getElementById('raceReplaySlider').addEventListener('input', e => showRaceReplay(Number(e.target.value)));
        document.getElementById('raceReplayBtn').addEventListener('click', toggleRaceReplay);
        document.getElementById('raceClearBtn').addEventListener('click', clearRaceHistory);
    }
    updateRaceStats(); updateReplayControls();
}

function recordRaceHistory(count1, count2) {
    const now = Date.now();
    if (lastRaceSample && now - lastRaceSample < 30000) return;
    lastRaceSample = now;
    const previous = raceHistory[raceHistory.length - 1];
    if (previous && previous.left === count1 && previous.right === count2) return;
    raceHistory.push({ time: now, left: count1, right: count2 });
    if (raceHistory.length > RACE_HISTORY_LIMIT) raceHistory = raceHistory.slice(-RACE_HISTORY_LIMIT);
    try { localStorage.setItem(RACE_HISTORY_KEY, JSON.stringify(raceHistory)); } catch (_) {}
    updateReplayControls();
}

function ratePerMinute(start, end, key) {
    const minutes = (end.time - start.time) / 60000;
    return minutes > 0 ? (end[key] - start[key]) / minutes : 0;
}
function formatRate(rate) { return `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/min`; }

function updateRaceStats() {
    const el = document.getElementById('raceStats');
    if (!el) return;
    if (raceHistory.length < 2) { el.innerText = 'Collecting race data...'; return; }
    const first = raceHistory[0], last = raceHistory[raceHistory.length - 1];
    const elapsedMinutes = Math.max(0.01, (last.time - first.time) / 60000);
    const leftGain = last.left - first.left;
    const rightGain = last.right - first.right;
    const lead = Math.abs(last.left - last.right);
    const leftRate = leftGain / elapsedMinutes;
    const rightRate = rightGain / elapsedMinutes;
    el.innerHTML = `<strong>${first.left.toLocaleString()} → ${last.left.toLocaleString()}</strong> (${formatRate(leftRate)})<br><strong>${first.right.toLocaleString()} → ${last.right.toLocaleString()}</strong> (${formatRate(rightRate)})<br>Current gap: <strong>${lead.toLocaleString()}</strong>`;
}

function updateReplayControls() {
    const slider = document.getElementById('raceReplaySlider');
    if (!slider) return;
    slider.max = Math.max(0, raceHistory.length - 1);
    slider.value = Math.max(0, raceHistory.length - 1);
}

function showRaceReplay(index) {
    const display = document.getElementById('raceReplayDisplay');
    if (!display || !raceHistory[index]) return;
    const point = raceHistory[index];
    display.innerHTML = `<strong>${new Date(point.time).toLocaleString()}</strong><br>Left: ${point.left.toLocaleString()} &nbsp; vs &nbsp; Right: ${point.right.toLocaleString()}<br>Gap: ${Math.abs(point.left - point.right).toLocaleString()}`;
}

function toggleRaceReplay() {
    if (raceReplayTimer) { clearInterval(raceReplayTimer); raceReplayTimer = null; return; }
    if (raceHistory.length < 2) return;
    let index = 0;
    showRaceReplay(index);
    document.getElementById('raceReplaySlider').value = index;
    raceReplayTimer = setInterval(() => {
        index++;
        if (index >= raceHistory.length) { clearInterval(raceReplayTimer); raceReplayTimer = null; return; }
        document.getElementById('raceReplaySlider').value = index;
        showRaceReplay(index);
    }, 1000);
}

function clearRaceHistory() {
    raceHistory = [];
    lastRaceSample = 0;
    try { localStorage.removeItem(RACE_HISTORY_KEY); } catch (_) {}
    updateRaceStats();
    updateReplayControls();
}
