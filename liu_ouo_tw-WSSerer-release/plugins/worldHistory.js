const { randomUUID } = require("crypto");

function initWorldHistoryPlugin(server) {
    const history = [];
    let busy = false;
    const request = command => new Promise((resolve, reject) => {
        const id = randomUUID();
        const finish = (error, body) => {
            clearTimeout(timer);
            server.removeListener("worldCommandResponse", listener);
            error ? reject(error) : resolve(body);
        };
        const listener = (responseId, body) => {
            if (responseId !== id) return;
            if (typeof body.statusCode !== "number" || body.statusCode < 0) {
                const error = new Error(`${body.statusMessage || "Command failed"} [command: ${command}]`);
                error.response = body;
                finish(error);
            } else finish(null, body);
        };
        const timer = setTimeout(() => finish(new Error(`Command timed out: ${command}`)), 60000);
        server.on("worldCommandResponse", listener);
        try { server.runCommand(command, id, { silent: true }); } catch (error) { finish(error); }
    });
    const applyCommand = async command => {
        try {
            await request(command);
        } catch (error) {
            // A fill may fail when every target block already matches air.
            const match = command.match(/^execute in (overworld|nether|the_end) run fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) air$/);
            if (match) {
                const from = match.slice(2, 5).map(Number);
                const to = match.slice(5, 8).map(Number);
                const min = from.map((value, axis) => Math.min(value, to[axis]));
                const max = from.map((value, axis) => Math.max(value, to[axis]));
                const volume = min.reduce((total, value, axis) => total * (max[axis] - value + 1), 1);
                if (volume <= 64) {
                    try {
                        for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) {
                            await request(`execute in ${match[1]} run testforblock ${x} ${y} ${z} air`);
                        }
                        return;
                    } catch (verificationError) {
                        server.emit("log", `Air verification failed: ${verificationError.message}`);
                    }
                }
            }
            console.error("[WorldHistory] Command response:", error.response);
            throw error;
        }
    };
    const locked = async action => {
        if (busy) throw new Error("World operation in progress");
        busy = true;
        try { return await action(); } finally { busy = false; }
    };
    const save = async (entry, suffix) => {
        for (const tile of entry.tiles) {
            await request(`execute in ${entry.dimension} run structure save ${tile.name}_${suffix} ${tile.min.join(" ")} ${tile.max.join(" ")} false memory true`);
        }
    };
    const load = async (entry, suffix) => {
        for (const tile of entry.tiles) {
            await request(`execute in ${entry.dimension} run structure load ${tile.name}_${suffix} ${tile.min.join(" ")} 0_degrees none false true`);
        }
    };
    server.worldHistory = {
        build: (player, label, commands, expectedDimension) => locked(async () => {
            if (!player) throw new Error("Player required for world history");
            const result = await request(`querytarget ${JSON.stringify(player)}`);
            const targets = JSON.parse(result.details);
            const target = targets[0];
            if (!target || !target.position) throw new Error("Cannot resolve player position");
            const dimension = ({ 0: "overworld", 1: "nether", 2: "the_end" })[target.dimension];
            if (!dimension) throw new Error("Unknown dimension");
            if (expectedDimension && expectedDimension !== dimension) throw new Error("Player changed dimension; retry operation");
            const origin = [target.position.x, target.position.y, target.position.z].map(Math.floor);
            const points = [];
            const resolved = commands.map(command => {
                const tokens = command.trim().replace(/^\//, "").split(/\s+/);
                const count = tokens[0] === "fill" ? 6 : tokens[0] === "setblock" ? 3 : 0;
                if (!count) throw new Error(`Unsupported tracked command: ${tokens[0]}`);
                for (let i = 1; i <= count; i++) {
                    const coordinate = tokens[i];
                    if (!/^(?:~(?:-?\d+(?:\.\d+)?)?|-?\d+(?:\.\d+)?)$/.test(coordinate || "")) throw new Error("Unsupported coordinate");
                    tokens[i] = String(Math.floor(coordinate.startsWith("~") ? origin[(i - 1) % 3] + Number(coordinate.slice(1)) : Number(coordinate)));
                }
                points.push(tokens.slice(1, 4).map(Number));
                if (count === 6) points.push(tokens.slice(4, 7).map(Number));
                return `execute in ${dimension} run ${tokens.join(" ")}`;
            });
            if (!points.length) return;
            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (const point of points) for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], point[axis]);
                max[axis] = Math.max(max[axis], point[axis]);
            }
            const volume = min.reduce((value, coordinate, axis) => value * (max[axis] - coordinate + 1), 1);
            if (volume > 2000000 || history.length >= 20) throw new Error("History limit reached (20 operations / 2 million blocks per operation)");
            const entry = { player, label, timestamp: Date.now(), dimension, tiles: [], state: "pending" };
            const id = randomUUID().replace(/-/g, "");
            for (let x = min[0]; x <= max[0]; x += 64) for (let y = min[1]; y <= max[1]; y += 64) for (let z = min[2]; z <= max[2]; z += 64) {
                entry.tiles.push({ name: `wh_${id}_${entry.tiles.length}`, min: [x, y, z], max: [Math.min(x + 63, max[0]), Math.min(y + 63, max[1]), Math.min(z + 63, max[2])] });
            }
            await save(entry, "before");
            try {
                // Drain every in-flight command before allowing rollback to begin.
                for (let index = 0; index < resolved.length; index += 8) {
                    const results = await Promise.allSettled(resolved.slice(index, index + 8).map(applyCommand));
                    const failure = results.find(result => result.status === "rejected");
                    if (failure) throw failure.reason;
                }
                await save(entry, "after");
            } catch (error) {
                entry.state = "failed";
                history.push(entry);
                try { await load(entry, "before"); entry.state = "rolledback"; } catch (rollbackError) { server.emit("log", `Rollback failed: ${rollbackError.message}`); }
                throw error;
            }
            for (const previous of history) if (previous.state === "undone") previous.state = "superseded";
            entry.state = "done";
            history.push(entry);
        })
    };
    server.on("playerMessage", async (player, message) => {
        if (!["-undo", "-redo", "-history"].includes(message.trim())) return;
        if (!server.admins.includes(player)) return server.sendPrivateMessage(player, "§c[History] Admin only");
        try {
            if (message.trim() === "-history") {
                server.sendPrivateMessage(player, history.map(entry => `${new Date(entry.timestamp).toISOString()} ${entry.player} ${entry.label} [${entry.state}]`).join("\n") || "History empty");
                return;
            }
            await locked(async () => {
                const undo = message.trim() === "-undo";
                if (history.some(item => item.state === "failed")) throw new Error("A failed rollback requires manual recovery before further history operations");
                const ordered = undo ? [...history].reverse() : history;
                const entry = ordered.find(item => item.state === (undo ? "done" : "undone"));
                if (!entry) throw new Error("No operation available");
                if (entry.player !== player) throw new Error("Latest operation belongs to another player; restore it first to preserve ordering");
                await load(entry, undo ? "before" : "after");
                entry.state = undo ? "undone" : "done";
                server.sendPrivateMessage(player, `§a[History] ${undo ? "Undo" : "Redo"}: ${entry.label}`);
            });
        } catch (error) { server.sendPrivateMessage(player, `§c[History] ${error.message}`); }
    });
}

module.exports = initWorldHistoryPlugin;
