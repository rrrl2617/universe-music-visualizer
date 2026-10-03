# Universe Music Visualizer

A small desktop widget for Windows that turns whatever you are playing into a galaxy or a black hole. Louder music moves the scene faster, kick drums pulse it, and the colors drift with the mood of the song.

[English](#english) · [繁體中文](#繁體中文)

---

## English

### Two visual styles

- **Galaxy Geometry** – translucent ribbons woven from fine lines, orbits, and drifting dust. Blue and gold by default, with the accent color shifting as the song's energy and brightness change.
- **Black Hole** – quantum-mechanics equations stream in from the right and are pulled apart, character by character, by the black hole's gravity. The photon ring, accretion disk and lensing arcs are all made of particles.

### Features

- Captures **system audio** (Spotify, YouTube, any player) with no "Stereo Mix" needed. Microphone and a simulated **Demo Mode** are also available.
- Low-latency beat detection, plus a **Sync Delay** option for Bluetooth speakers and headphones whose sound arrives later than the visuals.
- Floating, draggable, always-on-top circular window. The corners are click-through.
- Five window sizes, up to near full screen.
- Everything runs locally. The app makes **no network requests** and stores nothing but its own settings.

### Controls

| Action | Result |
| --- | --- |
| Drag inside the circle | Move the widget (position is remembered) |
| Double-click inside the circle | Switch between the two visual styles |
| Right-click | Menu: Visual Style, Audio Source, Sync Delay, Window Size, Always on Top, Quit |

Window sizes: Small 320 · Medium 440 · Large 600 · Extra Large 800 · Max (96% of the shorter side of your screen's work area).

### Install

Download `Universe Music Visualizer Setup 0.1.0.exe` from the [Releases](../../releases) page and run it. The installer is **not code-signed**, so Windows SmartScreen will warn you: click **More info → Run anyway**.

### Run from source

```bash
npm install
npm start
```

If `npm start` cannot find the Electron binary (this happens when `npm install` skipped its postinstall step), run `node node_modules/electron/install.js` once.

Build a Windows installer (output goes to `dist/`):

```bash
npm run dist
```

### Debugging

These environment variables only work in development (`npm start`); a packaged build ignores them.

- `GALAXY_DEBUG=1` – print fps, mood values and band levels every second
- `GALAXY_SOURCE=demo|system|mic` – override the audio source
- `GALAXY_VISUAL=galaxy|blackhole` – override the visual style
- `GALAXY_SIZE=small|medium|large|xlarge|max` – override the window size

### Notes

Capturing system audio on Windows requires keeping a video track alive, otherwise the loopback audio goes silent. The app requests a 16×16, 1 fps track and disables it, so the cost of screen capture is close to zero.

### Project layout

- `src/main.js` – window, menu, dragging, sizes, settings, system-audio capture permission
- `src/preload.js` – narrow bridge between the renderer and the main process
- `src/renderer.js` – spectrum analysis, mood detection, palette, Galaxy Geometry
- `src/blackhole.js` – Black Hole
- `src/index.html` – canvas

### License

[MIT](LICENSE)

---

## 繁體中文

把你正在播放的音樂變成桌面上的銀河或黑洞。聲音越大，流動越快；鼓點讓畫面脈動；配色會隨歌曲氛圍（強度與音色亮度）慢慢改變。

### 兩種視覺風格

- **Galaxy Geometry**：半透明絲帶、軌道、粉塵，預設是藍金配色，強調色會隨氛圍變化。
- **Black Hole**：以量子力學為主的公式從右側流入，被黑洞的重力一個字元一個字元地拉開；光環、吸積盤與折射弧線都由粒子組成。

### 操作

| 動作 | 效果 |
| --- | --- |
| 左鍵按住圓形範圍拖曳 | 移動位置（會記住） |
| 圓形範圍內雙擊 | 在兩種視覺風格之間切換 |
| 右鍵 | 選單：Visual Style、Audio Source、Sync Delay、Window Size、Always on Top、Quit |
| 圓形以外的透明角落 | 滑鼠會穿透到底下的視窗 |

### 音源（Audio Source）

- **System Audio**（預設）：擷取喇叭正在播的聲音，Spotify、YouTube、本機播放器都可以，不需要開「立體聲混音」。
- **Microphone**：拿來聽現場音樂。
- **Demo Mode**：用模擬鼓點與旋律驅動畫面，每 10 秒換一個段落，沒有音樂時用來調視覺。

### 同步延遲（Sync Delay）

如果你用藍牙喇叭或耳機，聲音會比擷取到的晚 100–250 毫秒，畫面就會超前。右鍵選 Sync Delay，從 100 ms 開始往上試。

### 安裝

到 [Releases](../../releases) 下載 `Universe Music Visualizer Setup 0.1.0.exe` 並執行。安裝檔**沒有數位簽章**，Windows SmartScreen 會跳出警告，點「其他資訊」再點「仍要執行」即可。

### 隱私

程式不連網、不蒐集資料，只在本機分析聲音，除了自己的設定檔（視窗位置與選項）之外不會儲存任何東西。

### 從原始碼執行與打包

```bash
npm install
npm start
```

```bash
npm run dist
```

其餘說明（除錯用環境變數、專案結構）請見上方英文版。
