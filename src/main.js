'use strict';
const { app, BrowserWindow, Menu, ipcMain, session, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZE_KEYS = ['small', 'medium', 'large', 'xlarge', 'max'];
const FIXED_SIZES = { small: 320, medium: 440, large: 600, xlarge: 800 };

// Max 取所在螢幕工作區（扣掉工作列）短邊的 96%，接近滿版；其他尺寸在小螢幕上也不會超出
function sizeFor(key, display) {
  const wa = (display || screen.getPrimaryDisplay()).workArea;
  const cap = Math.floor(Math.min(wa.width, wa.height) * 0.96);
  return key === 'max' ? cap : Math.min(FIXED_SIZES[key], cap);
}

function clampToWorkArea(x, y, size, display) {
  const wa = display.workArea;
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - size)),
    y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - size)),
  };
}
const VISUALS = ['galaxy', 'blackhole'];
const SOURCES = ['system', 'mic', 'demo'];
const DELAYS = [0, 50, 100, 150, 200, 300, 400]; // Sync Delay 的選項（毫秒）
const DEFAULTS = { source: 'system', visual: 'galaxy', syncDelay: 0, size: 'medium', alwaysOnTop: true, x: null, y: null };
// 除錯用的環境變數（GALAXY_*）只在開發模式有效；打包後的程式一律忽略它們。
const env = (key) => (app.isPackaged ? undefined : process.env[key]);
const DEBUG = !!env('GALAXY_DEBUG');

let win = null;
let settings = { ...DEFAULTS };
let dragTimer = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
  if (env('GALAXY_SIZE')) settings.size = env('GALAXY_SIZE');
  if (!SIZE_KEYS.includes(settings.size)) settings.size = DEFAULTS.size;
  if (!VISUALS.includes(settings.visual)) settings.visual = DEFAULTS.visual;
  if (!SOURCES.includes(settings.source)) settings.source = DEFAULTS.source;
  if (!DELAYS.includes(settings.syncDelay)) settings.syncDelay = DEFAULTS.syncDelay;
  settings.alwaysOnTop = settings.alwaysOnTop !== false;
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('settings save failed:', err.message);
  }
}

// 儲存的位置若已不在任何螢幕內（例如拔掉外接螢幕），就回到主螢幕右下角
function initialPosition(size) {
  const { x, y } = settings;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const visible = screen.getAllDisplays().some(({ bounds: b }) =>
      cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height);
    if (visible) return { x, y };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - size - 24, y: wa.y + wa.height - size - 24 };
}

function createWindow() {
  const guess = sizeFor(settings.size);
  const display = screen.getDisplayNearestPoint(initialPosition(guess));
  const size = sizeFor(settings.size, display);
  const start = initialPosition(size);
  const pos = clampToWorkArea(start.x, start.y, size, display);

  win = new BrowserWindow({
    ...pos,
    width: size,
    height: size,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    title: 'Universe Music Visualizer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  if (env('GALAXY_SHOT')) win.setIgnoreMouseEvents(true); // 截圖測試模式：視窗完全穿透滑鼠，避免被誤觸
  // 這個程式只會載入自己的本機頁面：不允許開新視窗，也不允許導航到任何其他網址
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));

  if (DEBUG) {
    win.webContents.on('console-message', (event) => console.log('[renderer]', event.message));
  }
  if (env('GALAXY_SHOT')) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(env('GALAXY_SHOT'), img.toPNG());
      app.quit();
    }, Number(env('GALAXY_SHOT_DELAY')) || 5000);
  }

  win.on('closed', () => { win = null; });
  win.on('blur', stopDrag);
}

function applySize() {
  if (!win) return;
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  const s = sizeFor(settings.size, display);
  const wa = display.workArea;
  const pos = settings.size === 'max'
    ? { x: Math.round(wa.x + (wa.width - s) / 2), y: Math.round(wa.y + (wa.height - s) / 2) } // Max：置中
    : clampToWorkArea(b.x + b.width / 2 - s / 2, b.y + b.height / 2 - s / 2, s, display);     // 其他：以原中心縮放
  win.setBounds({ ...pos, width: s, height: s });
  rememberPosition();
}

function rememberPosition() {
  if (!win) return;
  const [x, y] = win.getPosition();
  settings.x = x;
  settings.y = y;
  saveSettings();
}

function stopDrag() {
  if (!dragTimer) return;
  clearInterval(dragTimer);
  dragTimer = null;
  rememberPosition();
}

// 拖曳由主程序輪詢游標位置完成，比在 renderer 端算位移更不容易在高 DPI 下抖動
ipcMain.on('drag-start', () => {
  if (!win) return;
  clearInterval(dragTimer);
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const [w, h] = win.getSize();
  dragTimer = setInterval(() => {
    if (!win) return stopDrag();
    const p = screen.getCursorScreenPoint();
    win.setBounds({ x: wx + p.x - start.x, y: wy + p.y - start.y, width: w, height: h });
  }, 8);
});
ipcMain.on('drag-end', stopDrag);

// 圓形以外的透明角落讓滑鼠穿透到底下的視窗
ipcMain.on('set-ignore', (_e, ignore) => {
  if (env('GALAXY_SHOT')) return; // 截圖測試模式下一律不接受滑鼠操作，避免被誤觸而切換畫面
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

function setVisual(visual) {
  if (!win || !VISUALS.includes(visual)) return;
  settings.visual = visual;
  saveSettings();
  win.webContents.send('set-visual', visual);
}

ipcMain.on('cycle-visual', () => {
  setVisual(VISUALS[(VISUALS.indexOf(settings.visual) + 1) % VISUALS.length]);
});

ipcMain.handle('get-settings', () => ({
  source: env('GALAXY_SOURCE') || settings.source,
  visual: env('GALAXY_VISUAL') || settings.visual,
  syncDelay: settings.syncDelay,
  debug: DEBUG,
}));

ipcMain.on('show-menu', () => {
  if (!win) return;
  const setSource = (source) => {
    settings.source = source;
    saveSettings();
    win.webContents.send('set-source', source);
  };
  const setDelay = (ms) => {
    settings.syncDelay = ms;
    saveSettings();
    win.webContents.send('set-delay', ms);
  };
  const setSize = (size) => {
    settings.size = size;
    applySize();
  };
  const menu = Menu.buildFromTemplate([
    {
      label: 'Visual Style',
      submenu: [
        { label: 'Galaxy Geometry', type: 'radio', checked: settings.visual === 'galaxy', click: () => setVisual('galaxy') },
        { label: 'Black Hole', type: 'radio', checked: settings.visual === 'blackhole', click: () => setVisual('blackhole') },
      ],
    },
    {
      label: 'Audio Source',
      submenu: [
        { label: 'System Audio', type: 'radio', checked: settings.source === 'system', click: () => setSource('system') },
        { label: 'Microphone', type: 'radio', checked: settings.source === 'mic', click: () => setSource('mic') },
        { label: 'Demo Mode (simulated music)', type: 'radio', checked: settings.source === 'demo', click: () => setSource('demo') },
      ],
    },
    {
      label: 'Sync Delay',
      submenu: [
        { label: 'Raise this if visuals lead the sound (e.g. Bluetooth)', enabled: false },
        { type: 'separator' },
        ...DELAYS.map((ms) => ({
          label: ms === 0 ? 'Off (0 ms)' : `${ms} ms`,
          type: 'radio',
          checked: settings.syncDelay === ms,
          click: () => setDelay(ms),
        })),
      ],
    },
    {
      label: 'Window Size',
      submenu: [
        { label: 'Small', type: 'radio', checked: settings.size === 'small', click: () => setSize('small') },
        { label: 'Medium', type: 'radio', checked: settings.size === 'medium', click: () => setSize('medium') },
        { label: 'Large', type: 'radio', checked: settings.size === 'large', click: () => setSize('large') },
        { label: 'Extra Large', type: 'radio', checked: settings.size === 'xlarge', click: () => setSize('xlarge') },
        { label: 'Max (near full screen)', type: 'radio', checked: settings.size === 'max', click: () => setSize('max') },
      ],
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        win.setAlwaysOnTop(item.checked);
        saveSettings();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    loadSettings();

    // 系統音訊：以 WASAPI loopback 擷取「喇叭正在播放的聲音」，不需要立體聲混音
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}));
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
