const $ = id => document.getElementById(id);
let state;

const time = value => new Date(value).toLocaleTimeString('zh-TW', { hour12: false });
function feed(id, entries, chat) {
    const root = $(id), follow = $('follow').checked;
    const top = root.scrollTop;
    root.replaceChildren();
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '尚無紀錄'; root.append(empty); }
    for (const entry of entries) {
        const row = document.createElement('div'); row.className = 'entry';
        const clock = document.createElement('time'); clock.textContent = time(entry.time); row.append(clock);
        if (chat) { const name = document.createElement('b'); name.textContent = entry.player; row.append(name); }
        row.append(document.createTextNode(entry.message)); root.append(row);
    }
    root.scrollTop = follow ? root.scrollHeight : top;
}
function render() {
    if (!state) return;
    $('owner').textContent = state.owner ? `伺服器：${state.owner}` : '伺服器監控';
    $('online').textContent = state.players.length;
    $('cpu').textContent = state.cpu === null ? '—' : `${state.cpu}%`;
    $('cpuMeter').value = state.cpu || 0;
    $('latency').textContent = state.latency === null ? '—' : `${state.latency} ms`;
    $('commands').textContent = state.commandsPerMinute;
    $('ai').textContent = state.aiRequests;
    $('players').replaceChildren(...state.players.map(name => { const item = document.createElement('li'); item.textContent = name; return item; }));
    $('playerEmpty').hidden = state.players.length > 0;
    $('song').textContent = state.song?.name || '尚未播放';
    $('progress').value = state.song?.total ? Math.min(1, state.song.tick / state.song.total) : 0;
    $('songTime').textContent = state.song ? `${Math.floor(state.song.tick / 20)}s / ${Math.floor(state.song.total / 20)}s · 等待 ${state.song.queued} 首` : '—';
    $('world').textContent = state.connected ? 'Minecraft 已連線' : 'Minecraft 未連線';
    $('updated').textContent = `更新 ${time(Date.now())}`;
    feed('chat', state.chat, true);
    const filter = $('filter').value.toLowerCase();
    feed('logs', state.logs.filter(entry => entry.message.toLowerCase().includes(filter)), false);
}

$('filter').addEventListener('input', render);
let session = 0, polling = false;
async function refresh() {
    if (polling || !session) return;
    const current = session;
    polling = true;
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 401 ? '查看碼已過期，請重新輸入' : '沒有連線');
        const next = await response.json();
        if (current !== session) return;
        state = next;
        render();
        $('connection').textContent = state.connected ? '即時連線' : '沒有連線';
        $('connection').className = state.connected ? 'live' : '';
    } catch (error) {
        if (current !== session) return;
        $('connection').textContent = '沒有連線';
        $('connection').className = '';
        $('world').textContent = '沒有連線';
        $('loginError').textContent = error.message;
    } finally { polling = false; }
}
$('login').hidden = false;
$('connection').textContent = '請輸入查看碼';
$('login').addEventListener('submit', async event => {
    event.preventDefault();
    session++;
    $('connection').textContent = '連線中';
    $('loginError').textContent = '';
    try {
        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        state = null;
        $('chat').replaceChildren(); $('logs').replaceChildren();
        $('owner').textContent = '伺服器：' + result.owner;
        await refresh();
    } catch (error) {
        session = 0;
        $('connection').textContent = '沒有連線';
        $('loginError').textContent = error.message;
    }
});
setInterval(refresh, 3000);
