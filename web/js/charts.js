// Lightweight canvas time-series charts sharing one time window and a playback cursor.
import { F, FRAME_SIZE } from './sim-host.js';

export class ChartGroup {
  constructor(container, onSeek) {
    this.container = container;
    this.onSeek = onSeek;
    this.charts = [];
    this.data = null;
    this.count = 0;
    this.t0 = 0;
    this.t1 = 10000;
    this.auto = true;
    this.cursor = 0;
    this.lines = [];
    this.overlays = {};
    new ResizeObserver(() => this.draw()).observe(container);
  }

  add(def) {
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    const title = document.createElement('div');
    title.className = 'chart-title';
    title.innerHTML = `<b>${def.title}</b>` + def.series.map((s) => `<span class="lg" style="--c:${s.color}">${s.label}</span>`).join('');
    const canvas = document.createElement('canvas');
    wrap.append(title, canvas);
    this.container.appendChild(wrap);
    const chart = { ...def, canvas, wrap };
    this.charts.push(chart);
    this.bind(chart);
    return chart;
  }

  bind(chart) {
    const c = chart.canvas;
    let drag = null;
    const tAt = (ev) => {
      const r = c.getBoundingClientRect();
      const x = Math.min(Math.max(ev.clientX - r.left - 46, 0), r.width - 54);
      return this.t0 + (x / (r.width - 54)) * (this.t1 - this.t0);
    };
    c.addEventListener('mousedown', (ev) => { drag = { x: ev.clientX, t0: this.t0, t1: this.t1, moved: false }; });
    window.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const r = c.getBoundingClientRect();
      const dx = ev.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) {
        const dt = (-dx / (r.width - 54)) * (drag.t1 - drag.t0);
        this.auto = false;
        this.setWindow(drag.t0 + dt, drag.t1 + dt);
      }
    });
    window.addEventListener('mouseup', (ev) => {
      if (drag && !drag.moved && ev.target === c) this.onSeek && this.onSeek(tAt(ev));
      drag = null;
    });
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const t = tAt(ev);
      const k = ev.deltaY > 0 ? 1.25 : 0.8;
      this.auto = false;
      this.setWindow(t - (t - this.t0) * k, t + (this.t1 - t) * k);
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.auto = true; this.fit(); });
  }

  setData(data, count) { this.data = data; this.count = count; if (this.auto) this.fit(); this.draw(); }
  setLines(lines) { this.lines = lines; }
  setOverlay(key, pts) { this.overlays[key] = pts; this.draw(); }
  fit() {
    const end = this.count ? this.data[(this.count - 1) * FRAME_SIZE + F.t] : 10000;
    this.t0 = 0;
    this.t1 = Math.max(1000, end);
  }
  setWindow(t0, t1) {
    if (t1 - t0 < 20) return;
    this.t0 = t0; this.t1 = t1;
    this.draw();
  }
  zoomAround(t, span) { this.auto = false; this.setWindow(t - span / 2, t + span / 2); }
  setCursor(t) { this.cursor = t; this.draw(); }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; for (const ch of this.charts) this.drawChart(ch); });
  }

  drawChart(ch) {
    const c = ch.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = 46, R = 8, T = 6, B = 16;
    const pw = W - L - R, ph = H - T - B;
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--muted') || '#888';
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = fg;
    g.strokeStyle = 'rgba(128,128,128,0.25)';
    const data = this.data, n = this.count;
    const t0 = this.t0, t1 = this.t1;
    const xOf = (t) => L + ((t - t0) / (t1 - t0)) * pw;
    // y range
    let ymin = ch.ymin ?? Infinity, ymax = ch.ymax ?? -Infinity;
    const i0 = Math.max(0, this.indexAt(t0) - 1), i1 = Math.min(n - 1, this.indexAt(t1) + 1);
    if (ch.ymin === undefined || ch.ymax === undefined) {
      for (const s of ch.series) {
        for (let i = i0; i <= i1; i++) {
          const v = this.value(s, i);
          if (Number.isFinite(v)) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
        }
        const ov = this.overlays[s.key];
        if (ov) for (const [t, v] of ov) if (t >= t0 && t <= t1) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
      }
      if (ch.bands) for (const b of ch.bands()) { if (b >= ymin - 600 && b <= ymax + 600) { ymin = Math.min(ymin, b); ymax = Math.max(ymax, b); } }
      if (!Number.isFinite(ymin)) { ymin = 0; ymax = 1; }
      if (ymax - ymin < 1e-6) { ymin -= 1; ymax += 1; }
      const pad = (ymax - ymin) * 0.08;
      ymin -= pad; ymax += pad;
    }
    const yOf = (v) => T + ph - ((v - ymin) / (ymax - ymin)) * ph;
    // grid + y labels
    const step = niceStep((ymax - ymin) / 4);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let v = Math.ceil(ymin / step) * step; v <= ymax; v += step) {
      const y = yOf(v);
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      g.fillText(fmt(v), L - 4, y);
    }
    // time labels
    const tstep = niceStep((t1 - t0) / 6);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let t = Math.ceil(t0 / tstep) * tstep; t <= t1; t += tstep) {
      const x = xOf(t);
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
      g.fillText((t / 1000).toFixed(tstep < 1000 ? 2 : 0) + 's', x, T + ph + 3);
    }
    // bands (e.g. line centres)
    if (ch.bands) {
      g.save();
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(30,30,30,0.55)';
      ch.bands().forEach((b, k) => {
        const y = yOf(b);
        if (y < T || y > T + ph) return;
        g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
        g.fillStyle = fg;
        g.textAlign = 'left';
        g.fillText(`라인 ${k}`, L + 3, y - 11);
      });
      g.restore();
    }
    // series (min/max per pixel column)
    g.save();
    g.beginPath(); g.rect(L, T, pw, ph); g.clip();
    for (const s of ch.series) {
      g.strokeStyle = s.color;
      g.lineWidth = s.width || 1.4;
      g.beginPath();
      let started = false;
      if (n && i1 >= i0) {
        const span = i1 - i0 + 1;
        const perPx = span / pw;
        if (perPx <= 2) {
          for (let i = i0; i <= i1; i++) {
            const v = this.value(s, i);
            if (!Number.isFinite(v)) { started = false; continue; }
            const x = xOf(data[i * FRAME_SIZE + F.t]), y = yOf(v);
            if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
          }
        } else {
          for (let px = 0; px < pw; px++) {
            const a = i0 + Math.floor(px * perPx), b = Math.min(i1, i0 + Math.floor((px + 1) * perPx));
            let mn = Infinity, mx = -Infinity;
            for (let i = a; i <= b; i++) { const v = this.value(s, i); if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
            if (!Number.isFinite(mn)) { started = false; continue; }
            const x = L + px;
            if (!started) { g.moveTo(x, yOf(mn)); started = true; } else g.lineTo(x, yOf(mn));
            if (mx !== mn) g.lineTo(x, yOf(mx));
          }
        }
      }
      g.stroke();
      const ov = this.overlays[s.key];
      if (ov && ov.length) {
        g.strokeStyle = s.overlayColor || '#000';
        g.setLineDash([5, 3]);
        g.lineWidth = 1.6;
        g.beginPath();
        ov.forEach(([t, v], k) => { const x = xOf(t), y = yOf(v); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = s.overlayColor || '#000';
        for (const [t, v] of ov) { g.beginPath(); g.arc(xOf(t), yOf(v), 2.2, 0, 7); g.fill(); }
      }
    }
    g.restore();
    // cursor
    const cx = xOf(this.cursor);
    if (cx >= L && cx <= W - R) {
      g.strokeStyle = '#e8590c';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx, T); g.lineTo(cx, T + ph); g.stroke();
    }
  }

  value(s, i) {
    const base = i * FRAME_SIZE;
    if (s.fn) return s.fn(this.data, base);
    return this.data[base + F[s.key]];
  }

  indexAt(t) {
    const n = this.count;
    if (!n) return 0;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid * FRAME_SIZE + F.t] < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function fmt(v) {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
