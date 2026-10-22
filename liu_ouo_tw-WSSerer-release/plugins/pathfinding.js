const { randomUUID } = require("crypto");

function initPathfindingPlugin(server) {
    let busy = false;
    const pending = new Map();
    const waiting = [];
    let active = 0;
    server.on("worldCommandResponse", (id, body) => pending.get(id)?.(null, body));
    const request = command => new Promise((resolve, reject) => {
        const start = () => {
        active++;
        const id = randomUUID();
        const finish = (error, body) => {
            if (!pending.has(id)) return;
            clearTimeout(timer);
            pending.delete(id);
            active--;
            waiting.shift()?.();
            error ? reject(error) : resolve(body);
        };
        const timer = setTimeout(() => finish(new Error("Block query timed out")), 8000);
        pending.set(id, finish);
        try { server.runCommand(command, id, { silent: true }); } catch (error) { finish(error); }
        };
        if (active < 16) start(); else waiting.push(start);
    });
    server.on("playerMessage", async (player, message) => {
        if (!message.startsWith("-path?")) return;
        const tell = text => server.sendPrivateMessage(player, text);
        if (!server.admins.includes(player)) return tell("§c[尋路] 此功能限管理員");
        const values = message.slice(6).trim().split(/\s+/);
        if (![6, 7].includes(values.length) || !values.every(value => /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)))) return tell("§e-path?Ax Ay Az Bx By Bz [搜尋邊距]（地板整數座標）");
        const [ax, y, az, bx, by, bz] = values.map(Number);
        const margin = values.length === 7 ? Number(values[6]) : 64;
        if (margin < 0 || margin > 128) return tell("§c[尋路] 搜尋邊距須為 0～128 格");
        const bounds = { minX: Math.min(ax, bx) - margin, maxX: Math.max(ax, bx) + margin, minZ: Math.min(az, bz) - margin, maxZ: Math.max(az, bz) + margin };
        if (y !== by) return tell("§c[尋路] A、B 地板必須在同一高度");
        if (Math.abs(ax - bx) > 160 || Math.abs(az - bz) > 160) return tell("§c[尋路] 兩點各軸距離最多 160 格");
        if (busy) return tell("§e[尋路] 正在搜尋，請稍候");
        busy = true;
        const deadline = Date.now() + 120000;
        try {
            const position = await request(`querytarget ${JSON.stringify(player)}`);
            if (position.statusCode < 0) throw new Error(position.statusMessage);
            const target = JSON.parse(position.details)[0];
            const dimension = ({ 0: "overworld", 1: "nether", 2: "the_end" })[target?.dimension];
            if (!dimension) throw new Error("Cannot determine dimension");
            const test = async (x, height, z, block) => {
                if (Date.now() > deadline) throw new Error("搜尋超時，請縮小範圍");
                const body = await request(`execute in ${dimension} run testforblock ${x} ${height} ${z} ${block}`);
                return typeof body.statusCode === "number" && body.statusCode >= 0;
            };
            const cache = new Map();
            const white = new Set();
            const walkable = async (x, z) => {
                const key = `${x},${z}`;
                if (cache.has(key)) return cache.get(key);
                if (cache.size >= 40000) throw new Error("已達 40000 格搜尋上限");
                cache.set(key, false);
                if (Date.now() > deadline) throw new Error("搜尋超時，請縮小範圍");
                const clearance = await request(`execute in ${dimension} if block ${x} ${y + 1} ${z} air run testforblock ${x} ${y + 2} ${z} air`);
                if (typeof clearance.statusCode !== "number" || clearance.statusCode < 0) return false;
                // Only verified full, non-hazardous floor blocks are traversable.
                for (const block of ["stone", "gold_block", "white_wool", "dirt", "grass_block", "cobblestone", "stone_bricks"]) {
                    if (await test(x, y, z, block)) {
                        cache.set(key, true);
                        if (block === "white_wool") white.add(key);
                        return true;
                    }
                }
                return false;
            };
            tell("§e[尋路] 正在搜尋路徑...");
            if (!await walkable(ax, az) || !await walkable(bx, bz)) throw new Error("起終點不通行，或地板材質不支援");
            const queue = [[ax, az]], parents = new Map([[`${ax},${az}`, null]]);
            let found = false;
            for (let index = 0; index < queue.length;) {
                // Expand a complete BFS layer so batching preserves shortest paths.
                const frontier = queue.slice(index);
                index += frontier.length;
                const candidates = [];
                const seen = new Set();
                for (const [x, z] of frontier) {
                if (x === bx && z === bz) { found = true; break; }
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
                    if (nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ || parents.has(key)) continue;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    candidates.push({ nx, nz, key, parent: [x, z] });
                }
                }
                if (found) break;
                const results = await Promise.allSettled(candidates.map(async candidate => ({ ...candidate, ok: await walkable(candidate.nx, candidate.nz) })));
                const failure = results.find(result => result.status === "rejected");
                if (failure) throw failure.reason;
                for (const result of results) {
                    const { nx, nz, key, parent, ok } = result.value;
                    if (ok) { parents.set(key, parent); queue.push([nx, nz]); }
                }
            }
            if (!found) return tell(`§e[尋路] 範圍 X=${bounds.minX}～${bounds.maxX}、Z=${bounds.minZ}～${bounds.maxZ} 內未找到路徑。可增加第七個參數（搜尋邊距，最多128）；目前僅支援同高度及指定地板材質。`);
            const path = [];
            for (let cursor = [bx, bz]; cursor; cursor = parents.get(cursor.join(","))) path.push(cursor);
            const changed = path.filter(([x, z]) => !white.has(`${x},${z}`)).map(([x, z]) => `setblock ${x} ${y} ${z} white_wool`);
            if (changed.length) await server.worldHistory.build(player, "path", changed, dimension);
            tell(`§a[尋路] 完成，最短路徑 ${path.length - 1} 步，標記 ${changed.length} 格。可使用 -undo`);
        } catch (error) {
            tell(`§c[尋路] ${error.message}`);
            server.emit("log", `Pathfinding: ${error.message}`);
        } finally { busy = false; }
    });
}

module.exports = initPathfindingPlugin;
