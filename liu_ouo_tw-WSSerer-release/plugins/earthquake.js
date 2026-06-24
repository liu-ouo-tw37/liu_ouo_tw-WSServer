const axios = require("axios");

function initEarthquakePlugin(server) {
    const earthquakeRegex = /^-earthquake\?$/;
    let earthquakeEnabled = false;
    let lastEarthquakeID = server.lastEarthquakeID || "";

    const isAdmin = (sender) => {
        return Array.isArray(server.admins) && server.admins.includes(sender);
    };

    const checkEarthquake = async () => {
        if (!server.earthquakeApiKey || !earthquakeEnabled) return;

        try {
            const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001?Authorization=${server.earthquakeApiKey}&format=JSON`;
            const res = await axios.get(url);
            const earthquakes = res.data?.records?.Earthquake || [];
            if (earthquakes.length === 0) return;

            const latest = earthquakes[0];
            const eqID = latest.EarthquakeNo;
            const info = latest.EarthquakeInfo;
            if (!eqID || !info || eqID === lastEarthquakeID) return;

            lastEarthquakeID = eqID;
            server.lastEarthquakeID = eqID;

            const magnitude = info.EarthquakeMagnitude?.MagnitudeValue;
            const location = info.Epicenter?.Location;
            const depth = info.FocalDepth;

            server.runCommand('tellraw @a {"rawtext":[{"text":"§l§c⚠ 地震速報！"}]}');
            server.runCommand(`tellraw @a {"rawtext":[{"text":"§e規模 ${magnitude} §f| §7${location}\\n§c深度 ${depth}km"}]}`);
            server.runCommand('tellraw @a {"rawtext":[{"text":"§l§7地震速報，請注意安全。"}]}');
            server.runCommand("camerashake add @a");
            server.emit("log", `偵測到地震：${eqID}, 規模：${magnitude}`);
        } catch (err) {
            server.emit("log", `地震抓取失敗：${err.message}`);
        }
    };

    const interval = setInterval(checkEarthquake, 60000);
    if (typeof interval.unref === "function") interval.unref();

    server.on("playerMessage", (sender, message) => {
        if (!earthquakeRegex.test(message)) return;

        if (!isAdmin(sender)) {
            server.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
            return;
        }

        earthquakeEnabled = !earthquakeEnabled;
        server.earthquakeEnabled = earthquakeEnabled;
        const status = earthquakeEnabled ? "開啟" : "關閉";
        server.sendMessage(`§e[地震系統] 地震監測已${status}`);
    });
}

module.exports = initEarthquakePlugin;
