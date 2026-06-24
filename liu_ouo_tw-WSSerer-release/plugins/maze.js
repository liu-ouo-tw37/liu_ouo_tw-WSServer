function initMazePlugin(server) {
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mazeWakeWord = server.mazeWakeWord || "-maze?"; 
    const mazeRegex = new RegExp(`^${escapeRegExp(mazeWakeWord)}(\\d+)\\*(\\d+)`);

    const isAdmin = (sender) => {
        return Array.isArray(server.admins) && server.admins.includes(sender);
    };

    const generateMaze = async (sizeX, sizeZ, color = 1) => {
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

        const maze = Array.from({ length: sizeX }, () =>
            Array.from({ length: sizeZ }, () => ({ visited: false, right: false, down: false }))
        );

        let x = 0;
        let z = 0;
        const stack = [[x, z]];
        maze[x][z].visited = true;

        while (stack.length > 0) {
            const neighbors = [];
            if (x + 1 < sizeX && !maze[x + 1][z].visited) neighbors.push("right");
            if (x - 1 >= 0 && !maze[x - 1][z].visited) neighbors.push("left");
            if (z - 1 >= 0 && !maze[x][z - 1].visited) neighbors.push("up");
            if (z + 1 < sizeZ && !maze[x][z + 1].visited) neighbors.push("down");

            if (neighbors.length > 0) {
                const next = neighbors[Math.floor(Math.random() * neighbors.length)];
                stack.push([x, z]);

                if (next === "up") {
                    z -= 1;
                    maze[x][z].down = true;
                } else if (next === "down") {
                    maze[x][z].down = true;
                    z += 1;
                } else if (next === "right") {
                    maze[x][z].right = true;
                    x += 1;
                } else if (next === "left") {
                    x -= 1;
                    maze[x][z].right = true;
                }

                maze[x][z].visited = true;
            } else {
                [x, z] = stack.pop();
            }
        }

        const goal = { x: sizeX - 1, z: sizeZ - 1 };
        server.sendMessage(`§e[迷宮] 開始生成 ${sizeX * 2}x${sizeZ * 2} 的迷宮...`);

        for (let i = 0; i < sizeX; i++) {
            for (let j = 0; j < sizeZ; j++) {
                const cX = i * step + startOff;
                const cZ = j * step + startOff;
                const floorMat = (i === goal.x && j === goal.z) ? goalBlock : "stone";

                server.runCommand(`fill ~${cX} ~-1 ~${cZ} ~${cX + 1} ~-1 ~${cZ + 1} ${floorMat}`);
                server.runCommand(`fill ~${cX + 1} ~ ~${cZ + 1} ~${cX + 1} ~${wallHeight - 1} ~${cZ + 1} ${wallBlock}`);
                server.runCommand(`fill ~${cX} ~ ~${cZ} ~${cX} ~${wallHeight - 1} ~${cZ} air`);

                const rBlock = maze[i][j].right ? "air" : wallBlock;
                const dBlock = maze[i][j].down ? "air" : wallBlock;
                server.runCommand(`fill ~${cX + 1} ~ ~${cZ} ~${cX + 1} ~${wallHeight - 1} ~${cZ} ${rBlock}`);
                server.runCommand(`fill ~${cX} ~ ~${cZ + 1} ~${cX} ~${wallHeight - 1} ~${cZ + 1} ${dBlock}`);

                if ((i * sizeZ + j) % 20 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }

        server.runCommand(`fill ~${startOff - 1} ~ ~${startOff - 1} ~${sizeX * step + startOff} ~${wallHeight - 1} ~${startOff - 1} ${wallBlock}`);
        server.runCommand(`fill ~${startOff - 1} ~ ~${startOff - 1} ~${startOff - 1} ~${wallHeight - 1} ~${sizeZ * step + startOff} ${wallBlock}`);
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

        if (sizeX > 80 || sizeZ > 80) {
            server.sendPrivateMessage(sender, "§c[迷宮] 尺寸過大，最大為 160x160");
            return;
        }

        await generateMaze(sizeX, sizeZ, 1);
    });
}

module.exports = initMazePlugin;
