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
2.  安裝完成後，進入安裝目錄下的 `resources` 資料夾
      * *(檔案位置範例：`C:\Users\Owner\AppData\Local\Programs\Minecraft_WSServer\resources`)*
3.  **自定義資源**：
    * 將音樂 JSON 放入 `resources/music/`
    * 將指令文字檔放入 `resources/commands/`
    * 數A複習題庫在 `math_db.json`
4.  啟動程式，輸入你的 **Gemini API Key**、**OpenWeather API Key**和**Geocoding API Key**。
5.  在 Minecraft 遊戲內輸入：`/connect localhost:5218` (或你設定的連接埠)連接WSServer。
6.  **連接後輸入`-help`取得更詳細的功能介紹。**

## 注意：
如果要使用繪畫功能以及暫停音樂、播放下一首音樂之功能
必須到檔案裡的`MinecraftWebSocketServer.js`裡更改使用權限(預設是只限作者我本人)
你可以把第182、249、265行的`sender === "liu owo roc"` 改成自己的遊戲id

## 功能介紹：
1. 輸入 **-help** 在遊戲中看功能介紹
2. 輸入 **-ai?`<你給AI的指令>`** 與AI互動(預設是讓AI幫你打指令，支援中文) *e.g. -ai?給我一個時鐘*
3. 輸入 **-weather?`<想要查詢的地點>`** 查詢當地的天氣狀況(支援中文) *e.g. -weather?板橋高中*
4. 輸入 **-art?`<檔名>`** 生成畫作(畫作生成時，請勿移動) *e.g. -art?2024PrideParade101*
5. 輸入 **-music?`<檔名>`** 播放音樂 *e.g. -music?千本櫻*
6. 輸入 **-next** 播放下一首歌曲
7. 輸入 **-stop** 停止播放並清空待播放清單裡的所有歌曲
8. 輸入 **playlist?`<播放清單名稱>`** 隨機播放播放清單內的歌曲(隨機順序加入待播放清單) *e.g. -playlist?全部*
9. 輸入 **-exam?`<主題>`** 開始進行數學刷題練習(若主題為空則預設範圍為「高中數學數A內容」) *e.g. -exam?三角函數*
10. 輸入 **-answer?`<答案>`** 在考試中進行作答(若不在考試中則無效) *e.g. -answer?ACD  /  -answer?(11,3)*
