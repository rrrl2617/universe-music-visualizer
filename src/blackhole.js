'use strict';
// 黑洞陷落：以量子力學為主的公式從右側流入，被黑洞的重力扭曲。
// 公式不是一整張貼圖，而是一顆顆字元粒子：每個字元各自受重力牽引，
// 靠近黑洞的字元先被加速、先被拉長，後面的字元還在遠處，整行字就這樣被「拉成一條線」吸進去，
// 和旁邊的光絲遵守同一套物理，所以看起來是同一個東西。
// 與 renderer.js 共用 ctx、R、CX、CY、SC、pal、sound、sampleBars 等全域變數；
// 載入順序必須在 renderer.js 之後，所有繪圖函式只在 frame() 中被呼叫。

const BH_FORMULAS = [
  'iħ ∂ψ/∂t = Ĥψ',
  'Ĥψ = Eψ',
  '−ħ²/2m ∇²ψ + Vψ = Eψ',
  '[x, p] = iħ',
  'ΔxΔp ≥ ħ/2',
  'ΔE Δt ≥ ħ/2',
  '|ψ(x)|² = P(x)',
  '⟨ψ|φ⟩ = ∫ ψ*φ dx',
  '⟨A⟩ = ⟨ψ|Â|ψ⟩',
  '(iγ^μ ∂_μ − m)ψ = 0',
  '(□ + m²)φ = 0',
  'ψ(x,t) = Σ cₙ φₙ(x) e^{−iEₙt/ħ}',
  '|Ψ⟩ = (|01⟩ − |10⟩)/√2',
  '|α|² + |β|² = 1',
  'ρ = Σ pᵢ |ψᵢ⟩⟨ψᵢ|',
  '∫ D[x] e^{iS[x]/ħ}',
  'a†|n⟩ = √(n+1) |n+1⟩',
  'Ĥ|n⟩ = ħω(n + ½)|n⟩',
  'σₓσᵧ = iσ_z',
  'Eₙ = −13.6 eV / n²',
  'ψ(r,θ,φ) = R(r) Y_lm(θ,φ)',
  'Γ = (2π/ħ) |⟨f|H|i⟩|² ρ',
  'E = hν',
  'λ = h/p',
  'S = k_B ln Ω',
  'T_H = ħc³ / 8πGMk_B',
  'S_BH = k c³ A / 4Għ',
];

const bhFont = (px) => `italic ${px}px "Cambria Math","Segoe UI Symbol","Times New Roman",serif`;
const BH_TEXT_SIZE = 0.05;   // 公式字體高度（以 R 為單位）
let bhFontPx = 24;           // 目前貼圖使用的字體像素
const BH_RS = 0.19;          // 事件視界半徑（以 R 為單位）
const BH_HX = -0.24;         // 黑洞位置（相對視窗中心，以 R 為單位），偏左，好讓右側有空間讓東西流進來
const BH_HY = 0;
const BH_GM = 0.09;          // 重力強度：越大，彎折越明顯、被吞的範圍越寬
let bhTokenSpeed = 0.8;      // 公式的流速倍率（相對於光絲），慢歌時會再降低
let bhRsLive = BH_RS;        // 隨節奏脹縮的即時視界半徑（以 R 為單位）
const bhSnap = (v) => Math.round(v * dpr) / dpr; // 對齊到裝置像素
const bhPx = (v) => Math.max(2.2 / dpr, Math.round(v * dpr) / dpr); // 圓點太小會變成糊點，所以設下限

// ───────────── 字元貼圖：每個不同的字元畫一張，所有公式的字元共用 ─────────────
const BH_CHARS = [...new Set(BH_FORMULAS.join('').replace(/\s/g, ''))];
const bhGlyphs = new Map();
let bhSpaceAdv = 6;          // 空白的寬度（貼圖像素）
let bhSpriteKey = '';

// 貼圖的字體像素 ≈ 實際在螢幕上顯示的像素，幾乎 1:1 貼上去，字形才會銳利。
// 顏色跟著氛圍配色走，所以顏色變化超過一定程度才重畫。
function bhBuildSprites(col) {
  const px = Math.round(clamp(R * BH_TEXT_SIZE * dpr * 1.1, 18, 72));
  const key = col.map((v) => Math.round(v / 12)).join(',') + '|' + px;
  if (key === bhSpriteKey) return;
  bhSpriteKey = key;
  bhFontPx = px;
  const css = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
  const pad = Math.round(px / 4);
  const h = Math.round(px * 1.7);
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = bhFont(px);
  bhSpaceAdv = probe.measureText(' ').width;
  for (const ch of BH_CHARS) {
    const adv = probe.measureText(ch).width;
    const entry = bhGlyphs.get(ch) || { canvas: document.createElement('canvas') };
    entry.canvas.width = Math.ceil(adv) + pad * 2; // 改尺寸會清空畫布與狀態
    entry.canvas.height = h;
    const g = entry.canvas.getContext('2d');
    g.font = bhFont(px);
    g.fillStyle = css;
    g.shadowColor = css;
    g.shadowBlur = Math.max(1, px / 16); // 只保留一點點發光，字形保持銳利
    g.textBaseline = 'middle';
    g.fillText(ch, pad, h / 2);
    entry.w = entry.canvas.width;
    entry.h = h;
    entry.adv = adv; // 排版用的寬度
    bhGlyphs.set(ch, entry);
  }
}

// ───────────── 重力與粒子（位置與速度都以 R 為單位，原點在視窗中心） ─────────────
function bhSpawn(p, initial) {
  const v0 = 0.42 + Math.random() * 0.2;
  p.x = initial ? -0.9 + Math.random() * 2.2 : 1.12 + Math.random() * 0.25;
  p.y = (Math.random() * 2 - 1) * 1.05;
  p.ly = p.y; // 出生時的高度，決定它屬於哪一條「頻譜光帶」
  p.vx = -v0;
  p.vy = (Math.random() - 0.5) * 0.04;
  p.age = 0;
}

// 簡化的重力：a = GM / d²，朝向黑洞。分三小步積分，靠近視界時速度很快，步長不能太大。
// 回傳 false 代表被吞掉、飛出畫面或活太久（避免繞成永遠不離開的軌道），需要重生。
function bhStep(p, dt) {
  const n = 3, h = dt / n;
  for (let i = 0; i < n; i++) {
    const dx = BH_HX - p.x, dy = BH_HY - p.y;
    const d2 = dx * dx + dy * dy + 0.002;
    const a = BH_GM / (d2 * Math.sqrt(d2));
    p.vx += dx * a * h;
    p.vy += dy * a * h;
    p.x += p.vx * h;
    p.y += p.vy * h;
  }
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > 2.6) { p.vx *= 2.6 / sp; p.vy *= 2.6 / sp; }
  p.age += dt;
  const fx = p.x - BH_HX, fy = p.y - BH_HY;
  if (fx * fx + fy * fy < bhRsLive * bhRsLive * 0.96 || p.age > 16) return false;
  return !(p.x < -1.35 || p.x > 1.7 || Math.abs(p.y) > 1.45);
}

// 從高度對應到頻譜：中間高度吃低音，越往上下越是高音，聲音大的那條光帶就比較亮
const bhLane = (ly) => 0.55 + 0.9 * sampleBars(Math.min(1, Math.abs(ly)));

// ───────────── 光絲：每條都帶一段軌跡，畫出來就是被重力彎折的流線 ─────────────
const BH_N = 750;       // 光絲數量
const BH_T = 14;         // 每條軌跡的點數
const BH_STEP = 0.033;   // 軌跡每隔多少（模擬）秒記一個點，所以軌跡長度不隨幀率改變太多
const bhStreaks = Array.from({ length: BH_N }, () => {
  const p = { b: 0.3 + Math.random() * 0.7 };
  bhSpawn(p, true);
  return p;
});
const bhTrail = new Float32Array(BH_N * BH_T * 2); // 環狀緩衝：每條光絲最近 BH_T 個位置
let bhHead = 0;
let bhAcc = 0;
function bhFillTrail(i, p) { // 重生時把整條軌跡設成新位置，避免畫出橫跨畫面的線
  for (let k = 0; k < BH_T; k++) {
    const o = (i * BH_T + k) * 2;
    bhTrail[o] = p.x;
    bhTrail[o + 1] = p.y;
  }
}
bhStreaks.forEach((p, i) => bhFillTrail(i, p));

const BH_BUCKETS = 4;
const bhBucketIdx = Array.from({ length: BH_BUCKETS }, () => new Int32Array(BH_N));
const bhBucketN = new Int32Array(BH_BUCKETS);
const BH_BUCKET_ALPHA = [0.05, 0.13, 0.26, 0.5];

function bhStreakPass(dt, col) {
  bhAcc += dt;
  let push = false;
  if (bhAcc >= BH_STEP) {
    bhAcc = Math.min(bhAcc - BH_STEP, BH_STEP);
    bhHead = (bhHead + 1) % BH_T;
    push = true;
  }
  bhBucketN.fill(0);
  for (let i = 0; i < BH_N; i++) {
    const p = bhStreaks[i];
    if (!bhStep(p, dt)) { bhSpawn(p, false); bhFillTrail(i, p); }
    else if (push) {
      const o = (i * BH_T + bhHead) * 2;
      bhTrail[o] = p.x;
      bhTrail[o + 1] = p.y;
    }
    const fx = p.x - BH_HX, fy = p.y - BH_HY;
    const d = Math.sqrt(fx * fx + fy * fy);
    const near = clamp(1 - (d - bhRsLive) / 0.9, 0, 1); // 越靠近黑洞越亮
    const a = p.b * bhLane(p.ly) * (0.25 + 0.6 * Math.pow(near, 0.9))
      * clamp((1.15 - p.x) / 0.15, 0, 1) * clamp((d - bhRsLive) / 0.04, 0, 1);
    const bi = Math.min(BH_BUCKETS - 1, Math.floor(a * 4.5));
    bhBucketIdx[bi][bhBucketN[bi]++] = i;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = Math.max(0.6, 0.8 * SC * 0.85);
  for (let b = 0; b < BH_BUCKETS; b++) {
    const n = bhBucketN[b];
    if (!n) continue;
    // 整條軌跡用較淡的透明度，最新的一小段再加亮一次，形成「頭亮尾淡」的流線
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1 && b < 2) continue;
      const pts = pass === 0 ? BH_T : 6;
      ctx.strokeStyle = rgba(col, pass === 0 ? BH_BUCKET_ALPHA[b] : Math.min(0.9, BH_BUCKET_ALPHA[b] * 1.7));
      ctx.lineWidth = pass === 0 ? lw : lw * 1.15;
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const i = bhBucketIdx[b][j];
        const p = bhStreaks[i];
        ctx.moveTo(CX + p.x * R, CY + p.y * R);
        for (let k = 0; k < pts; k++) {
          const o = (i * BH_T + ((bhHead - k + BH_T) % BH_T)) * 2;
          ctx.lineTo(CX + bhTrail[o] * R, CY + bhTrail[o + 1] * R);
        }
      }
      ctx.stroke();
    }
  }
}

// ───────────── 公式：整行字，每個字元各自受重力 ─────────────
const BH_FORM_COUNT = 46;     // 公式的總條數（含還在畫面外等著進場的）；畫面上同時可讀的約 8 條
const bhForms = Array.from({ length: BH_FORM_COUNT }, () => ({ chars: [], born: false, wait: 0 }));
let bhReadableSum = 0, bhReadableN = 0; // 除錯用：統計畫面上「可讀」的公式條數

function bhSpawnFormula(e, initial) {
  const text = BH_FORMULAS[(Math.random() * BH_FORMULAS.length) | 0];
  const sz = 0.85 + Math.random() * 0.4;
  const rPerPx = (BH_TEXT_SIZE / bhFontPx) * sz; // 一個貼圖像素等於多少 R
  const x0 = initial ? -0.2 + Math.random() * 1.8 : 1.12 + Math.random() * 0.5;
  const y0 = (Math.random() * 2 - 1) * 0.9;
  const v0 = 0.34 + Math.random() * 0.14;
  e.chars = [];
  let cx = 0;
  for (const ch of text) {
    if (ch === ' ') { cx += bhSpaceAdv * rPerPx; continue; }
    const g = bhGlyphs.get(ch);
    if (!g) continue;
    const w = g.adv * rPerPx;
    // 字元排成一列，左邊的字元（公式開頭）離黑洞最近，所以最先被拉走，後面的字元像尾巴一樣跟上
    e.chars.push({ g, x: x0 + cx + w / 2, y: y0, vx: -v0, vy: 0, ly: y0, sz, age: 0 });
    cx += w;
  }
  e.total = e.chars.length;
}

function bhTokenPass(dt) {
  // 靠近黑洞時，每個字元後面拖一小段光，把字和流線接起來。
  // 畫字元時會切換到每個字元自己的旋轉縮放座標系，所以拖尾線先收集起來，等座標系還原後再畫。
  const smear = [];
  let readable = 0;
  for (const e of bhForms) {
    let vis = 0;
    if (!e.chars.length) {
      // 用完之後隨機等一小段時間再從右側進場，這樣公式不會一批一批同時出現，畫面上的條數比較穩定
      if (e.born && e.wait <= 0) e.wait = 0.2 + Math.random() * 1.6;
      e.wait -= dt;
      if (!e.born || e.wait <= 0) { bhSpawnFormula(e, !e.born); e.born = true; e.wait = 0; }
    }
    for (let i = e.chars.length - 1; i >= 0; i--) {
      const p = e.chars[i];
      const fx = p.x - BH_HX, fy = p.y - BH_HY;
      const d = Math.sqrt(fx * fx + fy * fy);
      const near = clamp(1 - (d - bhRsLive) / 0.8, 0, 1);

      // 越靠近越沿著前進方向拉長、壓扁；遠處保持正立，近處才轉向速度方向
      let va = Math.atan2(p.vy, p.vx);
      if (va > Math.PI / 2) va -= Math.PI; else if (va < -Math.PI / 2) va += Math.PI;
      const ang = va * clamp(near * 1.6, 0, 1);
      const stretch = 1 + 7 * near * near;
      const thin = clamp(1 - 0.9 * Math.pow(near, 1.3), 0.07, 1);
      const base = ((R * BH_TEXT_SIZE) / bhFontPx) * p.sz * (0.5 + 0.5 * (1 - near));
      const alpha = clamp(
        0.8 * (0.8 + 0.2 * bhLane(p.ly)) * clamp((1.15 - p.x) / 0.2, 0, 1)
          * Math.pow(clamp((d - bhRsLive) / 0.15, 0, 1), 0.7) * (1 + near * 0.4), 0, 0.95);

      if (debug && alpha > 0.3 && near < 0.5 && p.x * p.x + p.y * p.y < 0.95) vis++;
      if (alpha > 0.02) {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const sx = base * stretch, sy = base * thin;
        ctx.setTransform(dpr * ca * sx, dpr * sa * sx, -dpr * sa * sy, dpr * ca * sy,
          dpr * (CX + p.x * R), dpr * (CY + p.y * R));
        ctx.globalAlpha = alpha;
        ctx.drawImage(p.g.canvas, -p.g.w / 2, -p.g.h / 2);
      }
      if (near > 0.2 && alpha > 0.1) {
        smear.push(CX + p.x * R, CY + p.y * R, CX + (p.x - p.vx * 0.12) * R, CY + (p.y - p.vy * 0.12) * R);
      }
      if (!bhStep(p, dt * bhTokenSpeed)) e.chars.splice(i, 1);
    }
    if (e.total && vis >= Math.max(3, e.total * 0.5)) readable++; // 至少一半的字元在畫面內且夠亮，才算一條完整可讀的公式
  }
  if (debug) {
    bhReadableSum += readable;
    if (++bhReadableN >= 60) {
      console.log(`readable formulas (avg of last ${bhReadableN} frames): ${(bhReadableSum / bhReadableN).toFixed(1)}`);
      bhReadableSum = 0;
      bhReadableN = 0;
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 還原座標系，再畫拖尾線
  if (smear.length) {
    ctx.globalAlpha = 0.28;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.6, 0.8 * SC * 0.85);
    ctx.strokeStyle = rgba(tint(pal.P, 0.82), 1);
    ctx.beginPath();
    for (let i = 0; i < smear.length; i += 4) {
      ctx.moveTo(smear[i], smear[i + 1]);
      ctx.lineTo(smear[i + 2], smear[i + 3]);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ───────────── 黑洞左側的放射狀細芒：像參考圖裡幾道細細的亮線，緩慢閃爍，不跟著鼓點跳 ─────────────
const bhSpikes = Array.from({ length: 9 }, () => ({
  a: Math.PI + (Math.random() - 0.5) * 1.8,
  len: 0.9 + Math.random() * 1.7,
  ph: Math.random() * TAU,
  sp: 0.4 + Math.random() * 0.8,
}));
function bhDrawSpikes(t, hx, hy, rs, ringCol) {
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.6, 0.7 * SC);
  for (const s of bhSpikes) {
    const a = 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
    ctx.strokeStyle = rgba(ringCol, a);
    const c = Math.cos(s.a), si = Math.sin(s.a);
    ctx.beginPath();
    ctx.moveTo(hx + c * rs * 1.2, hy + si * rs * 1.2);
    ctx.lineTo(hx + c * rs * (1.2 + s.len), hy + si * rs * (1.2 + s.len));
    ctx.stroke();
  }
}

// ───────────── 光子環：粒子沿著黑洞繞行，亮度依角度變化（最亮處在 beamA） ─────────────
const bhBeam = (a, beamA) => Math.pow(0.5 + 0.5 * Math.cos(a - beamA), 2.4);
const bhRing = (() => {
  const list = [];
  const beamA = Math.PI * 0.9;
  while (list.length < 1700) {
    const a = Math.random() * TAU;
    if (Math.random() > 0.3 + 0.7 * bhBeam(a, beamA)) continue; // 亮的一側放多一點粒子
    list.push({
      a,
      rr: 1 + gauss() * 0.024 + (Math.random() < 0.1 ? Math.random() * 0.16 : 0),
      w: 0.5 + Math.random() * 0.9,
      s: 0.8 + Math.random() * 1.5,
      ph: Math.random() * TAU,
    });
  }
  return list;
})();

// 圓點的批次繪製：同顏色、同透明度的圓點先累積成一條路徑，最後一次填色。
// 比每顆粒子各自 drawImage 或 fill 快很多。
const BH_RING_BUCKETS = 6;
const bhRingIdx = [0, 1].map(() => Array.from({ length: BH_RING_BUCKETS }, () => new Int32Array(bhRing.length)));
const bhRingN = [0, 1].map(() => new Int32Array(BH_RING_BUCKETS));
const bhRingXYR = new Float32Array(bhRing.length * 3);

function bhDrawRing(t, dt, hx, hy, rs, ringCol) {
  const beamA = Math.PI * 0.9 + 0.15 * Math.sin(t * 0.2);
  const ringR = rs * (1.14 + sound.kick * 0.015);
  const spin = 0.6 + sound.level * 1.2 + sound.kick * 0.8;
  bhRingN[0].fill(0);
  bhRingN[1].fill(0);
  for (let i = 0; i < bhRing.length; i++) {
    const p = bhRing[i];
    p.a += p.w * spin * dt;
    const beam = bhBeam(p.a, beamA);
    const r = ringR * (p.rr + 0.012 * Math.sin(t * 3 + p.ph) + sound.treble * 0.01 * Math.sin(t * 9 + p.ph));
    const al = clamp((0.08 + 0.92 * beam) * (0.7 + 0.2 * Math.sin(t * 2.2 + p.ph) * 0.5 + sound.level * 0.2 + sound.kick * 0.1) * (0.6 + 0.6 * beam), 0, 1);
    const rad = bhPx(p.s * SC * (0.8 + 1.5 * beam)) / 2;
    bhRingXYR[i * 3] = bhSnap(hx + Math.cos(p.a) * r);
    bhRingXYR[i * 3 + 1] = bhSnap(hy + Math.sin(p.a) * r);
    bhRingXYR[i * 3 + 2] = rad;
    const g = beam > 0.55 ? 1 : 0;
    const bi = Math.min(BH_RING_BUCKETS - 1, Math.floor(al * BH_RING_BUCKETS));
    bhRingIdx[g][bi][bhRingN[g][bi]++] = i;
  }
  ctx.globalCompositeOperation = 'lighter';
  const styles = [rgba(ringCol, 1), rgba(tint(ringCol, 0.55), 1)];
  for (let g = 0; g < 2; g++) {
    ctx.fillStyle = styles[g];
    for (let b = 0; b < BH_RING_BUCKETS; b++) {
      const n = bhRingN[g][b];
      if (!n) continue;
      ctx.globalAlpha = (b + 0.6) / BH_RING_BUCKETS;
      ctx.beginPath();
      const list = bhRingIdx[g][b];
      for (let k = 0; k < n; k++) {
        const o = list[k] * 3;
        ctx.moveTo(bhRingXYR[o] + bhRingXYR[o + 2], bhRingXYR[o + 1]);
        ctx.arc(bhRingXYR[o], bhRingXYR[o + 1], bhRingXYR[o + 2], 0, TAU);
      }
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ───────────── 吸積盤：粒子依克卜勒規律繞行（內圈快、外圈慢），整個盤面向觀察者傾斜 ─────────────
const BH_TILT = -0.28;
const BH_DISK_FLAT = 0.3; // 盤面被壓扁的比例（傾斜角度）
const bhDisk = Array.from({ length: 2400 }, () => ({
  a: Math.random() * TAU,
  r: 1.5 + 2.1 * Math.pow(Math.random(), 1.35), // 內圈比較密
  s: 0.8 + Math.random() * 1.2,
  ph: Math.random() * TAU,
  x: 0, y: 0, sz: 1, // 每幀更新的暫存
}));
const BH_DISK_BUCKETS = 6;
const bhDiskIdx = [0, 1].map(() => Array.from({ length: BH_DISK_BUCKETS }, () => new Int32Array(bhDisk.length)));
const bhDiskN = [0, 1].map(() => new Int32Array(BH_DISK_BUCKETS));

// 被透鏡效應折到黑洞上下方的盤面像：上方一道大的拱、下方一道較小的，粒子沿著弧線流動
const bhArcs = [
  { r: 1.34, from: Math.PI, to: TAU, list: [] },     // 上方
  { r: 1.24, from: 0, to: Math.PI, list: [] },       // 下方
].map((arc, i) => {
  for (let n = 0; n < (i === 0 ? 380 : 220); n++) {
    arc.list.push({
      u: Math.random(),                // 沿弧線的位置 0..1
      v: 0.05 + Math.random() * 0.1,   // 沿弧線的流速
      rr: 1 + gauss() * 0.018,
      s: 0.8 + Math.random() * 1.2,
      ph: Math.random() * TAU,
    });
  }
  return arc;
});
const BH_ARC_BUCKETS = 4;
const BH_ARC_TOTAL = bhArcs.reduce((n, a) => n + a.list.length, 0);
const bhArcIdx = Array.from({ length: BH_ARC_BUCKETS }, () => new Int32Array(BH_ARC_TOTAL));
const bhArcN = new Int32Array(BH_ARC_BUCKETS);
const bhArcXYR = new Float32Array(BH_ARC_TOTAL * 3);

function bhUpdateDisk(t, dt, hx, hy, rs) {
  const spin = 0.6 + sound.level * 1.2 + sound.kick * 0.8;
  const cT = Math.cos(BH_TILT), sT = Math.sin(BH_TILT);
  bhDiskN[0].fill(0);
  bhDiskN[1].fill(0);
  for (let idx = 0; idx < bhDisk.length; idx++) {
    const p = bhDisk[idx];
    p.a += 0.95 * Math.pow(1.5 / p.r, 1.5) * spin * dt;
    const rr = p.r * rs * (1 + 0.008 * Math.sin(t * 2 + p.ph));
    const px = Math.cos(p.a) * rr;
    const py = Math.sin(p.a) * rr * BH_DISK_FLAT;
    p.x = bhSnap(hx + px * cT - py * sT);
    p.y = bhSnap(hy + px * sT + py * cT);
    // 左側（朝向我們轉過來的那邊）比較亮，右側暗；內圈亮、外圈暗
    const doppler = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(p.a));
    const radial = 1 - (p.r - 1.5) / 2.6;
    const al = clamp(0.85 * doppler * (0.4 + 0.6 * radial) * (0.7 + sound.level * 0.3 + sound.kick * 0.1)
      * (0.75 + 0.25 * Math.sin(t * 2.4 + p.ph)), 0, 1);
    p.sz = bhPx(p.s * SC * (0.95 + 0.5 * radial)) / 2; // 這裡存的是半徑
    const bi = Math.min(BH_DISK_BUCKETS - 1, Math.floor(al * BH_DISK_BUCKETS));
    const side = Math.sin(p.a) > 0 ? 1 : 0; // 下半圈在黑洞前面
    bhDiskIdx[side][bi][bhDiskN[side][bi]++] = idx;
  }
}

function bhDrawDiskPass(front, col, hot) {
  const side = front ? 1 : 0;
  for (let b = 0; b < BH_DISK_BUCKETS; b++) {
    const n = bhDiskN[side][b];
    if (!n) continue;
    ctx.fillStyle = b >= 4 ? hot : col;
    ctx.globalAlpha = (b + 0.6) / BH_DISK_BUCKETS;
    ctx.beginPath();
    const list = bhDiskIdx[side][b];
    for (let i = 0; i < n; i++) {
      const p = bhDisk[list[i]];
      ctx.moveTo(p.x + p.sz, p.y);
      ctx.arc(p.x, p.y, p.sz, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function bhDrawArcs(t, dt, hx, hy, rs, col) {
  const cT = Math.cos(BH_TILT), sT = Math.sin(BH_TILT);
  const flow = 0.7 + sound.level * 1.2 + sound.kick * 0.6;
  bhArcN.fill(0);
  let k = 0;
  for (const arc of bhArcs) {
    for (const p of arc.list) {
      p.u += p.v * flow * dt;
      if (p.u > 1) p.u -= 1;
      const ang = arc.from + (arc.to - arc.from) * p.u;
      const rr = arc.r * rs * p.rr;
      const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
      const env = Math.sin(p.u * Math.PI); // 兩端淡出，看起來是一道連續的拱
      const a = clamp(env * (0.3 + sound.level * 0.2) * (0.7 + 0.3 * Math.sin(t * 3 + p.ph)), 0, 1);
      bhArcXYR[k * 3] = bhSnap(hx + px * cT - py * sT);
      bhArcXYR[k * 3 + 1] = bhSnap(hy + px * sT + py * cT);
      bhArcXYR[k * 3 + 2] = bhPx(p.s * SC) / 2;
      const bi = Math.min(BH_ARC_BUCKETS - 1, Math.floor(a * 8));
      bhArcIdx[bi][bhArcN[bi]++] = k;
      k++;
    }
  }
  ctx.fillStyle = col;
  for (let b = 0; b < BH_ARC_BUCKETS; b++) {
    const n = bhArcN[b];
    if (!n) continue;
    ctx.globalAlpha = (b + 0.6) / 8;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const o = bhArcIdx[b][i] * 3;
      ctx.moveTo(bhArcXYR[o] + bhArcXYR[o + 2], bhArcXYR[o + 1]);
      ctx.arc(bhArcXYR[o], bhArcXYR[o + 1], bhArcXYR[o + 2], 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function bhDrawHole(t, dt, hx, hy, rs, ringCol) {
  const level = sound.level, kick = sound.kick;
  const hot = rgba(tint(ringCol, 0.55), 1);
  const col = rgba(ringCol, 1);

  // 視界外的暈光
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(hx, hy, rs * 0.9, hx, hy, rs * 4);
  halo.addColorStop(0, rgba(ringCol, 0.06 + level * 0.03 + kick * 0.02));
  halo.addColorStop(1, rgba(ringCol, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(hx - rs * 4, hy - rs * 4, rs * 8, rs * 8);

  bhUpdateDisk(t, dt, hx, hy, rs);
  bhDrawDiskPass(false, col, hot); // 盤面在黑洞後方的那一半

  // 黑洞本體：蓋住後方的盤面，邊緣略柔
  ctx.globalCompositeOperation = 'source-over';
  const shadow = ctx.createRadialGradient(hx, hy, rs * 0.97, hx, hy, rs * 1.03);
  shadow.addColorStop(0, 'rgba(0,0,0,1)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(hx, hy, rs * 1.03, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  bhDrawDiskPass(true, col, hot);  // 盤面在黑洞前方的那一半
  bhDrawRing(t, dt, hx, hy, rs, ringCol);
  bhDrawArcs(t, dt, hx, hy, rs, col);
  bhDrawSpikes(t, hx, hy, rs, ringCol);
}

function drawBlackHoleScene(t, dt) {
  const flowCol = tint(pal.P, 0.82);                                        // 光絲與公式：偏冷的白
  const ringCol = [lerp(255, pal.A[0], 0.28), lerp(255, pal.A[1], 0.28), lerp(255, pal.A[2], 0.28)]; // 光環：偏暖的白
  bhBuildSprites(flowCol);

  // 聲音大時整體「時間」走得快：流速、下落、光環旋轉一起加快
  // 流速跟著歌曲的整體強度走（mood.energy 是數秒的慢變量，含音量與鼓點密度）：
  // 慢歌約 0.7 倍，快歌約 1.1 倍。再疊上瞬間的音量與鼓點，所以重拍仍然會推一下。
  const tempo = 0.55 + 0.55 * clamp(mood.energy, 0, 1);
  bhTokenSpeed = 0.55 + 0.25 * clamp(mood.energy, 0, 1); // 公式比光絲再慢一些，慢歌時約 0.6、快歌約 0.8
  const simDt = dt * tempo * (1 + sound.level * 1.0 + sound.kick * 1.1);
  const hx = CX + BH_HX * R, hy = CY + BH_HY * R;
  bhRsLive = BH_RS * (1 + sound.bass * 0.05 + sound.kick * 0.06); // 內圈只做很輕微的呼吸，避免眼花
  const rs = R * bhRsLive;

  ctx.globalCompositeOperation = 'lighter';
  bhStreakPass(simDt, flowCol);
  bhTokenPass(simDt);
  bhDrawHole(t, simDt, hx, hy, rs, ringCol);
}
