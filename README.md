# Minecraft AI WebSocket Server (Gemini 整合版)

這是一個為 Minecraft 基岩版 (Minecraft Bedrock Edition) 設計的 WebSocket 伺服器，整合了 Google Gemini AI。它能讓你在遊戲中透過聊天室與 AI 互動、播放自定義紅石音樂、甚至讓 AI 幫你執行遊戲指令。

## 核心功能
* **AI 智能對話**：整合 Gemini API，支援自定義 System Prompt 與函式呼叫 (Function Calling)。
* **紅石音樂播放**：讀取 `music/` 資料夾下的 JSON 歌單，並在遊戲中精準播放。
* **指令畫作繪製**：讀取 `commands/` 中的 .txt 檔案，自動生成遊戲內建築或畫作。
* **即時天氣與定位**：內建 OpenWeather API，支援遊戲內查詢現實世界天氣。
* **複習學測數A系統**：支援從 `math_db.json` 讀取題目進行互動遊戲。

## 安裝與使用 (使用者版)
1.  前往 [Releases](https://github.com/liu-ouo-tw37/liu_ouo_tw-WSServer/releases/tag/v1.0.0) 下載最新的安裝程式的Setup (`.exe`)。
2.  安裝完成後，進入安裝目錄下的 `resources` 資料夾。
3.  **自定義資源**：
    * 將音樂 JSON 放入 `resources/music/`。
    * 將指令文字檔放入 `resources/commands/`。
4.  啟動程式，輸入你的 **Gemini API Key**、**OpenWeather API Key**和**Geocoding API Key**。
5.  在 Minecraft 遊戲內輸入：`/connect localhost:5218` (或你設定的連接埠)。

## 注意：
如果要使用繪畫功能以及暫停音樂、播放下一首音樂之功能
必須到檔案裡的`MinecraftWebSocketServer.js`裡更改使用權限(預設是只限作者我本人)
你可以把第182、249、265行的sender === ***"liu owo roc"*** 改成自己的遊戲id
