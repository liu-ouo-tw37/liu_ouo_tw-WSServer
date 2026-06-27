const axios = require("axios");
const { estimateFinalPayloadBytes } = require("../utils");

function initWeatherPlugin(server){
    const WSS_MAXIMUM_BYTES = 661;

    const weatherFormatTime = (unix) => {
        const date = new Date(unix * 1000);
        return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
    };

    const getVisualLength = (str) => {
        return str.split("").reduce((acc, char) => {
        return acc + (char.charCodeAt(0) > 255 ? 2 : 1);
        }, 0);
    };

    const formatSlot = (slotData) => {
        if (!slotData) return "無資料";
        const temp = slotData.main.temp.toFixed(2);
        const desc = slotData.weather[0].description;
        const humidity = slotData.main.humidity;
        return `${temp}°C | ${desc} (濕度: ${humidity}%)`;
    };

    // 實作一：即時天氣查詢
    async function fetchAndSendWeather(city){
        try {
        const GOOGLE_API_KEY = server.geocodingApiKey;
        const apiKey = server.openweatherApiKey;

        if (!GOOGLE_API_KEY || !apiKey){
            server.sendMessage("§c[系統] 尚未設定天氣或地理編碼 API Key，無法查詢");
            return;
        }

        server.emit("log", `正在為「${city}」進行地理編碼轉換...`);
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&language=zh-TW&key=${GOOGLE_API_KEY}`;
        const geoRes = await axios.get(geoUrl);

        if (geoRes.data.status !== "OK"){
            server.sendMessage(`§c很抱歉，地圖系統找不到「${city}」這個地方`);
            return;
        }
        
        const location = geoRes.data.results[0];
        const standardName = location.formatted_address;
        const { lat, lng } = location.geometry.location;

        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&lang=zh_tw`;
        const res = await axios.get(url);
        const data = res.data;

        const { coord, main, weather, visibility, wind, sys, clouds } = data;

        const baseDashCount = 10;
        const titleText = ` ${standardName} 的即時天氣報告 `;
        const titleVisualLength = getVisualLength(titleText);
        const topDashes = "-".repeat(baseDashCount);
        const fullHeader = `§b${topDashes}${titleText}${topDashes}`;
        const totalVisualLength = baseDashCount + titleVisualLength + baseDashCount;

        const report = [
            fullHeader,
            `§f§l位置：§7 約在經度${coord.lon}/緯度${coord.lat}的地方  (${sys.country})`,
            `§f§l天氣狀況： §e${weather[0].description} §f/ 雲量：§7${clouds.all}`,
            `§f§l目前氣溫： §6${main.temp}°C （體感：${main.feels_like}°C）`,
            `§f§l  溫差：§a 最低${main.temp_min}°C / 最高${main.temp_max}°C`,
            `§f§l  環境：§3 濕度 ${main.humidity}% / 氣壓 ${main.pressure}hPa`,
            `§f§l能見度：§d ${(visibility / 1000).toFixed(1)}km`,
            `§f§l風： §b風速${wind.speed}m/s, 風向${wind.deg}°`,
            `§f§l日出/日落： §6${weatherFormatTime(sys.sunrise)} / ${weatherFormatTime(sys.sunset)}`,
            `§b${"-".repeat(totalVisualLength)}`
        ].join("\n");

        server.sendMessage(report);
        } catch (err) {
        if (err.response && err.response.status === 404){
            server.sendMessage(`§c很抱歉，找不到「${city}」這個城市。`);
        } else {
            console.error("天氣查詢錯誤：", err.message);
            server.sendMessage(`§c天氣系統暫時發生問題，請稍後再試`);
        }
        }
    }

    async function handleWeatherForecast(sender, location) {
        if (!server.openweatherApiKey || !server.geocodingApiKey) {
        server.sendPrivateMessage(sender, "§c[系統] 伺服器未設定 Weather 或 Geocoding API Key，無法使用預報功能");
        return;
        }
        try {
            const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&language=zh-TW&key=${server.geocodingApiKey}`;
            const geoRes = await axios.get(geoUrl);
            if (!geoRes.data || geoRes.data.status !== "OK" || geoRes.data.results.length === 0) {
                server.runCommand(`tellraw "${sender}" {"rawtext":[{"text":"§c[系統] 找不到地點：「${location}」，請檢查地名是否正確。"}]}`);
                return;
            }
            const { lat, lng: lon } = geoRes.data.results[0].geometry.location;
            const cityName = geoRes.data.results[0].formatted_address;

            const currentWeatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=zh_tw&appid=${server.openweatherApiKey}`;
            const currentRes = await axios.get(currentWeatherUrl);
            
            const currentFeelsLike = currentRes.data.main.feels_like.toFixed(2);
            const currentHumidity = currentRes.data.main.humidity;
            const currentDesc = currentRes.data.weather[0].description;

            const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=zh_tw&appid=${server.openweatherApiKey}`;
            const forecastRes = await axios.get(forecastUrl);
            if (!forecastRes.data || !forecastRes.data.list) {
                server.runCommand(`tellraw "${sender}" {"rawtext":[{"text":"§c[系統] 天氣預報資料獲取失敗"}]}`);
                return;
            }

            const dailyData = {};
            forecastRes.data.list.forEach(item => {
                const dateObj = new Date(item.dt * 1000);
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                const hour = dateObj.getHours();

                if (!dailyData[dateStr]){
                dailyData[dateStr] = { morning: null, afternoon: null, evening: null };
                }
                if (hour >= 6 && hour <= 9 && !dailyData[dateStr].morning) dailyData[dateStr].morning = item;
                else if (hour >= 12 && hour <= 15 && !dailyData[dateStr].afternoon) dailyData[dateStr].afternoon = item;
                else if (hour >= 18 && hour <= 21 && !dailyData[dateStr].evening) dailyData[dateStr].evening = item;
            });

            if (sender && sender.includes("Discord")) {
                const forecastLines = [
                    `§b${cityName} 的天氣預報`,
                    `§f• 目前體感溫度：${currentFeelsLike}°C (${currentDesc})`,
                    `§f• 目前濕度：${currentHumidity}%`,
                    `§7-------------------------------------`,
                    `§b未來幾天預報：`
                ];

                const sortedDates = Object.keys(dailyData).sort().slice(0, 5);
                sortedDates.forEach(date => {
                    const slots = dailyData[date];
                    forecastLines.push(`§e• ${date}：`);
                    forecastLines.push(`  §6早上：${formatSlot(slots.morning)}`);
                    forecastLines.push(`  §g中午：${formatSlot(slots.afternoon)}`);
                    forecastLines.push(`  §9晚上：${formatSlot(slots.evening)}`);
                });

                server.emit("sendDiscordForecast", forecastLines.join("\n"));
                return;
            }

            let forecastLines = [
                `§b${cityName} 的天氣預報`,
                `§f• 目前體感溫度：${currentFeelsLike}°C (${currentDesc})`,
                `§f• 目前濕度：${currentHumidity}%`,
                `§7-------------------------------------`,
                `§b未來幾天預報：`
            ].join("\n");
            const escapedMsg = JSON.stringify(forecastLines);
            server.runCommand(`tellraw "${sender}" {"rawtext":[{"text":${escapedMsg}}]}`);

            const sortedDates = Object.keys(dailyData).sort().slice(0, 5);
            sortedDates.forEach(date => {
                const slots = dailyData[date];
                forecastLines = [
                    `§e• ${date}：`,
                    `  §6早上：${formatSlot(slots.morning)}`,
                    `  §g中午：${formatSlot(slots.afternoon)}`,
                    `  §9晚上：${formatSlot(slots.evening)}`
                ].join("\n");
                const escapedMsg = JSON.stringify(forecastLines);
                server.runCommand(`tellraw "${sender}" {"rawtext":[{"text":${escapedMsg}}]}`);
            });
        } catch (error) {
            server.emit("log", `查詢詳細預報失敗: ${error.message}`);
            server.sendPrivateMessage(sender, `§c[系統] 讀取天氣預報時發生非預期錯誤`);
        }
    }
    
    server.on("playerMessage", async (sender, message) => {
        const weatherRegex = new RegExp(`^${server.weatherWakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.+)$`);
        const weatherPredictsRegex = new RegExp(`^${server.weatherPredictsWakeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.+)$`);

        const weatherMatch = message.match(weatherRegex);
        if (weatherMatch){
            const city = weatherMatch[1].trim();
            if (city){
                await fetchAndSendWeather(city);
            } else {
                server.sendMessage("§c請輸入正確的城市名稱");
            }
            return;
        }

        const forecastMatch = message.match(weatherPredictsRegex);
        if (forecastMatch){
            const location = forecastMatch[1].trim();
            if (location){
                await handleWeatherForecast(sender, location);
            } else {
                server.sendPrivateMessage(sender, "§c請輸入正確的地點名稱以利查詢預報");
            }
            return;
        }
    });
}

module.exports = initWeatherPlugin;