const fs = require("fs");
const path = require("path");

function initMusicPlugin(server) {
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const musicWakeWord = server.musicWakeWord || "-music?";
    const playlistWakeWord = server.playlistWakeWord || "-playlist?";
    const nextWakeWord = server.nextWakeWord || "-next";
    const stopWakeWord = server.stopWakeWord || "-stop";
    const playlistEditWakeWord = "-playlist_edit";

    const musicRegex = new RegExp(`^${escapeRegExp(musicWakeWord)}\\s*(.*)$`);
    const playlistRegex = new RegExp(`^${escapeRegExp(playlistWakeWord)}\\s*(.*)$`);
    const nextRegex = new RegExp(`^${escapeRegExp(nextWakeWord)}$`);
    const stopRegex = new RegExp(`^${escapeRegExp(stopWakeWord)}$`);
    const playlistEditRegex = new RegExp(`^${escapeRegExp(playlistEditWakeWord)}\\s+(\\S+)\\s+(\\S+)(?:\\s+(.*))?$`);

    server.musicQueue = [];
    server.isPlayingMusic = false;
    server.isDatapackPlaying = false;
    server.currentSongName = "";
    server.currentSongTick = 0;
    server.totalSongTicks = 0;

    if (!server.musicList) {
        server.musicList = { "全部": [] };
    }
    const syncMusicFolder = () => {
        if (fs.existsSync(server.musicFolder)) {
        const files = fs.readdirSync(server.musicFolder).filter(f => f.endsWith(".json"));
        server.musicList["全部"] = files.map(f => f.replace(".json", ""));
        }
    };
    syncMusicFolder();

    server.savePlaylists = () => {
        server.playlistPath = server.playlistPath || path.join(server.musicDir, "playlists.json");

        server.savePlaylists = async () => {
            try {
            const fsPromises = require("fs").promises;
            const dataToSave = { ...server.musicList };
            delete dataToSave["全部"];
            
            await fsPromises.writeFile(server.playlistPath, JSON.stringify(dataToSave, null, 2), "utf-8");
            server.emit("log", "🎵 播放清單已成功儲存至: " + server.playlistPath);
            } catch (err) {
            server.emit("log", "❌ 儲存播放清單失敗：" + err.message);
            }
        };
    };

    const formatTime = (second) => {
        const min = Math.floor(second / 60);
        const sec = Math.floor(second % 60);
        return `${min}:${sec.toString().padStart(2, "0")}`;
    };

    const getSimilarity = (s1, s2) => {
        if (!s1 || !s2) return 0;
        const longer = s1.length >= s2.length ? s1 : s2;
        const shorter = s1.length < s2.length ? s1 : s2;
        const longerLength = longer.length;
        if (longerLength === 0) return 1.0;
        
        const costs = [];
        for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) {
            costs[j] = j;
            } else {
            if (j > 0) {
                let newValue = costs[j - 1];
                if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
        }
        return (longerLength - costs[shorter.length]) / longerLength;
    };

    const playNextMusic = () => {
        if (server.musicQueue.length === 0) {
        server.isPlayingMusic = false;
        server.isDatapackPlaying = false;
        server.currentSongName = "";
        server.sendMessage("§a[音樂] 已播放完畢，請加入音樂");
        return;
        }
        const nextSong = server.musicQueue.shift();
        setTimeout(() => {
        playDatapackMusic(nextSong);
        }, 100);
    };

    const playDatapackMusic = (songName) => {
        const filePath = path.join(server.musicFolder, `${songName}.json`);
        if (!fs.existsSync(filePath)) {
        server.sendMessage(`§c[音樂] 找不到檔案: ${songName}.json`);
        playNextMusic();
        return;
        }

        const songData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        server.isPlayingMusic = true;
        server.isDatapackPlaying = true;
        server.currentSongName = songName;
        server.totalSongTicks = songData.length > 0 ? songData[songData.length - 1].t : 0;
        server.currentSongTick = 0;

        const startTime = Date.now();
        let index = 0;

        const timer = setInterval(() => {
        if (!server.isDatapackPlaying) {
            clearInterval(timer);
            return;
        }

        const elapsedTicks = Math.floor((Date.now() - startTime) / 50);
        server.currentSongTick = elapsedTicks;

        while (index < songData.length && songData[index].t <= elapsedTicks) {
            const note = songData[index];
            server.runCommand(`playsound ${note.i} @a ~ ~ ~ 2 ${note.p.toFixed(4)}`);
            index++;
        }

        if (index >= songData.length) {
            clearInterval(timer);
            setTimeout(() => {
            if (server.isDatapackPlaying) {
                playNextMusic();
            }
            }, 3000);
        }
        }, 20);
    };

    const startStatusBarLoop = () => {
        setInterval(() => {
        if (!server.isDatapackPlaying && !server.isPlayingMusic) {
            const now = new Date();
            const realTimeStr = now.toLocaleTimeString('zh-TW', { 
            hour12: false, 
            timeZone: 'Asia/Taipei' 
            });
            const raw = { rawtext: [{ text: `現在時間(UTC+8)： §7${realTimeStr}` }] };
            server.runCommand(`titleraw @a[hasitem={item=clock,location=slot.weapon.mainhand}] actionbar ${JSON.stringify(raw)}`);
        } else {
            const now = new Date();
            const realTimeStr = now.toLocaleTimeString('zh-TW', { 
            hour12: false, 
            timeZone: 'Asia/Taipei' 
            });

            const currentTick = server.currentSongTick || 0;
            const totalTicks = server.totalSongTicks || 1;
            const persent = totalTicks > 0 ? ((currentTick / totalTicks) * 100).toFixed(1) : 0;

            const currentSec = currentTick / 20;
            const totalSec = totalTicks / 20;
            const currentTimeStr = formatTime(currentSec);
            const totalTimeStr = formatTime(totalSec);

            const songLen = (server.currentSongName || "音樂").length; 
            const paddingCount = (30 - songLen) / 2;
            const centerPadding = " ".repeat(Math.max(0, Math.floor(paddingCount)));

            const raw = {
            rawtext: [
                { text: `${centerPadding}§e正在播放: §b${server.currentSongName || "音樂"}\n` },
                { text: `§f[${currentTimeStr} / ${totalTimeStr}] §6${persent}% §8| §f現在時間(UTC+8)： §7${realTimeStr}` }
            ]
            };
            server.runCommand(`titleraw @a[hasitem={item=clock,location=slot.weapon.mainhand}] actionbar ${JSON.stringify(raw)}`);
        }
        }, 500);
    };
    
    startStatusBarLoop();

    server.on("playerMessage", (sender, message) => {
        const isAdmin = server.customSettings && server.customSettings.adminPlayers 
        ? server.customSettings.adminPlayers.includes(sender) 
        : true;

        let match = message.match(musicRegex);
        if (match) {
        const musicName = match[1].trim();
        if (!musicName) {
            server.sendPrivateMessage(sender, "§c[音樂] 請輸入要播放的歌曲名稱！");
            return;
        }
        
        const filePath = path.join(server.musicFolder, `${musicName}.json`);
        if (fs.existsSync(filePath)) {
            server.musicQueue.push(musicName);
            server.sendMessage(`§e[音樂] 已將 §b${musicName} §e加入播放清單 (目前共 ${server.musicQueue.length} 首)`);
            if (!server.isPlayingMusic) playNextMusic();
        } else {
            syncMusicFolder();
            const allSongs = server.musicList["全部"] || [];
            let bestMatch = null;
            let highestSimilarity = 0;
            
            allSongs.forEach(song => {
            const similarity = getSimilarity(musicName, song);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = song;
            }
            });
            
            if (bestMatch && highestSimilarity > 0.4) {
            server.sendPrivateMessage(sender, `§c[音樂] 找不到歌曲「${musicName}」`);
            server.sendPrivateMessage(sender, `§e你是不是要搜尋：${bestMatch}？`);
            server.sendPrivateMessage(sender, `§7輸入 -music?${bestMatch} 播放`);
            } else {
            server.sendPrivateMessage(sender, `§c[音樂] 找不到歌曲「${musicName}」`);
            }
        }
        return;
        }

        if (nextRegex.test(message)) {
        if (!isAdmin) {
            server.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
            return;
        }
        if (server.isPlayingMusic) {
            server.isDatapackPlaying = false;
            server.sendMessage("§e[音樂] 已切換至下一首");
            setTimeout(() => { playNextMusic(); }, 200);
        } else {
            server.sendMessage("§c[音樂] 目前沒有播放中的音樂");
        }
        return;
        }

        if (stopRegex.test(message)) {
        if (!isAdmin) {
            server.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
            return;
        }
        server.musicQueue = [];
        server.isPlayingMusic = false;
        server.isDatapackPlaying = false;
        server.sendMessage("§e[音樂] 已停止播放並清空播放清單");
        return;
        }

        match = message.match(playlistRegex);
        if (match) {
        const listName = match[1].trim();
        if (server.musicList[listName]) {
            let songs = [...server.musicList[listName]];
            for (let i = songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [songs[i], songs[j]] = [songs[j], songs[i]];
            }
            server.sendMessage(`§e[音樂] 正在載入播放清單：「${listName}」，共 ${songs.length} 首歌`);
            songs.forEach(song => server.musicQueue.push(song));
            if (!server.isPlayingMusic) playNextMusic();
        } else {
            const availableList = Object.keys(server.musicList).join("、");
            server.sendMessage(`§e[音樂] 找不到該播放清單 目前可選：${availableList}`);
        }
        return;
        }

        match = message.match(playlistEditRegex);
        if (match) {
        if (!isAdmin) return;

        const action = match[1];
        const listName = match[2];
        const songName = match[3] ? match[3].trim() : "";

        if (!listName) {
            server.sendPrivateMessage(sender, "§c用法: -playlist_edit <動作> <清單名> [歌名]");
            return;
        }

        switch (action) {
            case "create":
                server.musicList[listName] = [];
                server.savePlaylists();
                server.sendPrivateMessage(sender, `§a已建立播放清單: ${listName}`);
                break;
            case "add":
                if (!server.musicList[listName]) {
                    server.sendPrivateMessage(sender, "§e找不到此播放清單");
                } else if (!server.musicList["全部"].includes(songName)) {
                    server.sendPrivateMessage(sender, "§e找不到此歌曲");
                } else {
                    server.musicList[listName].push(songName);
                    server.savePlaylists();
                    server.sendPrivateMessage(sender, `§a已將§e${songName}§a加入§e${listName}`);
                }
                break;
            case "remove":
                if (server.musicList[listName]) {
                    server.musicList[listName] = server.musicList[listName].filter(s => s !== songName);
                    server.savePlaylists();
                    server.sendPrivateMessage(sender, `§a已從${listName}移除${songName}`);
                }
                break;
            case "delete":
                delete server.musicList[listName];
                server.savePlaylists();
                server.sendPrivateMessage(sender, `§a已刪除播放清單: ${listName}`);
                break;
        }
        return;
        }
    });
}

module.exports = initMusicPlugin;