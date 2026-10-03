# Security Policy

[English](#english) · [繁體中文](#繁體中文)

---

## English

### Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x (latest) | ✅ |

### Reporting a vulnerability

**Please do not open a public issue or discussion for a security problem.**

Report it privately instead:

1. Open the **[Security tab → Report a vulnerability](https://github.com/rrrl2617/universe-music-visualizer/security/advisories/new)** page of this repository.
2. Describe the problem. It helps to include:
   - what you found and why it matters (the impact),
   - steps to reproduce it,
   - the version you tested (it is in the installer's file name and in `package.json`),
   - your Windows version,
   - a suggested fix, if you have one.

What to expect:

- This is a small personal project maintained in spare time. I will **try to acknowledge your report within 7 days** and keep you updated, but I cannot promise a fixed timeline.
- Confirmed issues are fixed in a new release, and the advisory is published once a fix is available.
- If you would like to be credited in the advisory, say so in your report.
- Please allow a reasonable time to fix the issue before disclosing it publicly.

### Scope

**In scope**

- The app's source code in `src/` and the installer built from it.
- The build configuration in `package.json`.

**Out of scope**

- The Windows SmartScreen warning when running the installer. The installer is **not code-signed**; this is known and documented in the README and the release notes.
- Advisories that only affect build-time tooling (for example the `electron-builder` dependency chain) and are not shipped inside the app, unless you can show they affect the shipped app or the release process.
- Vulnerabilities in Electron or Chromium themselves. Please report those upstream. If a newer Electron release fixes a problem that affects this app, though, do tell me so I can update.
- Problems that require physical access to, or administrator rights on, the user's machine.

### What the app does and does not do

- **Offline:** the app makes no network requests and has no telemetry.
- **Audio stays local:** system audio or microphone input is analysed in memory to draw the visuals. It is never recorded, saved or sent anywhere.
- **Hardened window:** the renderer runs in Chromium's sandbox with context isolation, no Node.js integration, a strict Content Security Policy, no ability to open new windows or navigate to other pages, and a permission allow-list limited to media capture (audio, plus the minimal, disabled screen track Windows needs for system-audio loopback).
- **Debug switches are development-only:** the `GALAXY_*` environment variables are ignored in packaged builds.
- **Minimal storage:** the app itself writes only a small settings file (window position and your menu choices). It lives in `%APPDATA%\Universe Music Visualizer`, next to the cache files Chromium keeps there as in any Electron app.

### Verifying your download

Each release lists the SHA-256 hash of the installer. To check your copy in PowerShell:

```powershell
Get-FileHash .\Universe.Music.Visualizer.Setup.0.1.0.exe -Algorithm SHA256
```

The result must match the hash in the release notes. Only download the installer from this repository's **Releases** page.

---

## 繁體中文

### 支援的版本

只有最新版本會收到安全性修正。

| 版本 | 是否支援 |
| --- | --- |
| 0.1.x（最新） | ✅ |

### 如何回報安全問題

**請不要用公開的 Issue 或 Discussion 回報安全問題。**

請改用私下回報：

1. 到本儲存庫的 **[Security 分頁 → Report a vulnerability](https://github.com/rrrl2617/universe-music-visualizer/security/advisories/new)**。
2. 描述問題，建議包含：發現了什麼與影響、重現步驟、測試的版本（安裝檔名與 `package.json` 裡有）、你的 Windows 版本，以及你的修正建議（如果有）。

這是個人在業餘時間維護的小專案，我會**盡量在 7 天內回覆**並更新處理進度，但無法承諾固定的修復時程。確認的問題會在新版本中修正，修正發布後才會公開公告。如果你希望在公告中被致謝，請在回報時說明。公開揭露前，請給予合理的修復時間。

### 範圍

- **範圍內：** `src/` 裡的程式碼、由它打包出的安裝檔、`package.json` 的建置設定。
- **範圍外：** 執行安裝檔時的 Windows SmartScreen 警告（安裝檔沒有數位簽章，這是已知的，README 與 Release 說明都有寫）；只影響建置工具、不會被打包進程式的相依套件警告；Electron 或 Chromium 本身的漏洞（請向上游回報，但若有新版修正且影響本程式，歡迎告訴我更新）；需要實體存取或管理員權限才能利用的問題。

### 程式做了什麼、沒做什麼

- 完全離線，沒有網路請求，沒有任何資料回傳。
- 聲音只在記憶體中即時分析來畫畫面，不會錄音、儲存或傳送。
- 視窗經過加固：沙盒、隔離環境、無 Node.js 整合、嚴格的內容安全政策、不能開新視窗或導航到其他網頁、權限只開放媒體擷取（聲音，加上 Windows 擷取系統聲音所需、已停用的極小畫面軌道）。
- 除錯用的 `GALAXY_*` 環境變數只在開發模式有效，打包後的程式會忽略。
- 程式自己寫入硬碟的只有設定檔（視窗位置與選單選項），位置在 `%APPDATA%\Universe Music Visualizer`；同一個資料夾裡還有 Chromium 引擎的快取檔，所有 Electron 程式都是如此。

### 驗證下載的檔案

每個 Release 都附有安裝檔的 SHA-256 雜湊值。在 PowerShell 執行上方的 `Get-FileHash` 指令，結果必須與 Release 說明中的值相同。請只從本儲存庫的 **Releases** 頁面下載安裝檔。
