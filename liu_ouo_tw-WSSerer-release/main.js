const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const MinecraftWebSocketServer = require("./MinecraftWebSocketServer");
const MinecraftAI = require("./MinecraftAI");

let win;
let mcWSS = null;
let ai = null;

// 設定檔路徑
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

// 預設設定
let settings = {
  port: 5218,
  apiKey: "",
  modelName: "gemini-2.5-flash",
  allowCommands: true,
  ownApiKey: "",
  wakeWord: "-ai?",
  weatherWakeWord: "-weather?",
  artWakeWord: "-art?",
  musicWakeWord: "-music?",
  examWakeWord: "-exam?",
  answerWakeWord: "-answer?",
  calculaterWakeWord: "-calc?",
  playerRegex: "",
  maxOutput: 512,
  creativity: 1,
  prompt: `你是一個Minecraft bedrock助理，請盡你所能幫助玩家。
你收到的訊息格式為: <玩家遊戲ID> 玩家訊息
若你可以使用functionCall請不用詢問直接幫玩家執行，避免使用@s、開頭不用輸入斜線、使用最新的基岩版指令。
指令執行後你會獲得結果，若你不知道指令或指令執行有誤可以使用help [指令] 查看使用方法，help裡面的說明一定是正確的，請照著修正指令。 `,
  cooldown: 0,
  openweatherApiKey: "",
  geocodingApiKey: "",
  earthquakeApiKey: "",
  wolframApiKey: ""
};

// 讀取設定檔
function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      settings = { ...settings, ...JSON.parse(data) };
      writeLog("⚙️ 設定已從檔案載入");
    } catch (err) {
      writeLog("❌ 載入設定失敗：", err);
    }
  }
}

// 存檔（含 apiKey）
function saveSettings() {
  try {
    // === 比對 JSON 設定 ===
    let oldSettings = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        oldSettings = JSON.parse(data);
      } catch {
        oldSettings = {};
      }
    }

    const newJson = JSON.stringify(settings, null, 2);
    const oldJson = JSON.stringify(oldSettings, null, 2);

    if (newJson !== oldJson) {
      fs.writeFileSync(SETTINGS_FILE, newJson);
      writeLog("💾 設定已儲存至檔案");
    }
  } catch (err) {
    console.error("❌ 儲存設定失敗：", err);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1024,
    height: 920,
    minWidth: 900,
    minHeight: 750,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, "assets/icon.ico")
  });

  win.setMenuBarVisibility(false);
  win.loadFile("renderer/index.html");
}

function sendStatus(status) {
  if (win) win.webContents.send("status-update", status);
}

// 傳送記錄到前端
function writeLog(...args) {
  const message = args.join(" ");
  if (win) win.webContents.send("log", message);
}

/**
 * 啟動 WebSocket Server
 * @param {object} settings - 設定檔
 */
async function startWebSocketServer(settings) {
  if (mcWSS) return writeLog("⚠️ 伺服器已在運作中");

  // 檢查 Port
  const port = parseInt(settings.port, 10);
  if (isNaN(port) || port <= 0) {
    sendStatus("已停止：端口必須是數字");
    return;
  }

  // 檢查 AI 必要參數
  if (!settings.apiKey || !settings.modelName) {
    sendStatus("已停止：請設定 API Key 與模型名稱");
    return;
  }

  // 檢查 AI 輸出長度
  const maxOutput = parseInt(settings.maxOutput, 10);
  if (isNaN(maxOutput) || maxOutput < 1) {
    sendStatus("已停止：AI 輸出長度必須是大於 1 的正整數");
    return;
  }

  // 檢查 AI 創意程度
  const creativity = parseInt(settings.creativity, 10);
  if (isNaN(creativity) || creativity > 2 || creativity < 0) {
    sendStatus("已停止：AI 創意程度必須介於 0 ~ 2");
    return;
  }

  // 檢查冷卻時間
  const cooldown = parseFloat(settings.cooldown, 10);
  if (isNaN(cooldown) || cooldown < 0) {
    sendStatus("已停止：冷卻時間必須是正數");
    return;
  }

  const isPackaged = app.isPackaged;
  const resourcePath = isPackaged 
    ? process.resourcesPath 
    : __dirname;
  
  const musicDir = path.join(resourcePath, "music");
  const commandsDir = path.join(resourcePath, "commands");
  const mathDbPath = path.join(resourcePath, "math_db.json");
  const statsPath = path.join(resourcePath, "players_stats.json");

  // 初始化 AI
  ai = new MinecraftAI(
    settings.apiKey,
    settings.modelName,
    maxOutput,
    settings.creativity,
    settings.prompt || "你是一個 Minecraft 助手。",
    settings.allowCommands ?? true,
    (cmd) => {
      if (mcWSS) mcWSS.runCommand(cmd, true);
    }
  );

  writeLog("🥵 正在測試 AI...");
  const [success, message] = await ai.testConnection();
  if (!success) return writeLog("❌ 啟動失敗：" + message);

  // 建立 MinecraftWebSocketServer
  mcWSS = new MinecraftWebSocketServer(
    port,
    settings.wakeWord || "",
    settings.playerRegex || ".*",
    ai,
    cooldown,
    settings.openweatherApiKey,
    settings.geocodingApiKey,
    musicDir,
    commandsDir,
    mathDbPath,
    settings.earthquakeApiKey,
    settings.wolframApiKey,
    statsPath,
    settings.ownApiKey,
    settings
  );

  // 監聽事件
  mcWSS.on("log", writeLog);
  mcWSS.on("status-update", sendStatus);

  try {
    mcWSS.start();
  } catch (err) {
    writeLog("❌ 啟動失敗：" + err.message);
    sendStatus("已停止");
    mcWSS = null;
  }
}

/**
 * 停止 WebSocket Server
 */
function stopWebSocketServer() {
  if (mcWSS) {
    mcWSS.stop();
    mcWSS = null;
  }
}

// App 啟動
app.whenReady().then(() => {
  loadSettings();

  ipcMain.handle("get-settings", () => settings);

  createWindow();

  ipcMain.on("control-wss", async (event, data) => {
    const { action, settings: newSettings } = data || {};

    // 如果有帶設定，就更新並存檔
    if (newSettings) {
      settings = { ...settings, ...newSettings };
      saveSettings();
    }

    if (action === "open") {
      startWebSocketServer(settings);
    }
    if (action === "close") {
      stopWebSocketServer();
    }
  });
});
