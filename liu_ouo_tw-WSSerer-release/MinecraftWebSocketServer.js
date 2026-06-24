const websocket = require("nodejs-websocket");
const EventEmitter = require("events");
const { estimateFinalPayloadBytes, generateId } = require("./utils");
const axios = require("axios");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os-utils");

const WSS_MAXIMUM_BYTES = 661;

class MinecraftWebSocketServer extends EventEmitter {
  constructor(port, aiWakeWord, playerRegex, minecraftAI, cooldown = 5, openweatherApiKey, geocodingApiKey, musicDir, commandsDir, mathDbPath, earthquakeApiKey, wolframApiKey, statsPath, ownApiKey, customSettings = {}) {
    super(); // 初始化 EventEmitter
    this.port = port || "5218";
    this.aiWakeWord = aiWakeWord || "-ai?";
    this.weatherWakeWord = customSettings.weatherWakeWord || "-weather?";
    this.weatherPredictsWakeWord = customSettings.weatherPredictsWakeWord || "-weather_predicts?";
    this.artWakeWord = customSettings.artWakeWord || "-art?";
    this.musicWakeWord = customSettings.musicWakeWord || "-music?";
    this.nextWakeWord = "-next";
    this.stopWakeWord = "-stop";
    this.playlistWakeWord = "-playlist?";
    this.examWakeWord = customSettings.examWakeWord || "-exam?";
    this.answerWakeWord = customSettings.answerWakeWord || "-answer?";
    this.helpWakeWord = "-help";
    this.cpuWakeWord = "-cpu?";
    this.cpuStopWakeWord = "-cpu_stop?";
    this.earthquakeWakeWord = "-earthquake?";
    this.calculaterWakeWord = customSettings.calculaterWakeWord || "-calc?";
    this.playlistEditWakeWord = "-playlist_edit ";
    this.playerRegex = playerRegex;
    this.minecraftAI = minecraftAI;
    this.cooldown = cooldown; // 新增：冷卻時間（秒）
    this.playerCooldowns = new Map(); // 新增：追蹤玩家的冷卻時間 K: playerName, V: timestamp
    this.exams = new Map();

    this.openweatherApiKey = openweatherApiKey;
    this.geocodingApiKey = geocodingApiKey;
    this.earthquakeApiKey = earthquakeApiKey;
    this.wolframApiKey = wolframApiKey;

    this.musicFolder = musicDir;
    this.artFolder = commandsDir;
    this.mathDbPath = mathDbPath;
    this.statsPath = statsPath;

    this.wsServer = null;
    this.clientConn = null;
    this.cpuWatcherPos = null;
    this.lastEarthquakeID = null;

    this.earthquakeEnabled = false;
    this.musicQueue = [];
    this.isPlayingMusic = false;
    this.isDatapackPlaying = false;
    this.currentSongName = "";
    this.currentSongTick = 0;
    this.totalSongTicks = 0
    this.playlistPath = path.join(this.musicFolder, "custom_playlists.json");
    this.musicList = {};

    this.commandBatches = new Map(); // K: batchId, V: { commandCount, results, resolve, reject, timeout }
    this.requestIdToBatchId = new Map(); // K: requestId, V: batchId
    this.requestTimeoutMs = 60_000;

    if (fs.existsSync(this.musicFolder)){
      this.musicList["全部"] = fs.readdirSync(this.musicFolder)
        .filter(file => file.endsWith(".json") && file !== "custom_playlists.json")
        .map(file => file.replace(".json", ""));
    }
    if (fs.existsSync(this.artFolder)){
      this.artList = fs.readdirSync(this.artFolder)
        .filter(file => file.endsWith(".txt"))
        .map(file => file.replace(".txt", ""));
    }
    if (fs.existsSync(this.mathDbPath)){
      try {
        const mathData = JSON.parse(fs.readFileSync(this.mathDbPath, "utf-8"));
        this.allMathTopics = [...new Set(mathData.map(q => q.topic).filter(t => t))].map(t => t.trim());
      } catch (err){
        this.emit("log", `ERROR: ${err.message}`);
      }
    }
    if (fs.existsSync(this.statsPath)){
      try{
        const data = JSON.parse(fs.readFileSync(this.statsPath, "utf-8"));
        this.playerStats = data;
        this.emit("log", "成功讀取玩家歷史數據");
      } catch (err) {
        this.emit("log", "讀取玩家數據失敗" + err.message);
      }
    } else {
      this.playerStats = {};
      this.emit("log", "找不到玩家數據檔，已初始化新紀錄");
    }
    if (fs.existsSync(this.playlistPath)){
      try{
        const savedLists = JSON.parse(fs.readFileSync(this.playlistPath, "utf-8"));
        Object.assign(this.musicList, savedLists);
      } catch (err){
        this.emit("log", "讀取播放清單失敗" + err.message);
      }
    }

    const isPacked = __dirname.includes("app.asar");
    const resourcesBase = isPacked ? process.resourcesPath : __dirname;
    this.adminFilePath = path.join(resourcesBase, "admin.txt");
    this.admins = [];
    setInterval(() => this.loadAdmins(), 30000);
  }

  async loadAdmins(){
    try{
      const data = await fsPromises.readFile(this.adminFilePath, "utf8");
      this.admins = data
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } catch (err) {
      if (err.code === 'ENOENT'){
        await fsPromises.writeFile(this.adminFilePath, "", "utf8");
        this.admins = [];
        return;
      } else {
        console.error("[系統] 讀取admin.txt失敗：", err);
      }
    }
  }

  start() {
    this.wsServer = websocket
      .createServer((conn) => this.onOpen(conn))
      .listen(this.port, () => {
        this.emit("log", `✅ WebSocket 伺服器已啟動於端口 ${this.port}`);
        this.emit(
          "status-update",
          `等待連線中... (/wsserver localhost:${this.port})`
        );
      });

    this.wsServer.on("error", (err) => this.onError(null, err));
  }

  stop(reason = "已停止") {
    if (this.wsServer) {
      this.wsServer.close(() => this.emit("log", "🛑 WebSocket 伺服器已停止"));
      this.wsServer = null;
    }

    if (this.clientConn) {
      this.clientConn?.socket.destroy();
      this.clientConn = null;
    }

    this.emit("status-update", reason);
  }

  onOpen(conn) {
    this.emit("log", `🔗 客戶端已連線: ${conn.socket.remoteAddress}`);
    this.emit("status-update", "連線成功");
    this.clientConn = conn;

    this.sendMessage("§l§b- WebSocket連接成功!");
    this.eventSubscribe("PlayerMessage");

    conn.on("text", (msg) => this.onMessage(conn, msg));
    conn.on("close", (code, reason) => this.onClose(conn, code, reason));
    conn.on("error", (err) => this.onError(conn, err));
  }

  onMessage(conn, message) {
    try {
      const data = JSON.parse(message);
      const header = data.header || {};
      const body = data.body || {};

      if (header.eventName === "PlayerMessage" && body.type === "chat") {
        const sender = body.sender;
        const msg = body.message;
        this.playerMessage(sender, msg);
        this.emit("playerMessage", sender, msg);
      } else if (header.messagePurpose === "commandResponse") {
        const requestId = header.requestId;
        const statusMessage = body.statusMessage || "success";
        const batchId = this.requestIdToBatchId.get(requestId);

        if (batchId && this.commandBatches.has(batchId)) {
          this.requestIdToBatchId.delete(requestId);
          const batch = this.commandBatches.get(batchId);
          batch.results.push(statusMessage);

          if (batch.results.length === batch.commandCount) {
            clearTimeout(batch.timeout);
            this.commandBatches.delete(batchId);
            batch.resolve(batch.results); // 當批次中的所有指令都完成時，解析 Promise
          }
        }
      }
    } catch (err) {
      this.emit("log", `❌ 解析 JSON 時出錯: ${err.message}`);
    }
  }

  async playerMessage(sender, message) {
    // --- 新增：冷卻時間檢查邏輯 ---
    if (this.cooldown > 0) {
      const now = Date.now();
      const lastMessageTime = this.playerCooldowns.get(sender);

      if (lastMessageTime) {
        const timeElapsed = (now - lastMessageTime) / 1000; // 轉換為秒
        if (timeElapsed < this.cooldown) {
          const remainingTime = Math.ceil(this.cooldown - timeElapsed);
          this.sendMessage(
            `§e<AI> §c${sender} 的冷卻時間還有 ${remainingTime} 秒`
          );
          return; // 中斷後續執行
        }
      }
      this.playerCooldowns.set(sender, now); // 更新玩家的最後發言時間
    }
    // --- 冷卻邏輯結束 ---
    
    const isAdmin = this.admins.includes(sender);
    const artRegex         = new RegExp(`^${escapeRegExp(this.artWakeWord)}\\s*(.+)$`);
    const nextRegex        = /^-next$/;
    const stopRegex        = /^-stop$/;
    const helpRegex        = /^-help$/;
    
    if (helpRegex.test(message)){
        this.sendPrivateMessage(sender, "§b----- liu_ouo_tw的指令小精靈 -----\n");
        this.sendPrivateMessage(sender, "§e-ai?§g<指令>   §f- §l§a召喚AI§r\n");
        this.sendPrivateMessage(sender, "§e-weather?§g<現實世界中的位置>   §f- §l§a查詢當地的天氣§r\n");
        this.sendPrivateMessage(sender, "§e-music?§g<檔名>   §f- §l§a播放音樂/將音樂加入待播清單§r\n");
        this.sendPrivateMessage(sender, "§e-playlist?§g<播放清單名稱>   §f- §l§a播放播放清單中的歌曲§r\n");
        this.sendPrivateMessage(sender, "§e-exam?   §f- §l§a開始進行數學刷題練習§r\n");
        this.sendPrivateMessage(sender, "§e-answer?§g<答案>   §f- §l§a在考試過程中進行作答\n");
        this.sendPrivateMessage(sender, "                   §a(答案可能是：a、B、CE、(2,3)、23/7等)§r\n");
        this.sendPrivateMessage(sender, "§e-calc?§g<答案>   §f- §l§a計算數學問題(英文，支援較複雜問題)\n");
        this.sendPrivateMessage(sender, "§e-next   §f- §l§a播放下一首歌§r§7(僅管理員可使用此功能)§r\n");
        this.sendPrivateMessage(sender, "§e-stop   §f- §l§a停止播放所有歌曲並清空待播放清單§r§7(僅管理員可使用此功能)");
        this.sendPrivateMessage(sender, "§e-art?§g<檔名>   §f- §l§a生成畫作§r§7(僅管理員可使用此功能)§r\n");
        this.sendPrivateMessage(sender, "§e-maze?§g<長>§e*§g<寬>    §f- §l§a生成指定大小的迷宮§r§7(僅管理員可使用此功能)§r\n");
        this.sendPrivateMessage(sender, "§e-cpu    §f- §l§a顯示cpu使用狀況§r§7(僅管理員可使用此功能)§r\n");
        this.sendPrivateMessage(sender, "§e-playlist_edit <動作> <播放清單> <歌名>    §f- §l§a修改播放清單§r§7(僅管理員可使用此功能)§r\n");
        this.sendPrivateMessage(sender, "§6待新增更多功能...")
        return;
    }

    let match = message.match(artRegex);
    if (match){
      if (!isAdmin){
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      const art_name = match[1].trim();
      const filePath = path.join(this.artFolder, `${art_name}.txt`);
      if (fs.existsSync(filePath)) {
        await this.paintingBuild(art_name);
      } else {
        let bestMatch = null;
        let highestSimilarity = 0;
        this.artList.forEach(art => {
          const similarity = getSimilarity(art_name, art);
          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            bestMatch = art;
          }
        });
        this.sendPrivateMessage(sender, `§c[繪圖系統] 找不到畫作「${art_name}」`);
        if (bestMatch && highestSimilarity > 0.4){
          this.sendPrivateMessage(sender, `§e你是不是要找：${bestMatch}？`);
        }
      }
      return;
    }

    if (this.playerRegex && !new RegExp(this.playerRegex).test(sender)) return;
    if (this.aiWakeWord && !message.includes(this.aiWakeWord)) return;

    const initialTurn = await this.minecraftAI.processUserMessage(
      `<${sender}> ${message}`
    );
    await this.handleAITurn(initialTurn);
  }

  /**
   * 處理 AI 的一輪回應，可能包含文字和指令
   * @param {{text: string|null, commands: string[], newSession: boolean}} aiTurn
   */
  async handleAITurn(aiTurn) {
    if (aiTurn.newSession) {
      this.sendMessage("新對話已開始");
    }

    if (aiTurn.text) {
      this.sendMessage(`§e<AI> §r${aiTurn.text}`);
    }

    if (aiTurn.commands && aiTurn.commands.length > 0) {
      try {
        this.emit(
          "log",
          `準備執行 ${aiTurn.commands.length} 個指令...`
        );
        const results = await this.executeCommands(aiTurn.commands);
        this.emit(
          "log",
          `所有指令執行完畢，將 ${results.length} 個結果傳回 AI`
        );
        const nextAITurn = await this.minecraftAI.processCommandResults(results);
        await this.handleAITurn(nextAITurn); // 遞迴處理 AI 的下一輪回應
      } catch (error) {
        this.emit("log", `❌ 執行指令批次時出錯: ${error}`);
        this.sendMessage(`§c執行指令批次時出錯: ${error}`);
      }
    }
  }

  // 繪圖
  async paintingBuild(art_name){
    try{
      const filePath = path.join(this.artFolder, `${art_name}.txt`);
      if (!fs.existsSync(filePath)){
        this.sendMessage(`§c[繪圖系統] 找不到名為 "${art_name}" 的指令檔`);
        this.emit("log", `檔案不存在: ${filePath}`);
        return;
      }
      this.sendMessage(`§e[繪圖系統] 正在讀取 "${art_name}" 並準備執行... 請發送指令者不要移動`);
      
      const data = fs.readFileSync(filePath,"utf-8");
      const commands = data.split(/\r?\n/)
        .filter(line => line.trim() !== "")
        .map(cmd => convertJavaToBedrock(cmd.trim()));

      this.runCommand("tickingarea add ~0 ~0 ~0 ~-1500 ~379 ~0 painting_area1");
      this.runCommand("tickingarea add ~0 ~0 ~0 ~1500 ~379 ~0 painting_area2");
      this.runCommand("tickingarea add ~0 ~0 ~0 ~0 ~379 ~-1500 painting_area3");
      this.runCommand("tickingarea add ~0 ~0 ~0 ~0 ~379 ~1500 painting_area4");

      let count = 0;
      for (const cmd of commands){
        this.runCommand(cmd.trim());
        count ++;
        if (count % 15 === 0){
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      this.sendMessage(`§b[繪圖系統] "${art_name}" 繪製完成！`);
      this.runCommand("tickingarea remove painting_area1");
      this.runCommand("tickingarea remove painting_area2");
      this.runCommand("tickingarea remove painting_area3");
      this.runCommand("tickingarea remove painting_area4");
      this.emit("log", `成功執行 ${art_name} 共 ${count} 條指令`);
    } catch (err){
      this.emit("log", `執行畫作時出錯: ${err.message}`);
      this.sendMessage("§c[繪圖系統] 執行過程中發生錯誤，請檢查後台 Log");
    }
  }

  // 私訊
  sendPrivateMessage(player, msg) {
    const escapedMsg = JSON.stringify(msg);
    this.runCommand(`tellraw "${player}" {"rawtext":[{"text":${escapedMsg}}]}`);
  }
  sendSplitPrivateMessage(player, message){
    let remaining = message;
    while (remaining.length > 0){
      let bestChunk = "";
      if (estimateFinalPayloadBytes(remaining) <= 661){
        bestChunk = remaining;
        remaining = ""
      } else {
        for (let i = 1; i < remaining.length; i++){
          const candidate = remaining.substring(0, i);
          if (estimateFinalPayloadBytes(candidate) > 661) break;
          bestChunk = candidate;
        }
        remaining = remaining.substring(bestChunk.length);
      }
      const escapedMsg = JSON.stringify(bestChunk);
      this.runCommand(`tellraw "${player}" {"rawtext":[{"text":${escapedMsg}}]}`);
    }
  }

  /**
   * 執行一批指令並等待所有結果
   * @param {string[]} commands
   * @returns {Promise<string[]>}
   */
  executeCommands(commands) {
    return new Promise((resolve, reject) => {
      const batchId = generateId();
      const requestIds = commands.map(() => generateId());

      const batch = {
        commandCount: commands.length,
        results: [],
        resolve,
        reject,
        timeout: setTimeout(() => {
          // 清理超時的批次
          requestIds.forEach((reqId) => this.requestIdToBatchId.delete(reqId));
          this.commandBatches.delete(batchId);
          reject(`指令批次執行超時 (${this.requestTimeoutMs}ms)`);
        }, this.requestTimeoutMs),
      };
      this.commandBatches.set(batchId, batch);

      commands.forEach((command, index) => {
        const requestId = requestIds[index];
        this.requestIdToBatchId.set(requestId, batchId);
        this.runCommand(command, requestId);
      });
    });
  }

  onClose(conn, code, reason) {
    if (!this.wsServer) return;
    this.emit("log", `🚫 客戶端已斷線: 程式碼 ${code}, 原因 ${reason}`);
    this.emit("status-update", "已暫停: Minecraft 離線");
  }

  onError(conn, err) {
    this.emit("log", `⚠️ 發生錯誤: ${err}`);
    this.emit("status-update", `已暫停: ${err?.message || "未知錯誤"}`);
  }

  sendMessage(message) {
    let remaining = message;
    while (remaining.length > 0) {
      let bestChunk = "";
      let bestLength = 0;

      if (estimateFinalPayloadBytes(remaining) <= WSS_MAXIMUM_BYTES) {
        bestChunk = remaining;
        bestLength = remaining.length;
      } else {
        for (let i = 1; i <= remaining.length; i++) {
          const candidate = remaining.substring(0, i);
          if (estimateFinalPayloadBytes(candidate) > WSS_MAXIMUM_BYTES) break;
          bestChunk = candidate;
          bestLength = i;
        }
      }

      const escapedCommand = JSON.stringify(bestChunk);
      this.runCommand(`tellraw @a {"rawtext":[{"text":${escapedCommand}}]}`);
      remaining = remaining.substring(bestLength);
    }
  }

  /**
   * 執行單一指令
   * @param {string} command - 要執行的指令
   * @param {string | null} requestId - 用於追蹤的請求 ID
   */
  runCommand(command, requestId = null) {
    const reqId = requestId || generateId();
    const payload = JSON.stringify({
      header: {
        requestId: reqId,
        messagePurpose: "commandRequest",
        version: 17104896,
      },
      body: {
        commandLine: command,
        version: 17104896,
      },
    });

    if (Buffer.byteLength(payload, "utf8") > WSS_MAXIMUM_BYTES) {
      this.sendMessage("§c[runCommand] 指令太長無法執行");
      this.emit("log", `⚠️ 傳送的酬載過大 (${payload.length} 位元組)`);
      return;
    }

    if (requestId) {
      this.sendMessage(`§e[runCommand] §r: ${command}`);
      this.emit("log", `[${reqId.slice(0, 5)}] 執行中: ${command}`);
    }

    if (this.clientConn && !this.clientConn.closed) {
      this.clientConn.sendText(payload);
    }
  }

  eventSubscribe(eventName) {
    const payload = {
      header: {
        requestId: crypto.randomUUID(),
        messagePurpose: "subscribe",
        version: 17104896,
      },
      body: {
        eventName,
      },
    };
    this.clientConn?.sendText(JSON.stringify(payload));
    this.emit("log", `🔔 已訂閱事件: ${eventName}`);
  }
}

function escapeRegExp(string){
  if (!string) return "";
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = MinecraftWebSocketServer;

// Levenshtein Distaance
function getSimilarity(s1, s2){
  let longer = s1.toLowerCase();
  let shorter = s2.toLowerCase();
  if (s1.length < s2.length){
    longer = s2.toLowerCase();
    shorter = s1.toLowerCase();
  }
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;

  // DP
  const costs = [];  // 要花多少代價(刪1 插1 替換1)
  for (let i = 0; i <= longer.length; i++){
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++){
      if (i === 0){
        costs[j] = j;
      } else {
        if (j > 0){
          let newValue = costs[j-1];
          if (longer.charAt(i-1) !== shorter.charAt(j-1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (longerLength - costs[shorter.length]) / longerLength;
}

function convertJavaToBedrock(command){
  const blockMap = {
    "snow_block": "snow",
    "nether_quartz_ore": "quartz_ore",
    "end_stone_bricks": "end_bricks",
    "nether_bricks": "nether_brick",
    "red_nether_bricks": "red_nether_brick",
    "note_block": "noteblock",
    "light_gray_glazed_terracotta": "silver_glazed_terracotta",
    "bricks": "brick_block",
    "clay": "hardened_clay"
  };
  const stateMap = {
    "\\[axis=z\\]": ' ["pillar_axis"="z"]',
    "\\[axis=x\\]": ' ["pillar_axis"="x"]',
    "\\[axis=y\\]": ' ["pillar_axis"="y"]'
  };

  let converted = command;
  for (let [javaState, bedrockState] of Object.entries(stateMap)){
    const regex = new RegExp(javaState, "g");
    converted = converted.replace(regex, bedrockState);
  }
  for (let [javaId, bedrockId] of Object.entries(blockMap)){
    const regex = new RegExp(`\\b${javaId}\\b`, "g");
    converted = converted.replace(regex, bedrockId);
  }

  return converted;
}
