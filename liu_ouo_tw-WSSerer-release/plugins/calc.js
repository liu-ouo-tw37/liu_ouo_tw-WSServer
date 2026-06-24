const axios = require("axios");

function initCalcPlugin(server) {
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const calculaterWakeWord = server.calculaterWakeWord || "-calc?";
    const calcRegex = new RegExp(`^${escapeRegExp(calculaterWakeWord)}\\s*(.+)$`);

    const askWolfram = async (playerName, query) => {
        if (!server.wolframApiKey) {
            server.sendMessage("§c[系統] Wolfram Alpha API Key未設定，無法執行運算。");
            return;
        }

        try {
            const response = await axios.get("https://api.wolframalpha.com/v1/result", {
                params: {
                    appid: server.wolframApiKey,
                    i: query,
                    units: "metric"
                }
            });

            server.sendMessage(`§a[計算機] §l${response.data}`);
        } catch (error) {
            if (error.response && error.response.status === 501) {
                server.sendMessage("§c[計算機] Wolfram Alpha無法理解這個問題，請試著換種說法");
            } else {
                server.sendMessage("§c[計算機] 計算時發生錯誤，請確認 API Key 或稍後再試");
                console.error("Wolfram Error:", error.message);
            }
        }
    };

    server.on("playerMessage", (sender, message) => {
        const match = message.match(calcRegex);
        if (!match) return;

        askWolfram(sender, match[1].trim());
    });
}

module.exports = initCalcPlugin;
