const mazeLayout = require("../utils/mazeLayout");

function initMazePlugin(server) {
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mazeWakeWord = server.mazeWakeWord || "-maze?"; 
    const escapedWakeWord = Array.from(mazeWakeWord, char => "\\^$.*+?()[]{}|".includes(char) ? `\\${char}` : char).join("");
    const mazeRegex = new RegExp(`^${escapedWakeWord}\\s*(\\d+)\\*(\\d+)$`);
    let building = false;

    const isAdmin = (sender) => {
        return Array.isArray(server.admins) && server.admins.includes(sender);
    };

    const generateMaze = async (sizeX, sizeZ, color = 1, player) => {
        const blockMap = { 1: "stone", 2: "planks", 3: "glowstone" };
        const wallBlock = blockMap[color] || "stone";
        const goalBlock = "gold_block";
        const wallHeight = 6;
        const step = 2;
        const startOff = 2;

        const maxX = sizeX * step + startOff;
        const maxZ = sizeZ * step + startOff;
        server.runCommand("tickingarea remove maze_area");
        server.runCommand(`tickingarea add ~ ~-1 ~ ~${maxX} ~6 ~${maxZ} maze_area`);

        const maze = mazeLayout(sizeX, sizeZ);

        const goal = { x: sizeX - 1, z: sizeZ - 1 };
        const commands = [];
        server.sendMessage(`§e[迷宮] 開始生成 ${sizeX * 2}x${sizeZ * 2} 的迷宮...`);

        for (let i = 0; i < sizeX; i++) {
            for (let j = 0; j < sizeZ; j++) {
                const cX = i * step + startOff;
                const cZ = j * step + startOff;
                const floorMat = (i === goal.x && j === goal.z) ? goalBlock : "stone";

                if (j === 0) commands.push(`fill ~${cX} ~-1 ~2 ~${cX + 1} ~-1 ~${sizeZ * 2 + 1} stone`);
                if (floorMat === goalBlock) commands.push(`fill ~${cX} ~-1 ~${cZ} ~${cX + 1} ~-1 ~${cZ + 1} ${goalBlock}`);
                commands.push(`fill ~${cX + 1} ~ ~${cZ + 1} ~${cX + 1} ~${wallHeight - 1} ~${cZ + 1} ${wallBlock}`);
                commands.push(`fill ~${cX} ~ ~${cZ} ~${cX} ~${wallHeight - 1} ~${cZ} air`);

                const rBlock = maze[i][j].right ? "air" : wallBlock;
                const dBlock = maze[i][j].down ? "air" : wallBlock;
                commands.push(`fill ~${cX + 1} ~ ~${cZ} ~${cX + 1} ~${wallHeight - 1} ~${cZ} ${rBlock}`);
                commands.push(`fill ~${cX} ~ ~${cZ + 1} ~${cX} ~${wallHeight - 1} ~${cZ + 1} ${dBlock}`);
            }
        }

        commands.push(`fill ~${startOff - 1} ~ ~${startOff - 1} ~${sizeX * step + startOff} ~${wallHeight - 1} ~${startOff - 1} ${wallBlock}`);
        commands.push(`fill ~${startOff - 1} ~ ~${startOff - 1} ~${startOff - 1} ~${wallHeight - 1} ~${sizeZ * step + startOff} ${wallBlock}`);
        await server.worldHistory.build(player, `maze: ${sizeX * 2}x${sizeZ * 2}`, commands);
        server.sendMessage("§a[迷宮] 迷宮生成完成！");
        server.runCommand("tickingarea remove maze_area");
    };

    server.on("playerMessage", async (sender, message) => {
        const match = message.match(mazeRegex);
        if (!match) return;

        if (!isAdmin(sender)) {
            server.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
            return;
        }

        const sizeX = Math.floor(parseInt(match[1], 10) / 2);
        const sizeZ = Math.floor(parseInt(match[2], 10) / 2);

        if (sizeX < 1 || sizeZ < 1 || sizeX > 80 || sizeZ > 80) {
            server.sendPrivateMessage(sender, "§c[迷宮] 尺寸過大，最大為 160x160");
            return;
        }

        if (building) return server.sendPrivateMessage(sender, "§e[迷宮] 正在生成，請稍候");
        building = true;
        try {
            await generateMaze(sizeX, sizeZ, 1, sender);
        } catch (error) {
            console.error("[Maze] Generation failed:", error);
            server.emit("log", `Maze generation failed: ${error.message || error}`);
            server.sendPrivateMessage(sender, `§c[迷宮] 生成中斷：${error.message || error}`);
        } finally {
            building = false;
            server.runCommand("tickingarea remove maze_area");
        }
    });
}

module.exports = initMazePlugin;
