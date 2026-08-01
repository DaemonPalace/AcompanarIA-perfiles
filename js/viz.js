/* Visualizaciones en canvas: histograma, barras categóricas, mapa de calor de
   correlaciones y dispersión. Paleta y tokens siguen la guía de diseño de datos
   (light/dark-aware vía variables CSS en :root). Sin dependencias externas. */

function vizColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
  return {
    surface: get("--surface-1", "#fcfcfb"),
    textPrimary: get("--text-primary", "#0b0b0b"),
    textSecondary: get("--text-secondary", "#52514e"),
    muted: get("--muted", "#898781"),
    grid: get("--grid", "#e1e0d9"),
    baseline: get("--baseline", "#c3c2b7"),
    series1: get("--series-1", "#2a78d6"),
    series2: get("--series-2", "#eb6834"),
    series3: get("--series-3", "#1baf7a"),
    divPos: get("--div-pos", "#2a78d6"),
    divNeg: get("--div-neg", "#e34948"),
    divMid: get("--div-mid", "#f0efec")
  };
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 120);
  const h = Math.max(rect.height, 120);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function ensureTooltip(container) {
  let tip = container.querySelector(".viz-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "viz-tooltip";
    container.style.position = "relative";
    container.appendChild(tip);
  }
  return tip;
}

function drawHistogram(canvas, values, opts) {
  const c = vizColors();
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 34, padB = 20, padT = 10, padR = 8;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const min = opts.min, max = opts.max;
  const bins = 16;
  const counts = new Array(bins).fill(0);
  const binW = (max - min) / bins || 1;
  for (const v of values) {
    let idx = Math.floor((v - min) / binW);
    idx = Math.max(0, Math.min(bins - 1, idx));
    counts[idx]++;
  }
  const maxCount = Math.max(1, ...counts);

  ctx.strokeStyle = c.baseline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  const gap = 2;
  const barW = plotW / bins;
  ctx.fillStyle = c.series1;
  for (let i = 0; i < bins; i++) {
    const bh = (counts[i] / maxCount) * (plotH - 4);
    const x = padL + i * barW + gap / 2;
    const y = padT + plotH - bh;
    const bw = Math.max(1, barW - gap);
    ctx.beginPath();
    const r = Math.min(3, bw / 2, bh);
    if (bh > 0) {
      ctx.moveTo(x, y + bh);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.lineTo(x + bw - r, y);
      ctx.arcTo(x + bw, y, x + bw, y + r, r);
      ctx.lineTo(x + bw, y + bh);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.fillStyle = c.muted;
  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(min)), padL - 4, padT + plotH);
  ctx.fillText(String(Math.round(max)), padL - 4, padT + 4);
  ctx.textAlign = "center";
  ctx.fillText(String(Math.round(min)), padL, padT + plotH + 12);
  ctx.fillText(String(Math.round(max)), padL + plotW, padT + plotH + 12);

  // tooltip interactivo
  const container = canvas.parentElement;
  const tip = ensureTooltip(container);
  canvas.onmousemove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    if (x < padL || x > padL + plotW) { tip.style.display = "none"; return; }
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((x - padL) / barW)));
    const lo = (min + idx * binW).toFixed(1);
    const hi = (min + (idx + 1) * binW).toFixed(1);
    tip.style.display = "block";
    tip.style.left = `${x + 8}px`;
    tip.style.top = `${ev.clientY - rect.top - 8}px`;
    tip.textContent = `${lo}–${hi}: ${counts[idx]} perfiles`;
  };
  canvas.onmouseleave = () => { tip.style.display = "none"; };
}

function drawBarChart(canvas, categories, weights) {
  const c = vizColors();
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 8, padR = 8, padT = 8, padB = 8;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const rowH = plotH / categories.length;
  const maxW = Math.max(...weights, 1);

  ctx.font = "11px system-ui, -apple-system, sans-serif";
  categories.forEach((cat, i) => {
    const y = padT + i * rowH;
    const barMaxW = plotW * 0.55;
    const bw = (weights[i] / maxW) * barMaxW;
    ctx.fillStyle = c.series1;
    const bh = Math.max(6, rowH - 6);
    const by = y + (rowH - bh) / 2;
    ctx.beginPath();
    const r = Math.min(3, bh / 2);
    ctx.moveTo(padL, by + bh);
    ctx.lineTo(padL, by + r);
    ctx.arcTo(padL, by, padL + r, by, r);
    ctx.lineTo(padL + Math.max(bw, r), by);
    ctx.arcTo(padL + bw, by, padL + bw, by + r, r);
    ctx.lineTo(padL + bw, by + bh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.textSecondary;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const pct = ((weights[i] / total) * 100).toFixed(0);
    ctx.fillText(`${cat} — ${pct}%`, padL + barMaxW + 8, y + rowH / 2);
  });
}

function corrToColor(r, c) {
  const t = Math.max(-1, Math.min(1, r));
  const mix = (hexA, hexB, f) => {
    const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
    const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
    const m = a.map((v, i) => Math.round(v + (b[i] - v) * f));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  };
  if (t >= 0) return mix(c.divMid, c.divPos, t);
  return mix(c.divMid, c.divNeg, -t);
}

function drawHeatmap(canvas, matrix, labels, opts) {
  const c = vizColors();
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const n = labels.length;
  const labelW = opts && opts.labelWidth ? opts.labelWidth : 120;
  const plotSize = Math.min(w - labelW - 8, h - labelW - 8);
  const cell = n > 0 ? plotSize / n : 0;
  const originX = labelW, originY = labelW;

  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = c.textSecondary;
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateLabel(labels[i], 20), originX - 6, originY + i * cell + cell / 2);
    ctx.restore();

    ctx.save();
    ctx.translate(originX + i * cell + cell / 2, originY - 6);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateLabel(labels[i], 20), 0, 0);
    ctx.restore();
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = matrix[i][j];
      ctx.fillStyle = corrToColor(r, c);
      const x = originX + j * cell, y = originY + i * cell;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      if (cell > 26) {
        ctx.fillStyle = Math.abs(r) > 0.55 ? "#ffffff" : c.textPrimary;
        ctx.font = "9px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(r.toFixed(2), x + cell / 2, y + cell / 2);
      }
    }
  }
  ctx.strokeStyle = c.grid;
  ctx.strokeRect(originX, originY, cell * n, cell * n);

  const container = canvas.parentElement;
  const tip = ensureTooltip(container);
  const hitTest = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - originX;
    const y = clientY - rect.top - originY;
    if (x < 0 || y < 0 || x > cell * n || y > cell * n) return null;
    const j = Math.floor(x / cell), i = Math.floor(y / cell);
    if (i < 0 || i >= n || j < 0 || j >= n) return null;
    return { i, j };
  };
  canvas.onmousemove = (ev) => {
    const hit = hitTest(ev.clientX, ev.clientY);
    if (!hit) { tip.style.display = "none"; return; }
    const rect = canvas.getBoundingClientRect();
    tip.style.display = "block";
    tip.style.left = `${ev.clientX - rect.left + 10}px`;
    tip.style.top = `${ev.clientY - rect.top - 8}px`;
    const meta = opts && opts.metaLookup ? opts.metaLookup(labels[hit.i], labels[hit.j]) : "";
    tip.textContent = `${labels[hit.i]} × ${labels[hit.j]}: r=${matrix[hit.i][hit.j].toFixed(2)}${meta ? " — " + meta : ""}`;
  };
  canvas.onmouseleave = () => { tip.style.display = "none"; };
  canvas.onclick = (ev) => {
    const hit = hitTest(ev.clientX, ev.clientY);
    if (hit && opts && opts.onCellClick) opts.onCellClick(hit.i, hit.j);
  };
}

function truncateLabel(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function drawScatter(canvas, xs, ys, groups, opts) {
  const c = vizColors();
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 46, padB = 30, padT = 12, padR = 12;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xMin = opts.xMin, xMax = opts.xMax, yMin = opts.yMin, yMax = opts.yMax;
  const sx = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (v) => padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = padT + (g / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }
  ctx.strokeStyle = c.baseline;
  ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Máximo 3 categorías con color propio (único conjunto que valida todos los
  // pares CVD simultáneamente); el resto se agrupa en "Otros" en gris neutro.
  const palette = [c.series1, c.series2, c.series3];
  let groupKeys = null, otherLabel = "Otros";
  if (groups) {
    const freq = {};
    groups.forEach((g) => { freq[g] = (freq[g] || 0) + 1; });
    const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    groupKeys = sorted.slice(0, 3);
    if (sorted.length > 3) groupKeys.push(otherLabel);
    groups = groups.map((g) => (groupKeys.slice(0, 3).includes(g) ? g : otherLabel));
  } else {
    groupKeys = [null];
  }
  const colorFor = (g) => (g === null ? c.series1 : (g === otherLabel ? c.muted : palette[groupKeys.indexOf(g) % palette.length]));

  const pts = [];
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < xs.length; i++) {
    const px = sx(xs[i]), py = sy(ys[i]);
    const g = groups ? groups[i] : null;
    ctx.fillStyle = colorFor(g);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    pts.push([px, py]);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = c.muted;
  ctx.font = "10px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(opts.xLabel || "", padL + plotW / 2, h - 4);
  ctx.save();
  ctx.translate(12, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(opts.yLabel || "", 0, 0);
  ctx.restore();

  if (groups && groupKeys.length > 1 && groupKeys.length <= 6) {
    let lx = padL + 6, ly = padT + 6;
    groupKeys.forEach((g) => {
      ctx.fillStyle = colorFor(g);
      ctx.fillRect(lx, ly, 8, 8);
      ctx.fillStyle = c.textSecondary;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(g), lx + 12, ly + 4);
      lx += ctx.measureText(String(g)).width + 30;
    });
  }

  const container = canvas.parentElement;
  const tip = ensureTooltip(container);
  canvas.onmousemove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let best = -1, bestD = 64;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i][0] - mx) ** 2 + (pts[i][1] - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best === -1) { tip.style.display = "none"; return; }
    tip.style.display = "block";
    tip.style.left = `${mx + 10}px`;
    tip.style.top = `${my - 8}px`;
    tip.textContent = `${opts.xLabel}: ${xs[best].toFixed(1)} · ${opts.yLabel}: ${ys[best].toFixed(1)}${groups ? " · " + groups[best] : ""}`;
  };
  canvas.onmouseleave = () => { tip.style.display = "none"; };
}

window.VIZ = { drawHistogram, drawBarChart, drawHeatmap, drawScatter, vizColors };
