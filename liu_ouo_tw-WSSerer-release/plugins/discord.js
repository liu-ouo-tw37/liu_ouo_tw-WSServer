const { Client, GatewayIntentBits } = require("discord.js");

function initDiscordPlugin(server) {
    const token = server.discordToken;
    const channelId = server.discordChannelId;

    if (!token || !channelId || token.includes("這裡填")) {
        server.emit("log", "⚠️ Discord 設定未填寫，跳過 Discord Bot 啟動。");
        return null;
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    client.once("ready", () => {
        server.emit("log", `🤖 Discord Bot 已成功登入！目前身分：${client.user.tag}`);
    });

    // Minecraft to Discord
    server.on("playerMessage", async (sender, message) => {
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel) {
                await channel.send(`[MC] <${sender}> ${message}`);
            }
        } catch (err) {
            server.emit("log", `❌ 轉發遊戲訊息到 Discord 失敗: ${err.message}`);
        }
    });

    server.on("broadcastMessage", async (text) => {
        try {
            const cleanText = text.replace(/§[0-9a-fklmnorg]/g, "");
            if (cleanText.includes("<") && cleanText.includes(">") && !cleanText.includes("Discord")) {
                return;
            }

            const channel = await client.channels.fetch(channelId);
            if (channel) {
                await channel.send(cleanText);
            }
        } catch (err) {
            server.emit("log", `❌ 同步主程式訊息到 Discord 失敗: ${err.message}`);
        }
    });

    server.on("sendDiscordForecast", async (text) => {
        try {
            const cleanText = text.replace(/§[0-9a-fklmnorg]/g, "");
            const channel = await client.channels.fetch(channelId);
            if (channel) {
                await channel.send(cleanText);
            }
        } catch (err) {
            server.emit("log", `❌ Discord 傳送詳細天氣預報失敗: ${err.message}`);
        }
    });

    // Discord to Minecraft
    client.on("messageCreate", async (message) => {
        if (message.author.bot || message.channel.id !== channelId) return;

        const content = message.content.trim();
        const commandMatch = content.match(/^\/(.+)$/);

        if (commandMatch) {
            const mcCommand = commandMatch[1].trim();
            server.runCommand(mcCommand);
            return;
        }

        const isBlockedCommand = 
            content.includes(server.artWakeWord) ||
            content.includes(server.mazeWakeWord);

        if (isBlockedCommand) {
            await message.reply("⚠️ 該指令需要取得遊戲內玩家的精確座標，無法在 Discord 遠端使用喔！");
            return;
        }

        const isCustomCommand = 
            content.includes(server.aiWakeWord) ||
            content.includes(server.weatherWakeWord) ||
            content.includes(server.weatherPredictsWakeWord) ||
            content.includes(server.musicWakeWord) ||
            content.includes(server.nextWakeWord) ||
            content.includes(server.stopWakeWord) ||
            content.includes(server.playlistWakeWord) ||
            content.includes(server.examWakeWord) ||
            content.includes(server.answerWakeWord) ||
            content.includes(server.helpWakeWord) ||
            content.includes(server.cpuWakeWord) ||
            content.includes(server.cpuStopWakeWord) ||
            content.includes(server.earthquakeWakeWord) ||
            content.includes(server.calculaterWakeWord) ||
            content.includes(server.playlistEditWakeWord);

        if (isCustomCommand) {
            const mcMsg = `§r<${message.author.username}> ${content}`;
            server.sendMessage(mcMsg);

            server.emit("playerMessage", `Discord(${message.author.username})`, content);
            return;
        }

        if (content.length === 0) {
            return; 
        }

        try {
            const mcMessage = `§r<${message.author.username}> ${content}`;
            server.sendMessage(mcMessage);
        } catch (err) {
            server.emit("log", `❌ 轉發 Discord 訊息到 Minecraft 失敗: ${err.message}`);
        }
    });

    client.login(token).catch((err) => {
        server.emit("log", `❌ Discord Bot 登入失敗: ${err.message}`);
    });

    return client;
}

module.exports = initDiscordPlugin;