const fs = require("fs");
const { randomUUID } = require("crypto");
const os = require("os-utils");

function initStatsPlugin(server) {
    let data;
    try { data = JSON.parse(fs.readFileSync(server.statsPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; data = {}; }
    const online = new Map();
    const pending = new Map();
    let timer, running = false, dashboard = false, cpu = null, latency = null;
    let commandTimes = [], aiRequests = 0;
    const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    const record = name => {
        if (!Object.hasOwn(data, name)) Object.defineProperty(data, name, { value: { answer_ids: [], mastery: {} }, enumerable: true, writable: true });
        const player = data[name];
        player.metrics ||= { playtime: 0, logins: 0, distance: 0, deaths: 0, messages: 0, commands: 0, ai: 0 };
        return player;
    };
    const flush = () => {
        try {
            fs.writeFileSync(`${server.statsPath}.tmp`, JSON.stringify(data, null, 2), "utf8");
            fs.renameSync(`${server.statsPath}.tmp`, server.statsPath);
        } catch (error) { server.emit("log", `Stats save failed: ${error.message}`); }
    };
    server.playerMetrics = {
        saveExam(name, stats) {
            const player = record(name);
            player.mastery = stats.mastery;
            player.answer_ids = stats.answer_ids;
            player.examTotals = stats.examTotals;
            flush();
        }
    };
    const request = command => new Promise((resolve, reject) => {
        const id = randomUUID();
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error("Stats query timed out")); }, 8000);
        pending.set(id, { resolve, reject, timeout });
        server.runCommand(command, id, { silent: true });
    });
    server.on("worldCommandResponse", (id, body) => {
        const item = pending.get(id);
        if (!item) return;
        clearTimeout(item.timeout);
        pending.delete(id);
        if (body.statusCode < 0) item.reject(new Error(body.statusMessage));
        else item.resolve(body);
    });
    const tell = (name, message) => server.sendPrivateMessage(name, message);
    const wall = () => {
        const today = Object.values(data).filter(player => player.metrics?.lastDay === day()).length;
        const lines = { "Online": online.size, "Today players": today, "CPU %": cpu ?? 0, "WS RTT ms": latency ?? 0, "Commands/min": commandTimes.length, "AI requests": aiRequests };
        for (const [label, value] of Object.entries(lines)) server.runCommand(`scoreboard players set ${JSON.stringify(label)} ws_metrics ${Math.round(value)}`, null, { silent: true });
    };
    const poll = async () => {
        if (running || !server.clientConn || server.clientConn.closed) return;
        running = true;
        try {
            const started = Date.now();
            const result = await request("testfor @a");
            latency = Date.now() - started;
            if (!Array.isArray(result.victim)) throw new Error("Online query returned no victim list");
            const names = result.victim;
            const now = Date.now();
            for (const name of names) {
                if (typeof name !== "string") continue;
                const player = record(name);
                let session = online.get(name);
                if (!session) { session = { time: now }; online.set(name, session); player.metrics.logins++; }
                player.metrics.playtime += Math.max(0, Math.min(15000, now - session.time)) / 1000;
                session.time = now;
                player.metrics.lastDay = day();
                try {
                    const positionResult = await request(`querytarget ${JSON.stringify(name)}`);
                    const target = JSON.parse(positionResult.details)[0];
                    if (target?.position) {
                        const previous = session.target;
                        if (previous?.dimension === target.dimension) {
                            const distance = Math.hypot(...["x", "y", "z"].map(axis => target.position[axis] - previous.position[axis]));
                            if (Number.isFinite(distance) && distance <= 100) player.metrics.distance += distance;
                        }
                        session.target = target;
                    }
                } catch { session.target = null; }
            }
            for (const name of online.keys()) if (!names.includes(name)) online.delete(name);
            commandTimes = commandTimes.filter(time => time > Date.now() - 60000);
            os.cpuUsage(value => { cpu = Math.round(value * 100); });
            flush();
            server.emit("dashboardMetrics", { players: [...online.keys()], cpu, latency, commandsPerMinute: commandTimes.length, aiRequests });
            if (dashboard) wall();
        } catch (error) { server.emit("log", `Stats poll: ${error.message}`); }
        finally { running = false; }
    };
    server.on("statsConnected", () => {
        online.clear();
        clearInterval(timer);
        server.eventSubscribe("PlayerDied");
        timer = setInterval(poll, 10000);
        timer.unref?.();
        void poll();
    });
    const disconnect = () => { clearInterval(timer); online.clear(); flush(); };
    server.on("statsDisconnected", disconnect);
    server.on("statsCommand", command => {
        commandTimes = commandTimes.filter(time => time > Date.now() - 60000);
        if (/^(?:execute\b|fill\b|setblock\b|structure\b)/.test(command)) commandTimes.push(Date.now());
    });
    server.on("statsAIRequest", name => { record(name).metrics.ai++; aiRequests++; flush(); });
    server.on("statsEvent", (event, body) => {
        if (event !== "PlayerDied") return;
        const name = body.player?.name || body.player?.Name;
        if (typeof name === "string") { record(name).metrics.deaths++; flush(); }
    });
    server.on("playerMessage", async (name, message) => {
        const player = record(name);
        player.metrics.messages++;
        if (message.startsWith("-")) player.metrics.commands++;
        flush();
        if (message === "-stats" || message.startsWith("-stats?")) {
            const target = message === "-stats" ? name : message.slice(7).trim();
            if (!Object.hasOwn(data, target)) return tell(name, "§c找不到玩家紀錄");
            const item = record(target), m = item.metrics, exam = item.examTotals;
            tell(name, `§b${target}\n§f在線 ${Math.floor(m.playtime / 60)} 分鐘 | 登入 ${m.logins}\n移動約 ${Math.round(m.distance)} 格 | 死亡事件 ${m.deaths}\n訊息 ${m.messages} | 指令 ${m.commands} | AI 指令 ${m.ai}\n答題 ${exam?.answered ? `${exam.correct}/${exam.answered} (${(exam.correct / exam.answered * 100).toFixed(1)}%)` : "尚無新答題紀錄"}`);
        } else if (message.startsWith("-leaderboard?")) {
            const metric = message.slice(13).trim();
            if (!["playtime", "logins", "distance", "deaths", "messages", "commands", "ai"].includes(metric)) return tell(name, "§e排行榜：playtime / logins / distance / deaths / messages / commands / ai");
            const ranked = Object.entries(data).sort((a, b) => (b[1].metrics?.[metric] || 0) - (a[1].metrics?.[metric] || 0)).slice(0, 10);
            tell(name, `§b${metric}\n${ranked.map(([user, item], index) => `${index + 1}. ${user}: ${Math.round(item.metrics?.[metric] || 0)}${metric === "playtime" ? " 秒" : ""}`).join("\n")}`);
        } else if (/^-dashboard(?: (on|off))?$/.test(message)) {
            if (!server.admins.includes(name)) return tell(name, "§c此功能限管理員");
            dashboard = message.endsWith(" off") ? false : message.endsWith(" on") ? true : !dashboard;
            try {
                if (dashboard) {
                    try { await request('scoreboard objectives add ws_metrics dummy "Server Dashboard"'); } catch { /* Existing objective is reusable. */ }
                    await request("scoreboard objectives setdisplay sidebar ws_metrics");
                    wall();
                } else await request("scoreboard objectives setdisplay sidebar");
            } catch (error) { dashboard = false; tell(name, `§cDashboard: ${error.message}`); }
        }
    });
}

module.exports = initStatsPlugin;
