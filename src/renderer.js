'use strict';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const api = window.galaxyBridge || {
  // 在一般瀏覽器開啟時的退路，方便除錯畫面
  getSettings: async () => ({ source: 'demo', debug: false }),
  dragStart() {}, dragEnd() {}, showMenu() {}, setIgnore() {}, onSetSource() {}, cycleVisual() {}, onSetVisual() {}, onSetDelay() {},
};

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (cur, target, dt, up, down) =>
  cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? up : down)));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// ───────────────────────── 畫布尺寸 ─────────────────────────
let W = 0, H = 0, R = 0, CX = 0, CY = 0, dpr = 1, SC = 1;
let lastDevicePR = 0; // 上次計算時的螢幕縮放比例

function resize() {
  lastDevicePR = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  // 光點與光暈不需要超高解析度，省 GPU；視窗放大到接近滿版時，再把畫布像素數壓在約 1300px 邊長內
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5, 1300 / Math.max(W, H)));
  R = Math.min(W, H) / 2;
  CX = W / 2;
  CY = H / 2;
  SC = Math.max(1, R / 200); // 線寬與點的大小隨視窗放大
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}
window.addEventListener('resize', resize);
resize();

// ───────────────────────── 音訊來源 ─────────────────────────
const FFT_SIZE = 2048;
const audio = { ctx: null, analyser: null, beatAnalyser: null, delay: null, stream: null, sampleRate: 48000 };
let syncDelayMs = 0;                  // 畫面刻意延後的毫秒數，用來補償藍牙等「聲音比擷取晚」的情況
const beatBuf = new Float32Array(512); // 低頻時域取樣，用來做低延遲鼓點偵測
const freq = new Uint8Array(FFT_SIZE / 2);
let toast = { text: '', t: 0 };
let debug = false;

function showToast(text) { toast = { text, t: 3.2 }; }

function stopSource() {
  if (audio.stream) audio.stream.getTracks().forEach((t) => t.stop());
  if (audio.ctx) audio.ctx.close().catch(() => {});
  audio.ctx = audio.analyser = audio.beatAnalyser = audio.delay = audio.stream = null;
  audio.sampleRate = 48000; // 示範模式的頻譜是照 48 kHz 排的
}

let sourceGen = 0;    // 每次切換音源就 +1；非同步等待結束時若已不是最新的一次，就丟棄結果
let endedRetries = 0; // 音訊軌道意外結束（裝置被拔掉或切換）後自動重連的次數

async function startSource(kind) {
  const gen = ++sourceGen;
  stopSource();
  if (kind === 'demo') { showToast('Demo mode'); return; }
  let stream = null;
  let ac = null;
  try {
    if (kind === 'system') {
      // 畫面軌道不能 stop 或移除，否則 loopback 的音訊會跟著靜音。
      // 所以改成要求最小的畫面、1 fps，並停用軌道，把螢幕擷取的成本壓到幾乎為零。
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 16, height: 16, frameRate: 1 },
        audio: true,
      });
      stream.getVideoTracks().forEach((t) => { t.enabled = false; });
      if (!stream.getAudioTracks().length) throw new Error('no audio track');
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    }
    if (gen !== sourceGen) { stream.getTracks().forEach((t) => t.stop()); return; } // 等待期間又切換了音源
    ac = new AudioContext();
    const analyser = ac.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5; // 平滑越高反應越慢；0.78 會讓畫面明顯落後鼓點
    analyser.minDecibels = -90;
    analyser.maxDecibels = -25;
    // 來源 →（可調延遲）→ 頻譜分析；同一條線再分一路 → 低通 160Hz → 小視窗時域分析（只看鼓點，延遲約 10ms）
    const delay = ac.createDelay(1);
    delay.delayTime.value = syncDelayMs / 1000;
    const lowpass = ac.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 160;
    lowpass.Q.value = 0.7;
    const beatAnalyser = ac.createAnalyser();
    beatAnalyser.fftSize = 512;
    beatAnalyser.smoothingTimeConstant = 0;
    ac.createMediaStreamSource(stream).connect(delay); // 不接到喇叭，避免回音
    delay.connect(analyser);
    delay.connect(lowpass);
    lowpass.connect(beatAnalyser);
    audio.ctx = ac;
    audio.analyser = analyser;
    audio.beatAnalyser = beatAnalyser;
    audio.delay = delay;
    audio.stream = stream;
    audio.sampleRate = ac.sampleRate;

    // 裝置被拔掉或切換時，音訊軌道會自己結束：自動重連，連續失敗 3 次才放棄並改用示範模式
    const startedAt = performance.now();
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (gen !== sourceGen) return;
      if (performance.now() - startedAt > 30000) endedRetries = 0;
      if (endedRetries++ < 3) {
        showToast('Audio device changed, reconnecting');
        setTimeout(() => { if (gen === sourceGen) startSource(kind); }, 1000);
      } else {
        stopSource();
        showToast('Audio lost, using demo mode');
      }
    });
    showToast(kind === 'system' ? 'Connected to system audio' : 'Connected to microphone');
  } catch (err) {
    // 中途失敗時把已經拿到的資源還回去，避免串流或音訊環境殘留
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ac) ac.close().catch(() => {});
    if (gen !== sourceGen) return;
    console.warn('audio source failed:', err && err.message);
    showToast('Audio unavailable, using demo mode');
  }
}

api.onSetSource(startSource);
api.onSetDelay((ms) => {
  syncDelayMs = ms;
  if (audio.delay && audio.ctx) audio.delay.delayTime.setTargetAtTime(ms / 1000, audio.ctx.currentTime, 0.05);
  showToast(ms ? `Sync delay ${ms} ms` : 'Sync delay off');
});

// 視覺風格：'galaxy'（銀河幾何）或 'blackhole'（黑洞陷落）
const VISUAL_NAMES = { galaxy: 'Galaxy Geometry', blackhole: 'Black Hole' };
let visual = 'galaxy';
let visualFade = 1; // 切換後從全暗淡入
function setVisual(v, announce) {
  if (!VISUAL_NAMES[v] || v === visual) return;
  visual = v;
  visualFade = 0;
  if (announce) showToast(VISUAL_NAMES[v]);
}
api.onSetVisual((v) => setVisual(v, true));

// 示範模式：每 10 秒換一個「段落」（速度、鼓量、旋律高低都不同），
// 讓你不用放歌也能看到配色隨氛圍改變。
const demoFreq = new Float32Array(FFT_SIZE / 2);
const DEMO_SECTIONS = [
  { bpm: 68, kick: 0.55, hat: 0.2, lead: 34 },   // 沉靜：慢、低、暗
  { bpm: 96, kick: 0.9, hat: 0.6, lead: 80 },
  { bpm: 140, kick: 1.0, hat: 1.5, lead: 150 },  // 華麗：快、強、亮
  { bpm: 120, kick: 1.0, hat: 0.5, lead: 40 },   // 激昂：快、強、低沉
];
let demoBeat = 0;
function fillDemo(now, dt) {
  const sec = DEMO_SECTIONS[Math.floor(now / 10000) % DEMO_SECTIONS.length];
  demoBeat += (dt * sec.bpm) / 60;
  const phase = demoBeat % 1;
  const bar = Math.floor(demoBeat) % 4;
  const kick = Math.exp(-phase * 7) * sec.kick;
  const snare = bar % 2 === 1 ? Math.exp(-phase * 9) * sec.kick : 0;
  const hat = Math.exp(-((demoBeat * 2) % 1) * 14) * 0.5 * sec.hat;
  const lead = sec.lead + 20 * Math.sin(now / 700);
  for (let i = 0; i < demoFreq.length; i++) {
    let v = 0;
    if (i < 10) v += kick * 235 * (1 - i / 14);
    if (i > 12 && i < 170) v += snare * 150 * Math.exp(-(i - 12) / 120);
    if (i > 260 && i < 760) v += hat * 120;
    v += 150 * Math.exp(-(((i - lead) / 5) ** 2));
    v += 90 * Math.exp(-(((i - lead * 1.5) / 4) ** 2));
    v += 28 * Math.exp(-i / 140) * (0.6 + 0.4 * Math.random());
    demoFreq[i] = smooth(demoFreq[i], clamp(v, 0, 255), dt, 40, 9);
  }
  for (let i = 0; i < freq.length; i++) freq[i] = demoFreq[i];
}

// ───────────────────────── 頻譜分析 ─────────────────────────
const binHz = () => audio.sampleRate / FFT_SIZE;

function bandAvg(f0, f1) {
  const hz = binHz();
  const a = Math.max(1, Math.floor(f0 / hz));
  const b = Math.min(freq.length - 1, Math.max(a, Math.ceil(f1 / hz)));
  let s = 0;
  for (let i = a; i <= b; i++) s += freq[i];
  return s / ((b - a + 1) * 255);
}

function bandMax(f0, f1) {
  const hz = binHz();
  const a = Math.max(1, Math.floor(f0 / hz));
  const b = Math.min(freq.length - 1, Math.max(a, Math.ceil(f1 / hz)));
  let m = 0;
  for (let i = a; i <= b; i++) if (freq[i] > m) m = freq[i];
  return m / 255;
}

const BARS = 44; // 把頻譜分成 44 段，沿著絲帶的長度分布
const bars = new Float32Array(BARS);
const barsS = new Float32Array(BARS); // 沿絲帶方向平滑過的頻譜，避免輪廓出現尖刺
const sound = { bass: 0, mid: 0, treble: 0, level: 0, kick: 0 };
// 氛圍：energy 是強度（音量相對近期最大值，加上鼓點密度），bright 是音色亮度（頻譜重心）。
// 兩者都用數秒的時間常數慢慢變，所以顏色會隨歌曲段落漂移，不會跟著每個鼓點閃。
const mood = { energy: 0.25, bright: 0.3 };
let agcRef = 0.2;      // 自動增益的參考音量
let bassEma = 0;
let lowRef = 0.01;     // 低頻能量的近期最大值，用來正規化
let lastKick = 0;
let prevTreble = 0;
let kickDensity = 0;   // 近 5 秒左右的鼓點累積

function analyze(now, dt) {
  if (audio.analyser) audio.analyser.getByteFrequencyData(freq);
  else fillDemo(now, dt);

  const rb = bandAvg(35, 160);
  const rm = bandAvg(160, 2200);
  const rt = bandAvg(2200, 10000);
  const raw = rb * 0.5 + rm * 0.3 + rt * 0.2;

  // 自動增益：聲音很小時放大，很大時不要爆表
  agcRef = Math.max(agcRef * (1 - 0.06 * dt), raw);
  const gain = agcRef > 0.03 ? clamp(0.5 / agcRef, 0.9, 4.5) : 1;

  const bass = clamp(rb * gain * 1.5, 0, 1);

  // 低延遲的鼓點驅動：直接看低通後最近 256 個取樣（約 5ms）的能量，不經過 FFT 視窗與平滑
  let drive = bass;
  if (audio.beatAnalyser) {
    audio.beatAnalyser.getFloatTimeDomainData(beatBuf);
    let sum = 0;
    for (let i = beatBuf.length - 256; i < beatBuf.length; i++) sum += beatBuf[i] * beatBuf[i];
    const rms = Math.sqrt(sum / 256);
    lowRef = Math.max(lowRef * Math.exp(-dt * 0.2), rms, 0.004);
    drive = clamp(rms / lowRef, 0, 1);
  }
  sound.bass = smooth(sound.bass, audio.beatAnalyser ? Math.max(bass, drive * 0.9) : bass, dt, 60, 7);
  sound.mid = smooth(sound.mid, clamp(rm * gain * 1.8, 0, 1), dt, 26, 6);
  sound.treble = smooth(sound.treble, clamp(rt * gain * 2.8, 0, 1), dt, 32, 8);
  sound.level = smooth(sound.level, clamp(raw * gain * 1.25, 0, 1), dt, 22, 5);

  // 鼓點：低頻明顯高過它自己的慢速平均，且距離上次至少 130ms
  bassEma += (drive - bassEma) * (1 - Math.exp(-dt * 3));
  if (drive > bassEma * 1.18 + 0.04 && now - lastKick > 130) {
    sound.kick = clamp(0.75 + (drive - bassEma) * 2.5, 0.75, 1.4); // 重拍打得越兇，脈動越大
    lastKick = now;
    kickDensity += 1;
  }
  sound.kick *= Math.exp(-dt * 5);
  kickDensity *= Math.exp(-dt / 5);

  // 高頻突然跳起來時丟一顆流星
  if (sound.treble - prevTreble > 0.1 && Math.random() < 0.55) spawnMeteor();
  prevTreble = sound.treble;

  for (let i = 0; i < BARS; i++) {
    const f = 40 * Math.pow(11000 / 40, i / (BARS - 1));
    let v = bandMax(f / 1.07, f * 1.07) * gain * (0.85 + (i / BARS) * 0.95);
    v = clamp(Math.pow(v, 1.25), 0, 1);
    bars[i] = smooth(bars[i], v, dt, 50, 7);
  }
  barsS.set(bars);
  for (let pass = 0; pass < 3; pass++) {
    let prev = barsS[0];
    for (let i = 0; i < BARS; i++) {
      const cur = barsS[i];
      barsS[i] = (prev + cur * 2 + barsS[Math.min(BARS - 1, i + 1)]) / 4;
      prev = cur;
    }
  }

  // 氛圍：只在有聲音時更新，靜音時維持原本的顏色
  if (raw > 0.03) {
    const hz = binHz();
    let wSum = 0, aSum = 0;
    const iEnd = Math.min(freq.length, Math.floor(8000 / hz));
    for (let i = Math.max(1, Math.floor(80 / hz)); i < iEnd; i++) {
      const a = freq[i] / 255;
      const w = a * a; // 平方讓明顯的峰值比底噪更有影響力
      wSum += w * Math.log2(i * hz);
      aSum += w;
    }
    if (aSum > 0.5) mood.bright = smooth(mood.bright, clamp((wSum / aSum - 8.6) / 2.8, 0, 1), dt, 0.25, 0.25);
    const energyRaw = sound.level * 1.7 * 0.6 + clamp(kickDensity / 9, 0, 1) * 0.4;
    const energyTarget = clamp((energyRaw - 0.68) / 0.5, 0, 1); // 偵測變靈敏後，整體數值偏高，門檻同步上調，維持藍金為預設
    mood.energy = smooth(mood.energy, energyTarget, dt, 0.22, 0.18);
  }

  analyze.frames = (analyze.frames || 0) + 1;
  if (debug && now - (analyze.lastLog || 0) > 1000) {
    const fps = Math.round((analyze.frames * 1000) / (now - (analyze.lastLog || now - 1000)));
    analyze.lastLog = now;
    analyze.frames = 0;
    console.log(`mode=${audio.analyser ? 'live' : 'demo'} fps=${fps} energy=${mood.energy.toFixed(2)} bright=${mood.bright.toFixed(2)} bass=${sound.bass.toFixed(2)} treble=${sound.treble.toFixed(2)}`);
  }
}

function sampleBars(m) { // m: 0..1，線性內插避免階梯狀
  const p = clamp(m, 0, 1) * (BARS - 1);
  const i = Math.floor(p);
  return lerp(barsS[i], barsS[Math.min(BARS - 1, i + 1)], p - i);
}

// ───────────────────────── 配色（藍金為基底，隨氛圍變化） ─────────────────────────
function hsl2rgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255;
  return [f(0), f(8), f(4)];
}

// 四個錨點：主色 P 與強調色 A。左上是參考圖的深藍＋金。
const ANCHORS = {
  calmDark:     { P: hsl2rgb(222, 70, 58), A: hsl2rgb(42, 85, 62) },    // 沉靜、低沉：深藍 + 金
  calmBright:   { P: hsl2rgb(192, 70, 66), A: hsl2rgb(48, 70, 78) },    // 沉靜、明亮：冰藍 + 香檳
  intenseDark:  { P: hsl2rgb(236, 74, 60), A: hsl2rgb(16, 90, 60) },    // 激昂、低沉：靛藍 + 熔岩橘
  intenseBright:{ P: hsl2rgb(204, 80, 64), A: hsl2rgb(332, 72, 70) },   // 華麗、明亮：天藍 + 粉（粉只作點綴）
};
const pal = { P: [0, 0, 0], A: [0, 0, 0], W: [0, 0, 0] };

function updatePalette() {
  const { energy: e, bright: b } = mood;
  for (const key of ['P', 'A']) {
    for (let i = 0; i < 3; i++) {
      const calm = lerp(ANCHORS.calmDark[key][i], ANCHORS.calmBright[key][i], b);
      const intense = lerp(ANCHORS.intenseDark[key][i], ANCHORS.intenseBright[key][i], b);
      pal[key][i] = lerp(calm, intense, e);
    }
  }
  // W：兩色的中間再往白色拉，藍轉金時會經過一段泛白的亮帶（像參考圖裡的高光）
  for (let i = 0; i < 3; i++) pal.W[i] = lerp((pal.P[i] + pal.A[i]) / 2, 255, 0.5);
}

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const tint = (c, k) => [lerp(c[0], 255, k), lerp(c[1], 255, k), lerp(c[2], 255, k)];
// g: 0 → 主色, 0.5 → 泛白, 1 → 強調色
function colorAt(g) {
  const out = [0, 0, 0];
  const [from, to, k] = g < 0.5 ? [pal.P, pal.W, g * 2] : [pal.W, pal.A, (g - 0.5) * 2];
  for (let i = 0; i < 3; i++) out[i] = lerp(from[i], to[i], k);
  return out;
}

// ───────────────────────── 3D 小工具 ─────────────────────────
// M = Rz(roll) · Rx(pitch) · Ry(yaw)
function makeRot(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r0 = [cy, 0, sy];
  const r1 = [sp * sy, cp, -sp * cy];
  const r2 = [-cp * sy, sp, cp * cy];
  return [
    cr * r0[0] - sr * r1[0], cr * r0[1] - sr * r1[1], cr * r0[2] - sr * r1[2],
    sr * r0[0] + cr * r1[0], sr * r0[1] + cr * r1[1], sr * r0[2] + cr * r1[2],
    r2[0], r2[1], r2[2],
  ];
}
const FOCAL = 3.4;

// ───────────────────────── 場景資料 ─────────────────────────
const NU = 96;   // 絲帶沿長度的取樣數
const ARCS = 16; // 每條線切成幾段上色，這樣沿著絲帶可以有藍到金的漸層

function makeRibbon(strands, o) {
  const vs = new Float32Array(strands);
  for (let j = 0; j < strands; j++) vs[j] = (-1 + (2 * j) / (strands - 1)) * (0.94 + Math.random() * 0.12);
  const core = [], outer = [];
  for (let j = 1; j < strands - 1; j++) (Math.abs(vs[j]) < 0.55 ? core : outer).push(j);
  return {
    ...o,
    strands, vs,
    pts: new Float32Array(strands * (NU + 1) * 2),
    tiers: [
      { idx: outer, alpha: 0.11, lw: 0.7 },
      { idx: core, alpha: 0.2, lw: 0.75 },
      { idx: [0, strands - 1], alpha: 0.5, lw: 1.1 }, // 絲帶兩側邊緣線比較亮
    ],
  };
}

const ribbons = [
  makeRibbon(64, { scale: 0.46, width: 0.13, n: 2, ph: 0, tw0: 0, twSpeed: 0.16, dir: 1 }),
  makeRibbon(44, { scale: 0.34, width: 0.1, n: 1, ph: 2.1, tw0: 1.2, twSpeed: -0.12, dir: -1 }),
];

const orbits = [
  { a: 0.9, b: 0.34, tilt: 0.45, tspd: 0.012, dash: false, dots: [{ ang: 0.6, spd: 0.22, r: 3.2, gold: true }, { ang: 3.9, spd: 0.22, r: 2, gold: false }] },
  { a: 0.8, b: 0.55, tilt: -0.95, tspd: -0.009, dash: false, dots: [{ ang: 2.2, spd: -0.16, r: 2.6, gold: false }] },
  { a: 0.68, b: 0.64, tilt: 0.2, tspd: 0.006, dash: true, dots: [{ ang: 5.1, spd: 0.3, r: 1.8, gold: true }] },
  { a: 0.93, b: 0.42, tilt: 2.05, tspd: 0.01, dash: false, dots: [{ ang: 1.1, spd: 0.12, r: 3.8, gold: true, halo: true }] },
  { a: 0.52, b: 0.24, tilt: -0.3, tspd: -0.015, dash: true, dots: [{ ang: 4.2, spd: 0.35, r: 1.6, gold: false }] },
];

const vlines = [
  { x: -0.34, ph: 0.3, dots: [-0.55, -0.12, 0.4] },
  { x: 0.2, ph: 1.7, dots: [-0.3, 0.2, 0.58] },
  { x: 0.5, ph: 3.1, dots: [-0.45, 0.1] },
];

// 粉塵：一部分聚在絲帶附近，一部分散成雲
const DUST = 6000;
const dust = (() => {
  const list = [];
  for (let i = 0; i < DUST; i++) {
    let x, y, z;
    if (Math.random() < 0.6) {
      const u = Math.random() * TAU;
      const r = 0.46 * (1 + 0.16 * Math.sin(2 * u));
      x = r * 1.15 * Math.cos(u) + gauss() * 0.24;
      y = r * 0.8 * Math.sin(u) + gauss() * 0.24;
      z = r * 0.35 * Math.sin(2 * u) + gauss() * 0.24;
    } else {
      x = gauss() * 0.85; y = gauss() * 0.85; z = gauss() * 0.85; // 外圍的雲，範圍拉到幾乎填滿圓形
    }
    const roll = Math.random();
    list.push({
      x, y, z,
      cls: roll < 0.68 ? 0 : roll < 0.9 ? 1 : 2, // 主色、泛白、強調色（金）
      s: 0.7 + Math.random() * 1.1,
      tw: 0.8 + Math.random() * 3,
      ph: Math.random() * TAU,
    });
  }
  list.sort((p, q) => p.cls - q.cls);
  return list;
})();

const stars = Array.from({ length: 160 }, () => ({
  a: Math.random() * TAU,
  d: Math.sqrt(Math.random()) * 0.97,
  s: Math.random() < 0.08 ? 1.6 : 0.8 + Math.random() * 0.6,
  tw: 0.5 + Math.random() * 2.5,
  ph: Math.random() * TAU,
}));

const meteors = [];
function spawnMeteor() {
  if (meteors.length > 3) return;
  const a = Math.random() * TAU;
  const speed = 0.9 + Math.random() * 0.8;
  meteors.push({
    x: Math.cos(a) * 0.85, y: Math.sin(a) * 0.85,
    vx: -Math.cos(a + (Math.random() - 0.5) * 0.9) * speed,
    vy: -Math.sin(a + (Math.random() - 0.5) * 0.9) * speed,
    life: 0, max: 0.7 + Math.random() * 0.5,
  });
}

// ───────────────────────── 繪製 ─────────────────────────
let rot = 0;

function drawBackground(t) {
  ctx.globalCompositeOperation = 'source-over';
  const bh = visual === 'blackhole';
  const d = pal.P.map((v) => v * (bh ? 0.003 : 0.05)); // 以主色壓暗當底色：銀河是深藍夜空，黑洞幾乎全黑
  const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, R);
  // 中央較實，往外逐漸變透，最外緣完全透明、直接融進桌面（透明度走法同最早版本，底色維持較深）
  g.addColorStop(0, rgba(d.map((v) => v * 1.5), 0.94));
  g.addColorStop(0.62, rgba(d, 0.86));
  g.addColorStop(0.94, rgba(d.map((v) => v * 0.5), 0.5));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (bh) return;
  // 兩團淡淡的星雲：一團主色、一團強調色，像參考圖裡金色流過藍色
  ctx.globalCompositeOperation = 'lighter';
  const clouds = [
    { col: pal.P, ox: Math.cos(t * 0.05) * 0.35, oy: Math.sin(t * 0.07) * 0.3, rr: 0.8, a: 0.1 },
    { col: pal.A, ox: Math.cos(t * 0.045 + 3) * 0.4, oy: Math.sin(t * 0.055 + 2) * 0.35, rr: 0.6, a: 0.055 },
  ];
  for (const c of clouds) {
    const x = CX + c.ox * R, y = CY + c.oy * R, rr = c.rr * R;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    const a = c.a + sound.mid * 0.06 + sound.level * 0.03;
    cg.addColorStop(0, rgba(c.col, a));
    cg.addColorStop(1, rgba(c.col, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}

function drawStars(t) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(tint(pal.P, 0.75), 1);
  const spin = t * 0.004;
  for (const s of stars) {
    const a = s.a + spin;
    const x = CX + Math.cos(a) * s.d * R;
    const y = CY + Math.sin(a) * s.d * R;
    const edge = clamp((0.97 - s.d) / 0.12, 0, 1);
    ctx.globalAlpha = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph)) + sound.treble * 0.2) * edge * (visual === 'blackhole' ? 0.5 : 1);
    ctx.fillRect(x, y, s.s * SC, s.s * SC);
  }
  ctx.globalAlpha = 1;
}

function drawVLines(t) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(0.6, 0.8 * SC * 0.8);
  const line = rgba(pal.W, 1);
  for (const v of vlines) {
    const x = CX + (v.x + 0.018 * Math.sin(t * 0.2 + v.ph)) * R;
    const g = ctx.createLinearGradient(0, CY - R * 0.85, 0, CY + R * 0.85);
    g.addColorStop(0, rgba(pal.W, 0));
    g.addColorStop(0.5, rgba(pal.W, 0.28 + sound.level * 0.15));
    g.addColorStop(1, rgba(pal.W, 0));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, CY - R * 0.85);
    ctx.lineTo(x, CY + R * 0.85);
    ctx.stroke();
    v.dots.forEach((dy, i) => {
      const y = CY + (dy + 0.05 * Math.sin(t * 0.3 + i * 2 + v.ph)) * R;
      const r = (1.4 + sound.kick * 1.4) * SC;
      ctx.fillStyle = i % 2 ? rgba(tint(pal.A, 0.3), 0.9) : line;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
}

function orbitPoint(o, ang, t) {
  const tilt = o.tilt + t * o.tspd;
  const ex = Math.cos(ang) * o.a * R, ey = Math.sin(ang) * o.b * R;
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return [CX + ex * c - ey * s, CY + ex * s + ey * c];
}

function drawOrbitRings(t) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(0.6, 0.7 * SC);
  for (const o of orbits) {
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(o.tilt + t * o.tspd);
    ctx.strokeStyle = rgba(tint(pal.W, 0.1), 0.2 + sound.level * 0.12);
    ctx.setLineDash(o.dash ? [2 * SC, 5 * SC] : []);
    ctx.beginPath();
    ctx.ellipse(0, 0, o.a * R, o.b * R, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);
}

function drawOrbitDots(dt, t) {
  ctx.globalCompositeOperation = 'lighter';
  for (const o of orbits) {
    for (const d of o.dots) {
      d.ang += dt * d.spd * (1 + sound.level * 1.4);
      const [x, y] = orbitPoint(o, d.ang, t);
      const r = d.r * SC * (1 + sound.kick * 0.55);
      const col = d.gold ? pal.A : tint(pal.P, 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, rgba(tint(col, 0.7), 0.95));
      g.addColorStop(0.25, rgba(col, 0.7));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      if (d.halo) {
        ctx.strokeStyle = rgba(col, 0.4);
        ctx.lineWidth = Math.max(0.6, 0.7 * SC);
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, TAU);
        ctx.stroke();
      }
    }
  }
}

function drawDust(t) {
  const m = makeRot(rot * 0.5, 0.7 + 0.15 * Math.sin(t * 0.09), -0.3);
  const breathe = 1 + sound.bass * 0.1 + sound.kick * 0.09;
  const jitter = sound.treble * 0.012;
  const colors = [rgba(tint(pal.P, 0.35), 1), rgba(tint(pal.W, 0.2), 1), rgba(tint(pal.A, 0.15), 1)];
  ctx.globalCompositeOperation = 'lighter';
  let last = -1;
  for (const p of dust) {
    const x0 = p.x * breathe + Math.sin(t * p.tw + p.ph) * jitter;
    const y0 = p.y * breathe + Math.cos(t * p.tw * 0.8 + p.ph) * jitter;
    const z0 = p.z * breathe;
    const x = m[0] * x0 + m[1] * y0 + m[2] * z0;
    const y = m[3] * x0 + m[4] * y0 + m[5] * z0;
    const z = m[6] * x0 + m[7] * y0 + m[8] * z0;
    const k = FOCAL / (FOCAL - z);
    const depth = clamp((z + 1) / 2, 0, 1);
    const flick = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
    if (p.cls !== last) { ctx.fillStyle = colors[p.cls]; last = p.cls; }
    ctx.globalAlpha = clamp((0.2 + 0.5 * flick) * (0.5 + 0.5 * depth) * (0.65 + sound.treble * 0.6 + sound.level * 0.3), 0, 1);
    const sz = p.s * SC * (0.7 + 0.3 * depth) * (p.cls === 2 ? 1.25 : 0.9);
    ctx.fillRect(CX + x * k * R, CY + y * k * R, sz, sz);
  }
  ctx.globalAlpha = 1;
}

function drawRibbon(rb, t, yaw, pitch, roll) {
  const m = makeRot(yaw, pitch, roll);
  const N1 = NU + 1;
  const pts = rb.pts;
  for (let iu = 0; iu <= NU; iu++) {
    const u = (iu / NU) * TAU;
    const c = Math.cos(u), s = Math.sin(u);
    // 頻譜沿著絲帶分布：一端是低音、另一端是高音，聲音大的地方絲帶就鼓起來
    const bv = sampleBars(Math.abs((iu / NU) * 2 - 1));
    const rad = rb.scale * (1 + 0.1 * Math.sin(2 * u + t * 0.35 + rb.ph) + 0.26 * bv + sound.kick * 0.13 + sound.bass * 0.09);
    const cx = rad * 1.15 * c, cy = rad * 0.8 * s, cz = rad * 0.22 * Math.sin(2 * u + t * 0.2 + rb.ph);
    const tw = (rb.n / 2) * u + rb.tw0 + t * rb.twSpeed * (1 + sound.level);
    const w = rb.width * (1 + sound.bass * 0.35 + 0.4 * bv + sound.kick * 0.15);
    const ct = Math.cos(tw) * w, st = Math.sin(tw) * w;
    const wx = ct * c, wy = ct * s, wz = st;
    const Cx = m[0] * cx + m[1] * cy + m[2] * cz;
    const Cy = m[3] * cx + m[4] * cy + m[5] * cz;
    const Cz = m[6] * cx + m[7] * cy + m[8] * cz;
    const Wx = m[0] * wx + m[1] * wy + m[2] * wz;
    const Wy = m[3] * wx + m[4] * wy + m[5] * wz;
    const Wz = m[6] * wx + m[7] * wy + m[8] * wz;
    for (let j = 0; j < rb.strands; j++) {
      const v = rb.vs[j];
      const k = FOCAL / (FOCAL - (Cz + v * Wz));
      const o = (j * N1 + iu) * 2;
      pts[o] = CX + (Cx + v * Wx) * k * R;
      pts[o + 1] = CY + (Cy + v * Wy) * k * R;
    }
  }

  // 金色高光沿著絲帶緩慢流動，鼓點會推它一下
  const per = NU / ARCS;
  const gph = t * 0.17 * rb.dir + rb.ph + sound.bass * 0.25;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const boost = 1 + sound.level * 0.7 + sound.kick * 0.4;
  for (const tier of rb.tiers) {
    ctx.lineWidth = Math.max(0.5, tier.lw * SC * 0.85);
    for (let k = 0; k < ARCS; k++) {
      const uMid = ((k + 0.5) / ARCS) * TAU;
      const g = Math.pow(0.5 + 0.5 * Math.cos(2 * (uMid - gph)), 2.2);
      ctx.strokeStyle = rgba(colorAt(g), clamp(tier.alpha * boost * (0.85 + g * 0.5), 0, 1));
      ctx.beginPath();
      for (const j of tier.idx) {
        const base = j * N1 + k * per;
        ctx.moveTo(pts[base * 2], pts[base * 2 + 1]);
        for (let i = 1; i <= per; i++) ctx.lineTo(pts[(base + i) * 2], pts[(base + i) * 2 + 1]);
      }
      ctx.stroke();
    }
  }
}

// 柔光：把目前畫面縮小模糊後再疊回去，細線與粒子邊緣會暈開成光霧
const bloomCanvas = document.createElement('canvas');
const bloomCtx = bloomCanvas.getContext('2d');
function drawBloom() {
  const bw = Math.max(32, Math.round(canvas.width / 6));
  const bh = Math.max(32, Math.round(canvas.height / 6));
  if (bloomCanvas.width !== bw || bloomCanvas.height !== bh) {
    bloomCanvas.width = bw;
    bloomCanvas.height = bh;
  }
  bloomCtx.globalCompositeOperation = 'copy';
  bloomCtx.imageSmoothingQuality = 'high';
  bloomCtx.drawImage(canvas, 0, 0, bw, bh);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // 圓形裁切已在 frame() 設好，這裡直接用裝置像素疊回
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = (visual === 'blackhole' ? 0.18 : 0.5) + sound.level * (visual === 'blackhole' ? 0.1 : 0.18) + sound.kick * 0.2;
  ctx.drawImage(bloomCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawMeteors(dt) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.life += dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const d = Math.hypot(m.x, m.y);
    if (m.life > m.max || d > 0.98) { meteors.splice(i, 1); continue; }
    const fade = Math.sin((m.life / m.max) * Math.PI) * clamp((0.97 - d) / 0.1, 0, 1);
    const x = CX + m.x * R, y = CY + m.y * R;
    const tx = x - m.vx * R * 0.16, ty = y - m.vy * R * 0.16;
    const g = ctx.createLinearGradient(x, y, tx, ty);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
    g.addColorStop(1, rgba(pal.A, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
}

function drawToast(dt) {
  ctx.globalCompositeOperation = 'source-over';
  if (toast.t > 0) {
    toast.t -= dt;
    ctx.globalAlpha = clamp(toast.t, 0, 1) * 0.85;
    ctx.fillStyle = '#dfe6ff';
    ctx.font = `${Math.round(R * 0.06)}px "Segoe UI",sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(toast.text, CX, CY + R * 0.82);
    ctx.globalAlpha = 1;
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
  last = now;
  const t = now / 1000;
  if ((window.devicePixelRatio || 1) !== lastDevicePR) resize(); // 視窗被拖到不同縮放比例的螢幕

  analyze(now, dt);
  updatePalette();
  rot += dt * (0.1 + sound.level * 0.25 + sound.kick * 0.35);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R * 0.99, 0, TAU); // 背景與光暈都不許溢出圓外
  ctx.clip();
  drawBackground(t);
  drawStars(t);
  if (visual === 'blackhole') {
    drawBlackHoleScene(t, dt);
  } else {
    drawVLines(t);
    drawOrbitRings(t);
    drawDust(t);
    drawRibbon(ribbons[1], t, -rot * 0.6 + 1.7, 0.5 + 0.3 * Math.sin(t * 0.09 + 1), 0.7);
    drawRibbon(ribbons[0], t, rot * 0.8, 1.0 + 0.25 * Math.sin(t * 0.11), -0.5 + 0.15 * Math.sin(t * 0.07));
    drawOrbitDots(dt, t);
  }
  drawBloom();
  drawMeteors(dt);
  if (visualFade < 1) { // 切換風格時從暗處淡入
    visualFade = Math.min(1, visualFade + dt / 0.6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(3,3,10,${1 - visualFade})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  drawToast(dt);

  requestAnimationFrame(frame);
}

// ───────────────────────── 視窗互動 ─────────────────────────
const inCircle = (e) => (e.clientX - CX) ** 2 + (e.clientY - CY) ** 2 <= R * R;
let dragging = false;
let ignoring = false;

function setIgnore(v) {
  if (v !== ignoring) { ignoring = v; api.setIgnore(v); }
}

window.addEventListener('mousemove', (e) => { if (!dragging) setIgnore(!inCircle(e)); });
window.addEventListener('mousedown', (e) => {
  if (e.button === 0 && inCircle(e)) { dragging = true; api.dragStart(); }
});
window.addEventListener('mouseup', () => {
  if (dragging) { dragging = false; api.dragEnd(); }
});
window.addEventListener('blur', () => { dragging = false; });
window.addEventListener('dblclick', (e) => { if (inCircle(e)) api.cycleVisual(); });
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (inCircle(e)) api.showMenu();
});

// ───────────────────────── 啟動 ─────────────────────────
api.getSettings().then((s) => {
  debug = !!s.debug;
  if (s.visual) setVisual(s.visual, false);
  syncDelayMs = s.syncDelay || 0;
  startSource(s.source);
});
requestAnimationFrame(frame);
