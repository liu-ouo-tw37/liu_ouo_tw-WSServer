const assets = {"/":{"type":"text/html; charset=utf-8","body":"<!doctype html>\n<html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Minecraft Server Console</title><link rel=\"stylesheet\" href=\"/style.css\"><script src=\"/app.js\" defer></script></head>\n<body><header><div><span class=\"logo\">MC</span><strong>Minecraft</strong><span class=\"subtitle\">Server Console</span></div><span id=\"connection\" role=\"status\">連線中</span></header>\n<main><form id=\"login\" hidden><label for=\"code\">伺服器查看碼</label><input id=\"code\" autocomplete=\"off\" maxlength=\"16\" required><button type=\"submit\">連線</button><span id=\"loginError\" role=\"status\"></span></form><div class=\"heading\"><h1 id=\"owner\">伺服器監控</h1><span id=\"updated\">等待資料</span></div>\n<section class=\"metrics\" aria-label=\"即時指標\"><article><span>在線玩家</span><strong id=\"online\">—</strong></article><article><span>CPU</span><strong id=\"cpu\">—</strong><meter id=\"cpuMeter\" min=\"0\" max=\"100\" value=\"0\"></meter></article><article><span>WebSocket RTT</span><strong id=\"latency\">—</strong></article><article><span>世界指令 / min</span><strong id=\"commands\">—</strong></article><article><span>AI 請求 · 本次啟動</span><strong id=\"ai\">—</strong></article></section>\n<div class=\"workspace\"><aside><section><h2>在線玩家</h2><ul id=\"players\"></ul><p id=\"playerEmpty\">目前沒有在線玩家</p></section><section class=\"music\"><h2>目前歌曲</h2><strong id=\"song\">尚未播放</strong><progress id=\"progress\" max=\"1\" value=\"0\"></progress><span id=\"songTime\">—</span></section></aside>\n<div class=\"streams\"><section><div class=\"sectionHead\"><h2>即時聊天</h2><label><input type=\"checkbox\" id=\"follow\" checked> 跟隨新訊息</label></div><div id=\"chat\" class=\"feed\" role=\"log\"></div></section><section><div class=\"sectionHead\"><h2>事件 Log</h2><input type=\"search\" id=\"filter\" placeholder=\"篩選事件\" aria-label=\"篩選事件\"></div><div id=\"logs\" class=\"feed\" role=\"log\"></div></section></div></div></main><footer>LOCAL CONSOLE <span id=\"world\">等待 Minecraft 連線</span></footer></body></html>\n\r\n"},"/app.js":{"type":"text/javascript; charset=utf-8","body":"const $ = id => document.getElementById(id);\nlet state;\n\nconst time = value => new Date(value).toLocaleTimeString('zh-TW', { hour12: false });\nfunction feed(id, entries, chat) {\n    const root = $(id), follow = $('follow').checked;\n    const top = root.scrollTop;\n    root.replaceChildren();\n    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '尚無紀錄'; root.append(empty); }\n    for (const entry of entries) {\n        const row = document.createElement('div'); row.className = 'entry';\n        const clock = document.createElement('time'); clock.textContent = time(entry.time); row.append(clock);\n        if (chat) { const name = document.createElement('b'); name.textContent = entry.player; row.append(name); }\n        row.append(document.createTextNode(entry.message)); root.append(row);\n    }\n    root.scrollTop = follow ? root.scrollHeight : top;\n}\nfunction render() {\n    if (!state) return;\n    $('owner').textContent = state.owner ? `伺服器：${state.owner}` : '伺服器監控';\n    $('online').textContent = state.players.length;\n    $('cpu').textContent = state.cpu === null ? '—' : `${state.cpu}%`;\n    $('cpuMeter').value = state.cpu || 0;\n    $('latency').textContent = state.latency === null ? '—' : `${state.latency} ms`;\n    $('commands').textContent = state.commandsPerMinute;\n    $('ai').textContent = state.aiRequests;\n    $('players').replaceChildren(...state.players.map(name => { const item = document.createElement('li'); item.textContent = name; return item; }));\n    $('playerEmpty').hidden = state.players.length > 0;\n    $('song').textContent = state.song?.name || '尚未播放';\n    $('progress').value = state.song?.total ? Math.min(1, state.song.tick / state.song.total) : 0;\n    $('songTime').textContent = state.song ? `${Math.floor(state.song.tick / 20)}s / ${Math.floor(state.song.total / 20)}s · 等待 ${state.song.queued} 首` : '—';\n    $('world').textContent = state.connected ? 'Minecraft 已連線' : 'Minecraft 未連線';\n    $('updated').textContent = `更新 ${time(Date.now())}`;\n    feed('chat', state.chat, true);\n    const filter = $('filter').value.toLowerCase();\n    feed('logs', state.logs.filter(entry => entry.message.toLowerCase().includes(filter)), false);\n}\n\n$('filter').addEventListener('input', render);\nlet session = 0, polling = false;\nasync function refresh() {\n    if (polling || !session) return;\n    const current = session;\n    polling = true;\n    try {\n        const response = await fetch('/api/state', { cache: 'no-store' });\n        if (!response.ok) throw new Error(response.status === 401 ? '查看碼已過期，請重新輸入' : '沒有連線');\n        const next = await response.json();\n        if (current !== session) return;\n        state = next;\n        render();\n        $('connection').textContent = state.connected ? '即時連線' : '沒有連線';\n        $('connection').className = state.connected ? 'live' : '';\n    } catch (error) {\n        if (current !== session) return;\n        $('connection').textContent = '沒有連線';\n        $('connection').className = '';\n        $('world').textContent = '沒有連線';\n        $('loginError').textContent = error.message;\n    } finally { polling = false; }\n}\n$('login').hidden = false;\n$('connection').textContent = '請輸入查看碼';\n$('login').addEventListener('submit', async event => {\n    event.preventDefault();\n    session++;\n    $('connection').textContent = '連線中';\n    $('loginError').textContent = '';\n    try {\n        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) });\n        const result = await response.json();\n        if (!response.ok) throw new Error(result.error);\n        state = null;\n        $('chat').replaceChildren(); $('logs').replaceChildren();\n        $('owner').textContent = '伺服器：' + result.owner;\n        await refresh();\n    } catch (error) {\n        session = 0;\n        $('connection').textContent = '沒有連線';\n        $('loginError').textContent = error.message;\n    }\n});\nsetInterval(refresh, 3000);\n"},"/style.css":{"type":"text/css; charset=utf-8","body":":root{color-scheme:dark;font-family:system-ui,sans-serif;color:#e7ece9;background:#101411;font-size:14px}*{box-sizing:border-box;letter-spacing:0}body{margin:0}header{height:68px;border-bottom:1px solid #303832;display:flex;align-items:center;justify-content:space-between;padding:0 32px;background:#171d19}header>div{display:flex;align-items:center;gap:12px}.logo{background:#77bd8b;color:#101b13;padding:7px;font-weight:800;border-radius:4px}.subtitle,#updated,footer{color:#95a399;font-size:12px}#connection{font-size:12px;color:#e2c47d}#connection.live{color:#8edba3}main{max-width:1600px;margin:auto;padding:28px 32px}.heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{font-size:23px;margin:0}h2{font-size:14px;margin:0;font-weight:600}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-top:1px solid #344138;border-bottom:1px solid #344138;margin-bottom:30px}.metrics article{padding:20px;border-right:1px solid #303832;min-height:110px}.metrics article:last-child{border:0}.metrics span{display:block;color:#a5b2a9;font-size:12px}.metrics strong{display:block;font-size:27px;margin-top:9px;font-variant-numeric:tabular-nums}meter{width:100%;height:6px;margin-top:8px;accent-color:#83d39b}.workspace{display:grid;grid-template-columns:250px minmax(0,1fr);gap:30px}aside{border-right:1px solid #303832;padding-right:24px}aside section+section{border-top:1px solid #303832;margin-top:28px;padding-top:24px}ul{padding:0;list-style:none}li{padding:10px 0;overflow-wrap:anywhere}li:before{content:'●';color:#83d39b;margin-right:9px}p{color:#95a399;font-size:13px}.music strong{display:block;margin:20px 0 12px;overflow-wrap:anywhere}.music span{display:block;color:#b1b9b4;font-size:12px}progress{width:100%;height:5px;accent-color:#e0bd72;margin-bottom:12px}.streams{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.sectionHead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;min-height:38px;margin-bottom:12px}.sectionHead label{font-size:11px;color:#a5b2a9}input[type=search]{background:#191f1b;border:1px solid #3e4a41;color:#e7ece9;border-radius:4px;padding:7px 9px;width:155px;max-width:100%}.feed{height:470px;overflow:auto;border-top:1px solid #344138;border-bottom:1px solid #344138;background:#141a16;padding:0 12px}.entry{padding:12px 0;border-bottom:1px solid #29332b;overflow-wrap:anywhere;white-space:pre-wrap;font-size:13px;line-height:1.6}.entry time{display:block;color:#809587;font:11px ui-monospace,monospace}.entry b{color:#91c7e5;margin-right:8px}.empty{color:#84968a;padding-top:20px}footer{border-top:1px solid #303832;padding:16px 32px;display:flex;justify-content:space-between;gap:16px}@media(max-width:1000px){.streams{grid-template-columns:1fr}.feed{height:300px}.metrics strong{font-size:22px}}@media(max-width:650px){header{padding:0 16px}.subtitle{display:none}main{padding:20px 16px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics article{border-bottom:1px solid #303832}.workspace{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #303832;padding:0 0 20px}footer{padding:16px}.heading{gap:12px;align-items:flex-start}h1{font-size:20px}}\n#login:not([hidden]){display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 0 24px;border-bottom:1px solid #344138;margin-bottom:24px}#login label{font-size:12px;color:#a5b2a9}#login input{background:#191f1b;border:1px solid #3e4a41;border-radius:4px;padding:9px;color:#e7ece9;max-width:100%;min-width:0}#relay{width:280px}#code{width:190px}#login button{background:#83d39b;color:#102016;border:0;border-radius:4px;padding:9px 18px;cursor:pointer}#loginError{color:#e2c47d;overflow-wrap:anywhere}\n\r\n"}};
const encoder = new TextEncoder();
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
const expired = record => Date.now() - record.updated > 86400000;
const equal = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};
const attempts = new Map();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json', ...extra } });
async function readBody(request) {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing body');
    const chunks = []; let length = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 262144) { await reader.cancel(); throw new Error('Payload too large'); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
}
function cleanState(value) {
    if (!value || !Array.isArray(value.players) || !Array.isArray(value.chat) || !Array.isArray(value.logs)) throw new Error('Invalid state');
    return {
        connected: value.connected === true,
        players: value.players.slice(0, 200).filter(v => typeof v === 'string').map(v => v.slice(0, 80)),
        cpu: Number.isFinite(value.cpu) ? Math.max(0, Math.min(100, value.cpu)) : null,
        latency: Number.isFinite(value.latency) ? value.latency : null,
        commandsPerMinute: Number.isFinite(value.commandsPerMinute) ? value.commandsPerMinute : 0,
        aiRequests: Number.isFinite(value.aiRequests) ? value.aiRequests : 0,
        song: value.song ? { name: String(value.song.name).slice(0, 200), tick: Number(value.song.tick) || 0, total: Number(value.song.total) || 0, queued: Number(value.song.queued) || 0 } : null,
        chat: value.chat.slice(-100).map(e => ({ time: Number(e.time) || 0, player: String(e.player).slice(0, 80), message: String(e.message).slice(0, 2000) })),
        logs: value.logs.slice(-100).map(e => ({ time: Number(e.time) || 0, message: String(e.message).slice(0, 2000) })),
    };
}
export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url), route = url.pathname;
            if (request.method === 'GET' && assets[route]) return new Response(assets[route].body, { headers: { ...headers, 'Content-Type': assets[route].type } });
            if (!route.startsWith('/api/')) return json({ error: 'Not found' }, 404);
            if (!env.BUCKET) return json({ error: 'Storage unavailable' }, 503);
            if (request.method === 'POST' && ['/api/register', '/api/login'].includes(route)) {
                const key = (request.headers.get('CF-Connecting-IP') || 'unknown') + route;
                const now = Date.now();
                for (const [ip, entry] of attempts) if (now - entry.time >= 60000) attempts.delete(ip);
                const entry = attempts.get(key) || { time: now, count: 0 };
                if (attempts.size >= 2000 && !attempts.has(key)) return json({ error: '請稍候再試' }, 429);
                attempts.set(key, entry);
                if (++entry.count > 20) return json({ error: '請稍候再試' }, 429);
            }
            if (request.method === 'POST') {
                if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'Invalid origin' }, 403);
                const input = await readBody(request);
                const code = String(input.code || '').replace(/\s/g, '').toUpperCase();
                if (!/^[A-F0-9]{16}$/.test(code)) return json({ error: '查看碼格式不正確' }, 400);
                const key = 'console/' + await hash(code);
                const stored = await env.BUCKET.get(key);
                let record = stored ? await stored.json() : null;
                const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
                if (route === '/api/register') {
                    if (!/^[a-f0-9]{64}$/.test(bearer)) return json({ error: 'Unauthorized' }, 401);
                    const publisherHash = await hash(bearer);
                    if (record && !expired(record) && !equal(record.publisherHash, publisherHash)) return json({ error: 'Code collision' }, 409);
                    record = { publisherHash, viewer: random(), owner: String(input.owner || 'Minecraft Server').slice(0, 80), updated: Date.now(), state: { connected: false, players: [], cpu: null, latency: null, commandsPerMinute: 0, aiRequests: 0, song: null, chat: [], logs: [] } };
                    await env.BUCKET.put(key, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
                    return json({ ok: true }, 201);
                }
                if (!record || expired(record)) return json({ error: '查看碼不存在或已過期' }, 404);
                if (route === '/api/publish') {
                    if (!equal(await hash(bearer), record.publisherHash)) return json({ error: 'Unauthorized' }, 401);
                    record.state = cleanState(input.state); record.updated = Date.now();
                    await env.BUCKET.put(key, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
                    return json({ ok: true });
                }
                if (route === '/api/login') return json({ owner: record.owner }, 200, { 'Set-Cookie': 'mc_view=' + code + '.' + record.viewer + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400' });
                return json({ error: 'Not found' }, 404);
            }
            if (route === '/api/state' && request.method === 'GET') {
                const match = /(?:^|;\s*)mc_view=([A-F0-9]{16})\.([a-f0-9]{48})/.exec(request.headers.get('Cookie') || '');
                if (!match) return json({ error: '請輸入查看碼' }, 401);
                const stored = await env.BUCKET.get('console/' + await hash(match[1]));
                const record = stored ? await stored.json() : null;
                if (!record || expired(record) || !equal(record.viewer, match[2])) return json({ error: '查看碼已過期' }, 401);
                const state = { ...record.state, owner: record.owner };
                if (Date.now() - record.updated > 15000) Object.assign(state, { connected: false, players: [], cpu: null, latency: null, song: null });
                return json(state);
            }
            return json({ error: 'Not found' }, 404);
        } catch (error) { return json({ error: error.message || 'Request failed' }, 400); }
    }
};
