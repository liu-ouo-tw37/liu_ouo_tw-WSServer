const { randomBytes } = require("crypto");
const os = require("os-utils");

const CONSOLE_URL = "https://liu37-minecraft-console.windyspool12.chatgpt.site";

function initWebConsolePlugin(server) {
    const code = randomBytes(8).toString("hex").toUpperCase();
    const publisher = randomBytes(32).toString("hex");
    const state = { connected: false, players: [], cpu: null, latency: null, commandsPerMinute: 0, aiRequests: 0, song: null, chat: [], logs: [] };
    let closed = false, sending = false, registered = false, lastError = "";
    const append = (list, entry) => { list.push({ time: Date.now(), ...entry }); if (list.length > 100) list.shift(); };
    const announce = message => { console.log(message); server.emit("log", message); };
    const post = async (route, value) => {
        const response = await fetch(CONSOLE_URL + route, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + publisher }, body: JSON.stringify(value), signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            const error = new Error("Console HTTP " + response.status);
            error.status = response.status;
            throw error;
        }
        return response.json();
    };
    const upload = async () => {
        if (closed || sending) return;
        sending = true;
        try {
            if (!registered) {
                await post("/api/register", { code, owner: server.admins?.join(", ") || "Minecraft Server" });
                if (closed) return;
                registered = true;
                announce("網頁控制台已就緒 | 查看碼：" + code);
            }
            state.song = server.isPlayingMusic || server.isDatapackPlaying ? { name: server.currentSongName || "Music", tick: server.currentSongTick || 0, total: server.totalSongTicks || 0, queued: server.musicQueue?.length || 0 } : null;
            await post("/api/publish", { code, state });
            lastError = "";
        } catch (error) {
            if (closed) return;
            if (error.status === 401 || error.status === 404) registered = false;
            if (error.message !== lastError) { lastError = error.message; announce("網頁控制台尚未連線，將自動重試：" + error.message); }
        } finally { sending = false; }
    };
    const listeners = {
        dashboardMetrics: metrics => Object.assign(state, metrics),
        playerMessage: (player, message) => append(state.chat, { player, message: String(message).slice(0, 2000) }),
        log: message => append(state.logs, { message: String(message).slice(0, 2000) }),
        statsConnected: () => { state.connected = true; },
        statsDisconnected: () => { state.connected = false; state.players = []; state.song = null; },
    };
    for (const [event, handler] of Object.entries(listeners)) server.on(event, handler);
    server.webConsoleUrl = CONSOLE_URL;
    server.webConsoleCode = code;
    announce("網頁控制台：" + CONSOLE_URL);
    announce("本次查看碼：" + code + "（正在連線網站）");
    const timer = setInterval(() => {
        os.cpuUsage(value => { if (!closed) state.cpu = Math.round(value * 100); });
        void upload();
    }, 5000);
    timer.unref?.();
    const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        for (const [event, handler] of Object.entries(listeners)) server.removeListener(event, handler);
        server.removeListener("webConsoleStop", close);
        state.connected = false; state.players = []; state.song = null;
        if (registered) void post("/api/publish", { code, state }).catch(() => {});
    };
    server.on("webConsoleStop", close);
    void upload();
    return { close };
}

module.exports = initWebConsolePlugin;
