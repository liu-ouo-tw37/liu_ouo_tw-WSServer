const os = require("os-utils");

function initCpuPlugin(server) {
    const cpuRegex = /^-cpu\?$/;
    const cpuStopRegex = /^-cpu_stop\?$/;
    let cpuInterval = null;

    const isAdmin = (sender) => {
        return Array.isArray(server.admins) && server.admins.includes(sender);
    };

    const stopCPUWatcher = () => {
        if (!cpuInterval) return;

        clearInterval(cpuInterval);
        cpuInterval = null;
        server.runCommand("fill 200 -60 -40 200 -40 -40 air");
    };

    const startCPUWatcher = () => {
        stopCPUWatcher();
        server.sendMessage("§a[CPU監測系統] CPU監測已啟動");

        cpuInterval = setInterval(() => {
            os.cpuUsage((value) => {
                const usagePercent = Math.round(value * 100);
                const maxHeight = 20;
                const height = Math.max(1, Math.floor(value * maxHeight));

                server.runCommand("fill 200 -60 -40 200 -40 -40 air");
                let blockType = "lime_concrete";
                if (usagePercent > 50) blockType = "yellow_concrete";
                if (usagePercent > 85) blockType = "red_concrete";

                server.runCommand(`fill 200 -60 -40 200 ${height - 61} -40 ${blockType}`);
                server.runCommand(`titleraw @a actionbar {"rawtext":[{"text":"§eCPU 使用率: §l${usagePercent}%"}]}`);
            });
        }, 2000);
    };

    server.on("playerMessage", (sender, message) => {
        if (cpuRegex.test(message)) {
            if (!isAdmin(sender)) {
                server.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
                return;
            }

            server.sendMessage("§e[CPU監測系統] 正在啟動 CPU 監測...");
            startCPUWatcher();
            return;
        }

        if (cpuStopRegex.test(message)) {
            if (!isAdmin(sender)) {
                server.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
                return;
            }

            stopCPUWatcher();
        }
    });
}

module.exports = initCpuPlugin;
