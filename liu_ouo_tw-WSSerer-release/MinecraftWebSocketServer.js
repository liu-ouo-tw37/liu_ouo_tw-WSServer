const websocket = require("nodejs-websocket");
const EventEmitter = require("events");
const { estimateFinalPayloadBytes, generateId } = require("./utils");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os-utils");

const WSS_MAXIMUM_BYTES = 661;

class MinecraftWebSocketServer extends EventEmitter {
  constructor(port, aiWakeWord, playerRegex, minecraftAI, cooldown = 5, openweatherApiKey, geocodingApiKey, musicDir, commandsDir, mathDbPath, earthquakeApiKey, wolframApiKey, statsPath, ownApiKey, customSettings = {}) {
    super(); // 初始化 EventEmitter
    this.port = port || "5218";
    this.aiWakeWord = aiWakeWord || "-ai?";
    this.weatherWakeWord = customSettings.weatherWakeWord || "-weather?";
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
    this.startStatusBarLoop();
    if (this.earthquakeApiKey){
      setInterval(() => this.checkEarthquake(), 60000);
    }

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

  loadAdmins(){
    try{
      if (!fs.existsSync(this.adminFilePath)){
        fs.writeFileSync(this.adminFilePath, "", "utf8");
        this.admins = [];
        return;
      }
      const data = fs.readFileSync(this.adminFilePath, "utf8");

      this.admins = data
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } catch (err) {
      console.error("[系統] 讀取admin.txt失敗：", err);
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
    const weatherRegex     = new RegExp(`^${escapeRegExp(this.weatherWakeWord)}\\s*(.+)$`);
    const artRegex         = new RegExp(`^${escapeRegExp(this.artWakeWord)}\\s*(.+)$`);
    const musicRegex       = new RegExp(`^${escapeRegExp(this.musicWakeWord)}\\s*(.+)$`);
    const playlistRegex    = new RegExp(`^${escapeRegExp(this.playlistWakeWord || "-playlist?")}\\s*(.+)$`);
    const examRegex        = new RegExp(`^${escapeRegExp(this.examWakeWord)}\\s*(.*)$`);
    const answerRegex      = new RegExp(`^${escapeRegExp(this.answerWakeWord)}\\s*(.+)$`);
    const calcRegex        = new RegExp(`^${escapeRegExp(this.calculaterWakeWord)}\\s*(.+)$`);
    const nextRegex        = /^-next$/;
    const stopRegex        = /^-stop$/;
    const helpRegex        = /^-help$/;
    const mazeRegex        = /^-maze\?(\d+)\*(\d+)/;
    const earthquakeRegex  = /^-earthquake\?$/;
    const cpuRegex         = /^-cpu\?$/;
    const cpuStopRegex     = /^-cpu_stop\?$/;
    const playlistEditRegex = /^-playlist_edit\s+(create|add|remove|delete)\s+(\S+)(?:\s+(.+))?$/;
    
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

    let match = message.match(weatherRegex);
    if (match){
      const city = match[1].trim();
      if (city){
        await this.fetchAndSendWeather(city);
        return;
      } else {
        this.sendMessage("§c請輸入正確的城市名稱");
      }
      return;
    }
    
    match = message.match(artRegex);
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

    match = message.match(musicRegex);
    if (match){
      const musicName = match[1].trim();
      const filePath = path.join(this.musicFolder, `${musicName}.json`);
      if (fs.existsSync(filePath)){
        this.musicQueue.push(musicName);
        this.sendMessage(`§e[音樂] 已將 §b${musicName} §e加入播放清單 (目前共 ${this.musicQueue.length} 首)`);
        if (!this.isPlayingMusic) this.playNextMusic();
      } else {
        const allSongs = this.musicList["全部"] || [];
        let bestMatch = null;
        let highestSimilarity = 0;
        allSongs.forEach(song => {
          const similarity = getSimilarity(musicName, song);
          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            bestMatch = song;
          }
        });
        if (bestMatch && highestSimilarity > 0.4){
          this.sendPrivateMessage(sender, `§c[音樂] 找不到歌曲「${musicName}」`);
          this.sendPrivateMessage(sender, `§e你是不是要搜尋：${bestMatch}？`);
          this.sendPrivateMessage(sender, `§7輸入 -music?${bestMatch} 播放`);
        } else {
          this.sendPrivateMessage(sender, `§c[音樂] 找不到歌曲「${musicName}」`);
        }
      }
      return;
    }
    if (nextRegex.test(message)){
      if (!isAdmin){
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      if (this.isPlayingMusic){
        this.isDatapackPlaying = false;
        this.sendMessage("§e[音樂] 已切換至下一首");
        setTimeout(() => { this.playNextMusic(); }, 200);
      } else {
        this.sendMessage("§c[音樂] 目前沒有播放中的音樂");
      }
      return;
    }
    if (stopRegex.test(message)){
      if (!isAdmin) {
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      this.musicQueue = [];
      this.isPlayingMusic = false;
      this.isDatapackPlaying = false;
      this.sendMessage("§e[音樂] 已停止播放並清空播放清單");
      return;
    }
    match = message.match(playlistRegex);
    if (match){
      const listName = match[1].trim();
      if (this.musicList[listName]){
        let songs = [...this.musicList[listName]];
        for (let i = songs.length - 1; i > 0; i--){
          const j = Math.floor(Math.random() * (i + 1));
          [songs[i], songs[j]] = [songs[j], songs[i]];
        }
        this.sendMessage(`§e[音樂] 正在載入播放清單：「${listName}」，共 ${songs.length} 首歌`);
        songs.forEach(song => this.musicQueue.push(song));
        if (!this.isPlayingMusic) this.playNextMusic();
      } else {
        const availableList = Object.keys(this.musicList).join("、");
        this.sendMessage(`§e[音樂] 找不到該播放清單 目前可選：${availableList}`);
      }
      return;
    }

    match = message.match(examRegex);
    if (match){
      const inputTopic = match[1].trim();
      const defaultTopic = "高中數學";
      if (!inputTopic){
        await this.mathQuestion(sender, defaultTopic);
        return;
      }
      if (this.allMathTopics.includes(inputTopic)){
        await this.mathQuestion(sender, inputTopic);
      } else {
        let bestMatch = null;
        let highestSimilarity = 0;
        this.allMathTopics.forEach(t => {
          const similarity = getSimilarity(inputTopic, t);
          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            bestMatch = t;
          }
        });
        if (bestMatch && highestSimilarity > 0.4){
          this.sendPrivateMessage(sender, `§c[考試系統] 找不到主題「${inputTopic}」`);
          this.sendPrivateMessage(sender, `§e您是不是要找：${bestMatch}？`);
          this.sendPrivateMessage(sender, `§7輸入 -exam?${bestMatch} 即可開始`);
        } else {
          this.sendPrivateMessage(sender, `§c[考試系統] 找不到主題「${inputTopic}」，改為練習全範圍`);
          await this.mathQuestion(sender, defaultTopic);
        }
      }
      return;
    }
    match = message.match(answerRegex);
    if (match){
      if (!this.exams.has(sender)) {
        this.sendPrivateMessage(sender, `§c[考試系統] 目前你沒有在進行的考試 請輸入-exam?...`);
        return;
      }
      const userAnswer = match[1].trim().toUpperCase();
      this.checkAnswer(sender, userAnswer);
      return;
    }

    match = message.match(mazeRegex);
    if (match){
      if (!isAdmin){
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      const sizeX = Math.floor(parseInt(match[1]) / 2);
      const sizeZ = Math.floor(parseInt(match[2]) / 2);
      if (sizeX > 80 || sizeZ > 80){
        this.sendPrivateMessage(sender, "§c[迷宮] 尺寸過大！最大限制為160x160");
        return;
      }
      this.generateMaze(sizeX, sizeZ, {x: "~", y: "~", z: "~"}, 1);
      return;
    }

    if (earthquakeRegex.test(message)){
      if (!isAdmin){
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      this.earthquakeEnabled = !this.earthquakeEnabled;
      const status = this.earthquakeEnabled ? "開啟" : "關閉";
      this.sendMessage(`§e[地震系統] 地震監測已${status}`);
      return;
    }

    if (cpuRegex.test(message)){
      if (!isAdmin){
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      this.sendMessage("§e[效能監控系統] 建立監控牆中...");
      this.startCPUWatcher("~", "~", "~");
      return;
    }
    if (cpuStopRegex.test(message)){
      if (!isAdmin){
        this.sendPrivateMessage(sender, "§c[系統] 你沒有權限使用此功能");
        return;
      }
      this.stopCPUWatcher();
      return;
    }

    match = message.match(calcRegex);
    if (match) {
      const query = match[1].trim();
      this.askWolfram(sender, query);
      return;
    }

    match = message.match(playlistEditRegex);
    if (match){
      if (!isAdmin) return;

      const action = match[1];     // create, add, remove, delete
      const listName = match[2];
      const songName = match[3] ? match[3].trim() : "";

      if (!listName){
        this.sendPrivateMessage(sender, "§c用法: -playlist_edit <動作> <清單名> [歌名]");
        return;
      }

      switch (action){
        case "create":
          this.musicList[listName] = [];
          this.savePlaylists();
          this.sendPrivateMessage(sender, `§a已建立播放清單: ${listName}`);
          break;
        
        case "add":
          if (!this.musicList[listName]){
            this.sendPrivateMessage(sender, "§e找不到此播放清單");
          } else if (!this.musicList["全部"].includes(songName)){
            this.sendPrivateMessage(sender, "§e找不到此歌曲");
          } else {
            this.musicList[listName].push(songName);
            this.savePlaylists();
            this.sendPrivateMessage(sender, `§a已將§e${songName}§a加入§e${listName}`);
          }
          break;
        
        case "remove":
          if (this.musicList[listName]){
            this.musicList[listName] = this.musicList[listName].filter(s => s !== songName);
            this.savePlaylists();
            this.sendPrivateMessage(sender, `§a已從${listName}移除${songName}`);
          }
          break;

        case "delete":
          delete this.musicList[listName];
          this.savePlaylists();
          this.sendPrivateMessage(sender, `§a已刪除播放清單: ${listName}`);
          break;
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

  // 查天氣
  async fetchAndSendWeather(city){
    try {
      const GOOGLE_API_KEY = this.geocodingApiKey;
      const apiKey = this.openweatherApiKey;

      if (!GOOGLE_API_KEY || !apiKey){
        this.sendMessage("§c[系統] 尚未設定天氣或地理編碼 API Key，無法查詢");
        return;
      }

      this.emit("log", `正在為「${city}」進行地理編碼轉換...`);
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&language=zh-TW&key=${GOOGLE_API_KEY}`;
      const geoRes = await axios.get(geoUrl);

      if (geoRes.data.status !== "OK"){
        this.sendMessage(`§c很抱歉，地圖系統找不到「${city}」這個地方`);
        return;
      }
      
      const location = geoRes.data.results[0];
      const standardName = location.formatted_address;
      const { lat, lng } = location.geometry.location;

      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&lang=zh_tw`;
      const res = await axios.get(url);
      const data = res.data;

      const {
        coord,
        main,
        weather,
        visibility,
        wind,
        sys,
        clouds
      } = data;

      const weatherFormatTime = (unix) => {
        const date = new Date(unix * 1000);
        return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
      }
      const getVisualLength = (str) => {
        return str.split("").reduce((acc, char) => {
          return acc + (char.charCodeAt(0) > 255 ? 2 : 1);
        }, 0);
      };

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

      this.sendMessage(report);
    } catch (err) {
      if (err.response && err.response.status === 404){
        this.sendMessage(`§c很抱歉，找不到「${city}」這個城市。`);
      } else {
        console.error("天氣查詢錯誤：", err.message);
        this.sendMessage(`§c天氣系統暫時發生問題，請稍後再試`)
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

  // 音樂
  async playNextMusic(){
    if (this.musicQueue.length === 0){
      this.isPlayingMusic = false;
      this.isDatapackPlaying = false;
      this.currentSongName = "";
      this.sendMessage("§a[音樂] 已播放完畢，請加入音樂");
      return;
    }
    const nextSong = this.musicQueue.shift();
    setTimeout(() => {
      this.playDatapackMusic(nextSong);
    }, 100);
  }
  formatTime(second){
    const min = Math.floor(second / 60);
    const sec = Math.floor(second % 60);
    return `${min}:${sec.toString().padStart(2, "0")}`
  }
  async playDatapackMusic(songName){
    const filePath = path.join(this.musicFolder, `${songName}.json`);
    if (!fs.existsSync(filePath)) {
      this.sendMessage(`§c[音樂] 找不到檔案: ${songName}.json`);
      this.playNextMusic();
      return;
    }

    const songData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    this.isPlayingMusic = true;
    this.isDatapackPlaying = true;
    this.currentSongName = songName;
    this.totalSongTicks = songData.length > 0 ? songData[songData.length - 1].t : 0;
    this.currentSongTick = 0;

    const startTime = Date.now();
    let index = 0;

    const timer = setInterval(() => {
      if (!this.isDatapackPlaying){
        clearInterval(timer);
        return;
      }

      const elapsedTicks = Math.floor((Date.now() - startTime) / 50);
      this.currentSongTick = elapsedTicks;

      while (index < songData.length && songData[index].t <= elapsedTicks){
        const note = songData[index];

        this.runCommand(`playsound ${note.i} @a ~ ~ ~ 2 ${note.p.toFixed(4)}`);
        index ++;
      }

      if (index >= songData.length){
        clearInterval(timer);
        setTimeout(() => {
          if (this.isDatapackPlaying){
            this.playNextMusic();
          }
        }, 3000);
      }
    }, 20);
  }

  // 拿著時鐘的效果
  startStatusBarLoop(){
    setInterval(() => {
      if (!this.clientConn) return;
      const now = new Date();
      const realTimeStr = now.toLocaleTimeString('zh-TW', { 
        hour12: false, 
        timeZone: 'Asia/Taipei' 
      });

      if (!this.isPlayingMusic || !this.isDatapackPlaying){
        const raw = { rawtext: [{ text: `現在時間(UTC+8)： §7${realTimeStr}` }] };
        this.runCommand(`titleraw @a[hasitem={item=clock,location=slot.weapon.mainhand}] actionbar ${JSON.stringify(raw)}`);
      } else {
        const currentTick = this.currentSongTick || 0;
        const totalTicks = this.totalSongTicks || 1;
        const persent = totalTicks > 0 ? ((currentTick / totalTicks) * 100).toFixed(1) : 0;

        const currentSec = currentTick / 20;
        const totalSec = totalTicks / 20;
        const currentTimeStr = this.formatTime(currentSec);
        const totalTimeStr = this.formatTime(totalSec);

        // 置中
        const songLen = (this.currentSongName || "音樂").length; 
        const paddingCount = (30 - songLen) / 2;
        const centerPadding = " ".repeat(Math.max(0, Math.floor(paddingCount)));

        const raw = {
          rawtext: [
            {text: `${centerPadding}§e正在播放: §b${this.currentSongName || "音樂"}\n`},
            {text: `§f[${currentTimeStr} / ${totalTimeStr}] §6${persent}% §8| §f現在時間(UTC+8)： §7${realTimeStr}`}
          ]
        };
        this.runCommand(`titleraw @a[hasitem={item=clock,location=slot.weapon.mainhand}] actionbar ${JSON.stringify(raw)}`);
      }
    }, 500);
  }

  // 數學練習
  async mathQuestion(playerName, topic){
    try{
      if (this.exams.has(playerName)) {
        this.sendPrivateMessage(playerName, "§c[考試系統] 你已經在考試中，請完成後再重新開始。");
        return;
      }
      // 讀取
      const allData = JSON.parse(fs.readFileSync(this.mathDbPath, "utf-8"));

      let pool = allData;
      if (topic !== "高中數學"){
        pool = allData.filter(q => q.topic === topic);
      }
      if (pool.length < 6){
        if (topic !== "高中數學"){
          this.sendPrivateMessage(playerName, `§7主題「${topic}」題目較少，已混合其他題目`);
        }
        pool = allData;
      }
      const playerStats = this.getPlayerStats(playerName);

      // 計算遺忘曲線
      const weightedData = pool.map(q => {
        let weight = 1.0;
        const record = playerStats.mastery[q.id];

        if (record){
          const hoursSinceLast = (Date.now() - record.last_time) / (1000 * 60 * 60);
          weight = (1 / (record.correct_count + 1)) * (1 + hoursSinceLast / 168);
        }
        return {...q, currentWeight: weight};
      });

      const sampleByWeight = (arr, n) => {
        if (arr.length <= n) return arr;
        return arr
          .sort((a, b) => b.currentWeight - a.currentWeight)
          .slice(0, n * 2)
          .sort(() => 0.5 - Math.random())
          .slice(0, n);
      };

      const singles = weightedData.filter(q => q.type === "single");
      const multiples = weightedData.filter(q => q.type === "multiple");
      const maths = weightedData.filter(q => q.type === "math");
      
      const examSet = [
        ...sampleByWeight(singles, 2),
        ...sampleByWeight(multiples, 2),
        ...sampleByWeight(maths, 2)
      ];
      
      if (examSet.length < 6){
        this.sendPrivateMessage(playerName, "§c[考試系統] 題庫題目不足，無法組成6題測驗");
        return;
      }
      
      this.exams.set(playerName, {
        questions: examSet,
        currentIndex: 0,
        score: 0
      });

      this.sendPrivateMessage(playerName, `§e[考試系統] 測驗開始 共六題 輸入-answer?作答`);
      this.sendCurrentQuestion(playerName);
    } catch (err){
      console.error(err);
      this.sendPrivateMessage(playerName, "§c題庫讀取失敗。");
    }
  }
  sendCurrentQuestion(playerName){
    const exam = this.exams.get(playerName);
    if (!exam) return;

    const q = exam.questions[exam.currentIndex];
    setTimeout(() => {
      this.sendPrivateMessage(playerName, `§f--------------------------------`);
      this.sendPrivateMessage(playerName, `§e第 ${exam.currentIndex + 1} 題 (${this.translateType(q.type)})`);
      this.sendPrivateMessage(playerName, `§a主題：§7${q.topic || "一般"}`);
      this.sendPrivateMessage(playerName, `§f${q.question}`);

      if (q.options && q.options.length > 0) {
        q.options.forEach((opt, i) => {
          setTimeout(() => this.sendPrivateMessage(playerName, `§7${opt}`), i * 50);
        });
      }
    }, 100);
  }
  checkAnswer(playerName, userAnswer){
    const exam = this.exams.get(playerName);
    if (!exam) return;
    
    const currentQ = exam.questions[exam.currentIndex];
    const correct = currentQ.answer.toUpperCase();
    let isRight = false;

    if (currentQ.type === "multiple"){
      const sortedUser = userAnswer.split("").sort().join("");
      const sortedCorrect = correct.split("").sort().join("");
      isRight = (sortedUser === sortedCorrect);
    } else {
      isRight = (userAnswer === correct);
    }

    const stats = this.getPlayerStats(playerName);
    if (!stats.mastery[currentQ.id]){
      stats.mastery[currentQ.id] = { correct_count: 0, last_time: 0 };
    }

    if (isRight){
      stats.mastery[currentQ.id].correct_count ++;
      exam.score ++;
      this.sendPrivateMessage(playerName, "§a§l✔ 回答正確")
    } else {
      stats.mastery[currentQ.id].correct_count = Math.max(0, stats.mastery[currentQ.id].correct_count - 1);
      this.sendPrivateMessage(playerName, `§c§l✘ 回答錯誤  正確答案為§6${correct}`);
    }

    stats.mastery[currentQ.id].last_time = Date.now();
    this.savePlayerStats(playerName, stats);

    exam.currentIndex ++;
    if (exam.currentIndex < 6){
      setTimeout(() => this.sendCurrentQuestion(playerName), 1000);
    } else {
      const totalScore = exam.score;
      this.runCommand(`playsound random.screenshot "${playerName}"`)
      this.sendPrivateMessage(playerName, `§6§l[測驗結束] §e總共答對§a${totalScore} §e/ 6題！`);
      this.exams.delete(playerName);
    }
  }
  savePlayerStats(playerName, stats){
    const filePath = this.statsPath
    let allStats = {};
    if (fs.existsSync(filePath)){
      allStats = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    allStats[playerName] = stats;
    fs.writeFileSync(filePath, JSON.stringify(allStats, null, 2));
  }
  getPlayerStats(playerName){
    const filePath = this.statsPath
    if (!fs.existsSync(filePath)) return { answer_ids: [], mastery: {} };
    const allStats = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return allStats[playerName] || { answer_ids: [], mastery: {} };
  }
  translateType(type){
      const types = {
        "single": "單選題",
        "multiple": "多選題",
        "math": "填充題"
      };
      return types[type] || "一般題型";
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

  //迷宮生成器
  async generateMaze(sizeX, sizeZ, pos, color){
    const blockMap = {1: "stone", 2: "planks", 3: "glowstone"};
    const wallBlock = blockMap[color] || "stone";
    const goalBlock = "gold_block";
    const wall_h = 6;
    const step = 2;
    const startOff = 2;

    const maxX = sizeX * step + startOff;
    const maxZ = sizeZ * step + startOff;
    this.runCommand("tickingarea remove maze_area");
    this.runCommand(`tickingarea add ~ ~-1 ~ ~${maxX} ~6 ~${maxZ} maze_area`);

    // DFS生成迷宮
    let maze = Array.from({ length: sizeX }, () =>
      Array.from({ length: sizeZ }, () => ({visited: false, right: false, down: false}))
    );
    let x = 0, z = 0, stack = [[x, z]];
    maze[x][z].visited = true;

    while (stack.length > 0){
      let neighbors = [];
      if (x + 1 < sizeX && !maze[x+1][z].visited) neighbors.push("right");
      if (x - 1 >= 0 && !maze[x-1][z].visited) neighbors.push("left");
      if (z - 1 >= 0 && !maze[x][z-1].visited) neighbors.push("up");
      if (z + 1 < sizeZ && !maze[x][z+1].visited) neighbors.push("down");

      if (neighbors.length > 0){
        let next = neighbors[Math.floor(Math.random() * neighbors.length)];
        stack.push([x, z]);
        if (next === "up"){
          z -= 1;
          maze[x][z].down = true;
        } else if (next === "down"){
          maze[x][z].down = true;
          z += 1;
        } else if (next === "right"){
          maze[x][z].right = true;
          x += 1;
        } else if (next === "left"){
          x -= 1;
          maze[x][z].right = true;
        }
        maze[x][z].visited = true;
      } else {
        let [px, pz] = stack.pop();
        x = px;
        z = pz;
      }
    }
    const goal = { x: sizeX-1, z: sizeZ-1 };
    // 建造
    this.sendMessage(`§e[迷宮] 正在生成${sizeX * 2}x${sizeZ * 2}的迷宮...`);
    for (let i = 0; i < sizeX; i++){
      for (let j = 0; j < sizeZ; j++){
        const cX = i * step + startOff;
        const cZ = j * step + startOff;

        const floorMat = (i === goal.x && j === goal.z) ? goalBlock : "stone";
        this.runCommand(`fill ~${cX} ~-1 ~${cZ} ~${cX+1} ~-1 ~${cZ+1} ${floorMat}`);
        this.runCommand(`fill ~${cX+1} ~ ~${cZ+1} ~${cX+1} ~${wall_h-1} ~${cZ+1} ${wallBlock}`);
        this.runCommand(`fill ~${cX} ~ ~${cZ} ~${cX} ~${wall_h-1} ~${cZ} air`);
        
        const rBlock = maze[i][j].right ? "air" : wallBlock;
        this.runCommand(`fill ~${cX+1} ~ ~${cZ} ~${cX+1} ~${wall_h-1} ~${cZ} ${rBlock}`);
        const dBlock = maze[i][j].down ? "air" : wallBlock;
        this.runCommand(`fill ~${cX} ~ ~${cZ+1} ~${cX} ~${wall_h-1} ~${cZ+1} ${dBlock}`);

        if ((i * sizeZ + j) % 20 === 0){
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    this.runCommand(`fill ~${startOff-1} ~ ~${startOff-1} ~${sizeX*step+startOff} ~${wall_h-1} ~${startOff-1} ${wallBlock}`);
    this.runCommand(`fill ~${startOff-1} ~ ~${startOff-1} ~${startOff-1} ~${wall_h-1} ~${sizeZ*step+startOff} ${wallBlock}`);

    this.sendMessage("§g[迷宮] 迷宮生成完成！")
    this.runCommand("tickingarea remove maze_area");
  }

  // 地震偵測
  async checkEarthquake(){
    if (!this.earthquakeApiKey) return;

    setInterval(async () =>{
      if (!this.earthquakeEnabled) return;

      try{
        const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001?Authorization=${this.earthquakeApiKey}&format=JSON`;
        const res = await axios.get(url);
        const data = res.data;

        if (data.records && data.records.Earthquake.length > 0){
          const lastest = data.records.Earthquake[0];
          const eqID = lastest.EarthquakeNo;
          const info = lastest.EarthquakeInfo;

          if (!this.lastEarthquakeID) this.lastEarthquakeID = "";
          if (eqID !== this.lastEarthquakeID){
            this.lastEarthquakeID = eqID;
            const magnitude = info.EarthquakeMagnitude.MagnitudeValue;
            const location = info.Epicenter.Location;
            const depth = info.FocalDepth;

            this.runCommand('tellraw @a {"rawtext":[{"text":"§l§c發生地震！！"}]}');
            this.runCommand(`tellraw @a {"rawtext":[{"text":"§e規模 ${magnitude} §f| §7${location}\n§c深度 ${depth}km"}]}`)
            this.runCommand('tellraw @a {"rawtext":[{"text":"§l§7地震發生，請做好趴下、掩護、穩住的動作(如果你在震央附近的話)"}]}');
            this.runCommand("camerashake add @a");
            this.emit("log", `偵測到地震：${eqID}, 規模：${magnitude}`);
          }
        }
      } catch (err){
        this.emit("log", `地震抓取失敗：${err.message}`);
      }
    }, 60000);
  }

  // CPU監測
  startCPUWatcher(){
    this.stopCPUWatcher();
    this.sendMessage("§a[效能監測系統] CPU監測牆已啟動");

    this.cpuInterval = setInterval(() => {
      os.cpuUsage((v) => {
        const usagePercent = Math.round(v * 100);
        const max_h = 20;
        const height = Math.max(1, Math.floor(v * max_h));

        this.runCommand(`fill 200 -60 -40 200 -40 -40 air`);
        let blockType = "lime_concrete";
        if (usagePercent > 50) blockType = "yellow_concrete";
        if (usagePercent > 85) blockType = "red_concrete";

        this.runCommand(`fill 200 -60 -40 200 ${height - 61} -40 ${blockType}`);
        this.runCommand(`titleraw @a actionbar {"rawtext":[{"text":"§eCPU 負載: §l${usagePercent}%"}]}`);
      });
    }, 2000);
  }
  stopCPUWatcher(){
    if (this.cpuInterval){
      clearInterval(this.cpuInterval);
      this.cpuInterval = null;

      if (this.cpuWatcherPos){
        this.runCommand(`fill 200 -60 -40 200 -40 -40 air`);
        this.cpuWatcherPos = null;
      }
    }
  }

  // 計算機
  async askWolfram(playerName, query){
    if (!this.wolframApiKey){
      this.sendMessage("§c[系統] Wolfram Alpha API Key未設定，無法執行運算。");
      return;
    }

    try{
      const url = `https://api.wolframalpha.com/v1/result`;
      const response = await axios.get(url, {
        params: {
          appid: this.wolframApiKey,
          i: query,
          units: "metric"
        }
      });
      this.sendMessage(`§a[計算機] §l${response.data}`);
    } catch (error) {
      if (error.response && error.response.status === 501){
        this.sendMessage("§c[計算機] Wolfram Alpha無法理解這個問題，請試著換種說法");
      } else {
        this.sendMessage("§c[計算機] 計算服務暫時不可用，請檢查網路或API Key");
        console.err("Wolfram Error:", error.message);
      }
    }
  }

  // 設定播放清單
  savePlaylists(){
    try{
      const dataToSave = { ...this.musicList };
      delete dataToSave["全部"];
      fs.writeFileSync(this.playlistPath, JSON.stringify(dataToSave, null, 2), "utf-8");
    } catch (err) {
      this.emit("log", "儲存播放清單失敗：" + err.message);
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