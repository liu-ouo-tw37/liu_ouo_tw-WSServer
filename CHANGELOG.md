# 更新日誌

## [1.1.0] - 2026-01-27

### Added
- **查詢天氣**：新增更多更詳細的資料。
- **生成迷宮功能**：新增 `-maze?<長>*<寬>` 指令，用DFS生成，僅限管理員使用。

### Fixed
- **狀態列顯示**：優化了持有時鐘時的 Actionbar 顯示，播放音樂時第一行會置中。



## [1.2.0] - 2026-02-07

### Added
- **管理員txt檔讀取**：在檔案目錄`...AppData\Local\Programs\Minecraft_WSServer\resources`裡新增檔案`admin.txt`，可以新增管理員(Minecraft IDa名字)，換行可以新增更多玩家
- **地震偵測**：預設關閉，打`-earthquake?`開啟或關閉地震偵測。必須先去[中央氣象署網站](https://opendata.cwa.gov.tw/user/authkey)獲得API Key才能使用
- **CPU效能監測**：打`cpu?`及`cpu_stop?`開啟或關閉cpu監測牆(統一出現在`200 -60 -40`的位置及Actionbar)
- **計算機**：新增 `calc?<問題>` 指令，把問題輸入進去即可計算問題，支援微積分極限求和三角函數等問題。必須先去[Wolfram Alpha Developer](https://developer.wolframalpha.com/)獲得API Key

### Fixed
- **製作地圖繪大小**：地圖繪大小支援對大到379*1500，並且可正常運作(新增自動刷新區域)
