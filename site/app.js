/* =========================================================
   李杜诗心 · 交互与可视化
   纯 Canvas 绘制，无外部依赖
   ========================================================= */
(function () {
  "use strict";

  const L = window.LIDU;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- 主题与颜色 ---------------- */
  const state = {
    theme: localStorage.getItem("lidu-theme") || "paper",
    view: "overview",
    threshold: 7000,
    net: { size: 60, labels: true, edgeWeight: false },
    search: { q: "", scope: "both", min: 7000, sort: "sim", page: 1 },
    selected: null,
  };

  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    return {
      paper: get("--paper"),
      card: get("--card"),
      cardSoft: get("--card-soft"),
      ink: get("--ink"),
      ink2: get("--ink-2"),
      ink3: get("--ink-3"),
      ink4: get("--ink-4"),
      line: get("--line"),
      lineSoft: get("--line-soft"),
      gold: get("--gold"),
      goldBright: get("--gold-bright"),
      jade: get("--jade"),
      jadeBright: get("--jade-bright"),
      rust: get("--rust"),
    };
  }

  function hexA(hex, alpha) {
    /* #rrggbb + alpha → rgba() */
    const h = hex.replace("#", "");
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(v, 16);
    if (Number.isNaN(n)) return hex;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function applyTheme(t) {
    state.theme = t;
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("lidu-theme", t);
    $$(".theme-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.theme === t));
    charts.forEach((fn) => fn());
    if (state.view === "network") network.redraw();
    hero.draw();
  }

  /* ---------------- 数字与文本 ---------------- */
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const fmtShort = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(n)));
  const pct = (x) => (x * 100).toFixed(x > 0.99 ? 1 : 1) + "%";
  const score = (s) => (s / 100).toFixed(1);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function emphasize(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const chars = Array.from(new Set(Array.from(q))).filter((c) => /[\u3000-\u9fff\w]/.test(c));
    if (!chars.length) return safe;
    return safe.replace(new RegExp("(" + chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g"), "<mark>$1</mark>");
  }

  /* ---------------- 画布基础 ---------------- */
  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  /* ---------------- 悬浮提示 ---------------- */
  const tipEl = document.createElement("div");
  tipEl.className = "chart-tip";
  document.body.appendChild(tipEl);

  function tooltip(x, y, html) {
    tipEl.innerHTML = html;
    tipEl.classList.add("show");
    const r = tipEl.getBoundingClientRect();
    let left = x + 16;
    let top = y + 16;
    if (left + r.width > window.innerWidth - 12) left = x - r.width - 16;
    if (top + r.height > window.innerHeight - 12) top = y - r.height - 16;
    tipEl.style.left = left + "px";
    tipEl.style.top = top + "px";
  }
  function hideTooltip() {
    tipEl.classList.remove("show");
  }

  /* 图表注册：主题变化时重绘 */
  const charts = [];
  const register = (fn) => charts.push(fn);

  /* =========================================================
     总览 · 主视觉：两条诗卷与它们之间的连线
     ========================================================= */
  const hero = {
    canvas: $("#heroCanvas"),
    nodes: null,
    build() {
      const m = L.meta;
      /* 左条 = 李白按 pid 排序的诗；右条 = 杜甫 */
      const lbt = L.lb.map((p, i) => ({ p, t: i / Math.max(1, L.lb.length - 1), side: "lb" }));
      const dft = L.df.map((p, i) => ({ p, t: i / Math.max(1, L.df.length - 1), side: "df" }));
      this.nodes = { lbt, dft };
      /* 取边权最大的若干条连线做示意 */
      const top = L.edges.slice().sort((a, b) => b.n - a.n).slice(0, 64);
      this.links = top.map((e) => ({
        a: lbt[e.lp],
        b: dft[e.dp],
        n: e.n,
      }));
    },
    draw() {
      if (!this.canvas) return;
      if (!this.nodes) this.build();
      const { ctx, w, h } = setupCanvas(this.canvas);
      const C = colors();
      ctx.clearRect(0, 0, w, h);
      const padX = 6;
      const topY = 18;
      const botY = h - 22;
      const H = botY - topY;

      const bw = Math.min(26, w * 0.058);
      const leftX = padX;
      const rightX = w - padX - bw;

      /* 底纹：两列刻度 */
      ctx.strokeStyle = hexA(C.ink, 0.06);
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const y = topY + (H / 8) * i;
        ctx.beginPath();
        ctx.moveTo(leftX - 6, y);
        ctx.lineTo(leftX, y);
        ctx.moveTo(rightX + bw, y);
        ctx.lineTo(rightX + bw + 6, y);
        ctx.stroke();
      }

      /* 诗卷底条 */
      const drawStrip = (x, nodes, color) => {
        nodes.forEach((n) => {
          const y = topY + n.t * H;
          const intensity = n.p.pairs ? 0.1 + 0.9 * clamp(n.p.pairs / 120, 0, 1) : 0.07;
          ctx.fillStyle = n.p.pairs ? hexA(color, 0.18 + intensity * 0.55) : hexA(C.ink, 0.05);
          const hh = Math.max(1.1, (H / nodes.length) * 1.5);
          ctx.fillRect(x, y, bw, hh);
        });
        ctx.strokeStyle = hexA(C.ink, 0.14);
        ctx.strokeRect(x + 0.5, topY + 0.5, bw - 1, H - 1);
      };
      drawStrip(leftX, this.nodes.lbt, C.gold);
      drawStrip(rightX, this.nodes.dft, C.jade);

      /* 连线 */
      const cx1 = leftX + bw;
      const cx2 = rightX;
      this.links.forEach((lk) => {
        const y1 = topY + lk.a.t * H;
        const y2 = topY + lk.b.t * H;
        const alpha = 0.05 + 0.3 * clamp(lk.n / 300, 0, 1);
        const grad = ctx.createLinearGradient(cx1, 0, cx2, 0);
        grad.addColorStop(0, hexA(C.gold, alpha * 1.35));
        grad.addColorStop(1, hexA(C.jade, alpha * 1.35));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.55 + Math.min(2.2, lk.n / 70);
        ctx.beginPath();
        const midX = (cx1 + cx2) / 2;
        ctx.moveTo(cx1, y1);
        ctx.bezierCurveTo(midX, y1, midX, y2, cx2, y2);
        ctx.stroke();
      });

      /* 两端标注 */
      ctx.fillStyle = hexA(C.gold, 0.9);
      ctx.beginPath();
      ctx.arc(leftX + bw / 2, topY - 9, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexA(C.jade, 0.9);
      ctx.beginPath();
      ctx.arc(rightX + bw / 2, topY - 9, 2.2, 0, Math.PI * 2);
      ctx.fill();
    },
  };
  register(() => hero.draw());

  /* =========================================================
     KPI
     ========================================================= */
  function renderKpi() {
    const m = L.meta;
    const el = $("#kpiRow");
    const items = [
      {
        label: "诗句配对",
        val: fmt(m.pairs),
        sub: `覆盖 ${fmt(m.lb_poems_paired)} 首李诗 · ${fmt(m.df_poems_paired)} 首杜诗`,
        cls: "accent-gold",
      },
      {
        label: "平均相似度",
        val: score(m.sim_mean),
        unit: "/ 100",
        sub: `中位数 ${score(m.sim_median)} · 前 1% 门槛 ${score(m.sim_p99)}`,
        cls: "",
      },
      {
        label: "李白的诗",
        val: fmt(m.lb_poems), unit: "首",
        sub: `${fmt(m.lb_lines_total)} 行 · ${fmt(m.lb_chars_total)} 字`,
        cls: "accent-gold",
      },
      {
        label: "杜甫的诗",
        val: fmt(m.df_poems), unit: "首",
        sub: `${fmt(m.df_lines_total)} 行 · ${fmt(m.df_chars_total)} 字`,
        cls: "accent-jade",
      },
    ];
    el.innerHTML = items
      .map(
        (k) => `
      <div class="kpi ${k.cls}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val">${k.val}${k.unit ? `<small>${k.unit}</small>` : ""}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>`
      )
      .join("");
  }

  /* =========================================================
     总览 · 直方图
     ========================================================= */
  function drawHistogram(canvas, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    const C = colors();
    const data = L.hist;
    const pad = { l: 46, r: 14, t: 18, b: 34 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const maxV = Math.max(...data.map((d) => d[1]));
    const bins = data.length;
    const bw = iw / bins;
    const tickStep = maxV / 3;

    ctx.clearRect(0, 0, w, h);

    /* 网格 */
    ctx.strokeStyle = hexA(C.ink, 0.07);
    ctx.lineWidth = 1;
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = C.ink4;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (maxV / steps) * i;
      const y = pad.t + ih - (v / maxV) * ih;
      ctx.beginPath();
      ctx.moveTo(pad.l, y + 0.5);
      ctx.lineTo(w - pad.r, y + 0.5);
      ctx.stroke();
      ctx.fillText(i === steps ? String(Math.round(v)) : fmtShort(v), pad.l - 9, y);
    }

    /* 柱 */
    const th = state.threshold;
    data.forEach(([bin, v], i) => {
      const x = pad.l + i * bw;
      const bh = (v / maxV) * ih;
      const active = bin + 100 > th;
      ctx.fillStyle = active ? hexA(C.gold, 0.75) : hexA(C.ink, 0.13);
      ctx.fillRect(x + 0.8, pad.t + ih - bh, Math.max(1, bw - 1.6), bh);
      if (active && i < bins - 1) {
        /* 柱顶细线，帮助读高度 */
        ctx.fillStyle = hexA(C.goldBright, 0.9);
        ctx.fillRect(x + 0.8, pad.t + ih - bh, Math.max(1, bw - 1.6), 1.2);
      }
    });

    /* 阈值线 */
    if (th > 7000) {
      const x = pad.l + ((th - 7000) / 3000) * iw;
      ctx.strokeStyle = C.rust;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.t - 4);
      ctx.lineTo(x, pad.t + ih);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.rust;
      ctx.font = '10px "Inter", "PingFang SC", sans-serif';
      ctx.textAlign = x > w - 60 ? "right" : "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("阈值 " + th, x + (x > w - 60 ? -5 : 5), pad.t - 2);
    }

    /* 轴 */
    ctx.strokeStyle = hexA(C.ink, 0.2);
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ih + 0.5);
    ctx.lineTo(w - pad.r, pad.t + ih + 0.5);
    ctx.stroke();

    ctx.fillStyle = C.ink4;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    [70, 75, 80, 85, 90, 95, 100].forEach((v) => {
      const x = pad.l + ((v * 100 - 7000) / 3000) * iw;
      ctx.fillText(v, x, pad.t + ih + 8);
    });
    ctx.textAlign = "left";
    ctx.fillText("相似度", pad.l, pad.t + ih + 22);

    /* 悬停 */
    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < pad.l || x > w - pad.r || y < pad.t || y > pad.t + ih) return hideTooltip();
      const i = clamp(Math.floor((x - pad.l) / bw), 0, bins - 1);
      const [bin, v] = data[i];
      tooltip(e.clientX, e.clientY, `<b>${bin}–${bin + 99}</b><br>${fmt(v)} 组配对<span class="tip-dim">占 ${((v / L.N) * 100).toFixed(1)}%</span>`);
    };
    canvas.onmouseleave = hideTooltip;
  }
  register(() => {
    const c = $("#histCanvas");
    if (c) drawHistogram(c);
  });

  /* =========================================================
     总览 · 阅读线索
     ========================================================= */
  function renderFindings() {
    const m = L.meta;
    const lbMax = L.lb.slice().sort((a, b) => b.pairs - a.pairs)[0];
    const dfMax = L.df.slice().sort((a, b) => b.pairs - a.pairs)[0];
    const deep = L.pairs.filter((p) => p.s >= m.sim_p99).length;
    const cover = (m.lb_poems_paired / m.lb_poems) * 100;
    const coverD = (m.df_poems_paired / m.df_poems) * 100;
    const topChar = L.chars[0];
    const items = [
      `<b>${fmt(m.pairs)}</b> 组配对几乎牵动了两位诗人的全部作品：李白 <em>${cover.toFixed(1)}%</em> 的诗、杜甫 <em>${coverD.toFixed(1)}%</em> 的诗都至少有一句被配上。这不是抽样，而是一次近乎全集的互文检索。`,
      `被匹配最多的是李白的长篇 <b>《${escapeHtml(lbMax.title)}》</b>（<em>${lbMax.pairs}</em> 组），对面则是杜甫的 <b>《${escapeHtml(dfMax.title)}》</b>（<em>${dfMax.pairs}</em> 组）。组诗与长篇，天然有更多句子可被比对。`,
      `相似度中位数 <em>${score(m.sim_median)}</em>，只有 <b>${fmt(deep)}</b> 组越过 <em>${score(m.sim_p99)}</em> 的前 1% 门槛。绝大多数配对是“远亲”，而非“同句”。`,
      `共同出现最多的字是 <b>「${topChar.ch}」</b>，出现在 <em>${fmt(topChar.pairs)}</em> 组配对中；其后是「${L.chars[1].ch}」「${L.chars[2].ch}」「${L.chars[3].ch}」。风、酒、山、水、月——这些意象构成了两人共享的语汇底色。`,
    ];
    $("#findingList").innerHTML = items
      .map((t, i) => `<li><span class="f-num">0${i + 1}</span><div>${t}</div></li>`)
      .join("");
  }

  /* =========================================================
     总览 · 最相似诗句
     ========================================================= */
  function renderTwins() {
    const top = L.bySim.slice(0, 6);
    $("#twinGrid").innerHTML = top
      .map(
        (p) => `
      <article class="twin" data-pair="${p.id}">
        <div class="twin-top">
          <span class="twin-score">${score(p.s)} · ${pct(L.percentileOf(p.s))}</span>
          <span class="twin-src">李白 / 杜甫</span>
        </div>
        <div class="twin-lines">
          <div class="ln lb"><i>李</i>${escapeHtml(p.l1)}</div>
          <div class="ln df"><i>杜</i>${escapeHtml(p.l2)}</div>
        </div>
        <div class="twin-foot">${escapeHtml(p.t1)} · ${escapeHtml(p.t2)}</div>
      </article>`
      )
      .join("");
    $$("#twinGrid .twin").forEach((el) => {
      el.addEventListener("click", () => openPair(+el.dataset.pair));
    });
  }

  /* =========================================================
     相似度页
     ========================================================= */
  function setThreshold(v, opts = {}) {
    state.threshold = +v;
    const range = $("#simRange");
    if (range) {
      range.value = v;
      const f = ((v - 7000) / 2000) * 100;
      range.style.setProperty("--fill", clamp(f, 0, 100) + "%");
    }
    const out = $("#simOut");
    if (out) out.textContent = fmt(v);
    $$("#simPresets button").forEach((b) => b.classList.toggle("is-active", +b.dataset.v === v));

    const filtered = L.pairs.filter((p) => p.s >= state.threshold);
    const m = document.querySelector("#thresholdKpi");
    if (m) {
      const avg = filtered.length ? filtered.reduce((s, p) => s + p.s, 0) / filtered.length : 0;
      m.innerHTML = [
        ["保留配对", fmt(filtered.length), `占全部 ${((filtered.length / L.N) * 100).toFixed(2)}%`, "accent-gold"],
        ["高于门槛的均分", filtered.length ? score(avg) : "—", `门槛 ${score(state.threshold)} 分`, ""],
        ["覆盖杜诗", fmt(new Set(filtered.map((p) => p.p2)).size), "首（当前阈值）", "accent-jade"],
      ]
        .map(
          ([a, b, c, d]) => `<div class="kpi ${d}"><div class="kpi-label">${a}</div><div class="kpi-val">${b}</div><div class="kpi-sub">${c}</div></div>`
        )
        .join("");
    }

    renderSideStats(filtered);
    renderTopPairs(filtered);
    // 重绘分布图（阈值高亮）
    const hc = $("#histCanvas");
    if (hc) drawHistogram(hc);
    const dc = $("#distCanvas");
    if (dc) drawDist(dc);
    if (state.view === "search") runSearch();
  }

  function renderSideStats(filtered) {
    const el = $("#sideStats");
    if (!el) return;
    const lbPoems = new Set(filtered.map((p) => p.p1)).size;
    const dfPoems = new Set(filtered.map((p) => p.p2)).size;
    const avg = filtered.length ? filtered.reduce((s, p) => s + p.s, 0) / filtered.length : 0;
    el.innerHTML = `
      <div class="mini-stat">
        <span class="ms-label">李白一侧</span>
        <b>${fmt(lbPoems)}</b><span class="ms-unit">首诗被牵入</span>
        <div class="ms-bar"><i style="width:${clamp((lbPoems / L.meta.lb_poems) * 100, 0, 100)}%;background:var(--gold)"></i></div>
        <span class="ms-note">占其全部诗作的 ${((lbPoems / L.meta.lb_poems) * 100).toFixed(1)}%</span>
      </div>
      <div class="mini-stat">
        <span class="ms-label">杜甫一侧</span>
        <b>${fmt(dfPoems)}</b><span class="ms-unit">首诗被牵入</span>
        <div class="ms-bar"><i style="width:${clamp((dfPoems / L.meta.df_poems) * 100, 0, 100)}%;background:var(--jade)"></i></div>
        <span class="ms-note">占其全部诗作的 ${((dfPoems / L.meta.df_poems) * 100).toFixed(1)}%</span>
      </div>
      <div class="mini-stat">
        <span class="ms-label">当前门槛均分</span>
        <b>${score(avg)}</b><span class="ms-unit">/ 100</span>
        <span class="ms-note">保留 ${fmt(filtered.length)} 组</span>
      </div>`;
  }

  function renderTopPairs(filtered) {
    const el = $("#topPairs");
    if (!el) return;
    const top = filtered.slice(0, 10);
    el.innerHTML = top
      .map(
        (p, i) => `
      <div class="rank-row" data-pair="${p.id}">
        <span class="n">${String(i + 1).padStart(2, "0")}</span>
        <span class="t">${escapeHtml(p.l1)}<span class="sep">/</span>${escapeHtml(p.l2)}</span>
        <span class="v">${score(p.s)}</span>
      </div>`
      )
      .join("");
    $$("#topPairs .rank-row").forEach((el2) => el2.addEventListener("click", () => openPair(+el2.dataset.pair)));
  }

  /* 分布图（带阈值） */
  function drawDist(canvas) {
    const { ctx, w, h } = setupCanvas(canvas);
    const C = colors();
    const data = L.hist;
    const pad = { l: 44, r: 12, t: 16, b: 30 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const maxV = Math.max(...data.map((d) => d[1]));
    const bins = data.length;
    const bw = iw / bins;
    const tickStep = maxV / 3;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = hexA(C.ink, 0.07);
    ctx.lineWidth = 1;
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = C.ink4;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 3; i++) {
      const v = tickStep * i;
      const y = pad.t + ih - (v / maxV) * ih;
      ctx.beginPath();
      ctx.moveTo(pad.l, y + 0.5);
      ctx.lineTo(w - pad.r, y + 0.5);
      ctx.stroke();
      ctx.fillText(fmtShort(v), pad.l - 8, y);
    }

    data.forEach(([bin, v], i) => {
      const x = pad.l + i * bw;
      const bh = (v / maxV) * ih;
      const active = bin + 100 > state.threshold;
      const grad = ctx.createLinearGradient(0, pad.t + ih - bh, 0, pad.t + ih);
      grad.addColorStop(0, active ? C.gold : hexA(C.ink, 0.24));
      grad.addColorStop(1, active ? hexA(C.gold, 0.2) : hexA(C.ink, 0.06));
      ctx.fillStyle = grad;
      ctx.fillRect(x + 0.6, pad.t + ih - bh, Math.max(1, bw - 1.2), bh);
    });

    if (state.threshold > 7000) {
      const x = pad.l + ((state.threshold - 7000) / 3000) * iw;
      ctx.strokeStyle = C.rust;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.t - 2);
      ctx.lineTo(x, pad.t + ih);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = hexA(C.ink, 0.2);
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ih + 0.5);
    ctx.lineTo(w - pad.r, pad.t + ih + 0.5);
    ctx.stroke();
    ctx.fillStyle = C.ink4;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    [70, 75, 80, 85, 90, 95, 100].forEach((v) => {
      ctx.fillText(v, pad.l + ((v * 100 - 7000) / 3000) * iw, pad.t + ih + 7);
    });

    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (x < pad.l || x > w - pad.r) return hideTooltip();
      const i = clamp(Math.floor((x - pad.l) / bw), 0, bins - 1);
      const [bin, v] = data[i];
      tooltip(e.clientX, e.clientY, `<b>${bin}–${bin + 99}</b><br>${fmt(v)} 组配对<span class="tip-dim">${((v / L.N) * 100).toFixed(1)}%</span>`);
    };
    canvas.onmouseleave = hideTooltip;
  }

  /* 累积曲线 */
  function drawCumulative(canvas) {
    const { ctx, w, h } = setupCanvas(canvas);
    const C = colors();
    const pad = { l: 46, r: 16, t: 30, b: 32 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = hexA(C.ink, 0.07);
    ctx.lineWidth = 1;
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = C.ink4;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ih / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y + 0.5);
      ctx.lineTo(w - pad.r, y + 0.5);
      ctx.stroke();
      ctx.fillText(Math.round(100 - i * 25) + "%", pad.l - 8, y);
    }

    /* 累积：阈值 x 之上保留的比例 */
    const pts = [];
    for (let t = 7000; t <= 10000; t += 25) {
      const cnt = L.pairs.filter((p) => p.s >= t).length;
      pts.push([t, cnt / L.N]);
    }
    const xOf = (t) => pad.l + ((t - 7000) / 3000) * iw;
    const yOf = (v) => pad.t + ih - v * ih;

    /* 面积 */
    const grd = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grd.addColorStop(0, hexA(C.jade, 0.22));
    grd.addColorStop(1, hexA(C.jade, 0.02));
    ctx.beginPath();
    ctx.moveTo(xOf(7000), pad.t + ih);
    pts.forEach(([t, v]) => ctx.lineTo(xOf(t), yOf(v)));
    ctx.lineTo(xOf(10000), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(([t, v], i) => (i ? ctx.lineTo(xOf(t), yOf(v)) : ctx.moveTo(xOf(t), yOf(v))));
    ctx.strokeStyle = C.jade;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    /* 当前阈值点 */
    const cur = L.pairs.filter((p) => p.s >= state.threshold).length / L.N;
    ctx.beginPath();
    ctx.arc(xOf(state.threshold), yOf(cur), 4, 0, Math.PI * 2);
    ctx.fillStyle = C.card;
    ctx.fill();
    ctx.strokeStyle = C.rust;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = C.ink4;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    [70, 80, 90, 100].forEach((v) => ctx.fillText(v, xOf(v * 100), pad.t + ih + 7));

    ctx.textAlign = "left";
    ctx.fillStyle = C.jade;
    ctx.font = '600 11px "Inter", "PingFang SC", sans-serif';
    ctx.fillText(pct(cur) + " 保留", xOf(state.threshold) + 10, yOf(cur) + 14);

    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (x < pad.l || x > w - pad.r) return hideTooltip();
      const t = Math.round(7000 + ((x - pad.l) / iw) * 3000);
      const cnt = L.pairs.filter((p) => p.s >= t).length;
      tooltip(e.clientX, e.clientY, `<b>≥ ${t}</b><br>${fmt(cnt)} 组<span class="tip-dim">${((cnt / L.N) * 100).toFixed(2)}%</span>`);
    };
    canvas.onmouseleave = hideTooltip;
  }

  register(() => {
    const c = $("#distCanvas");
    if (c) drawDist(c);
    const c2 = $("#cumCanvas");
    if (c2) drawCumulative(c2);
  });

  /* =========================================================
     网络：左右两道弧，节点沿弧排开，弦线跨越其间
     ========================================================= */
  const network = {
    canvas: $("#netCanvas"),
    nodes: [],
    links: [],
    view: { x: 0, y: 0, k: 1 },
    dragging: null,
    hover: null,
    raf: null,
    init() {
      if (!this.canvas) return;
      this.build();
      this.bind();
    },
    build() {
      const size = state.net.size === "ALL" ? 9999 : state.net.size;
      const lbRank = L.lb.slice().sort((a, b) => b.pairs - a.pairs).slice(0, size);
      const dfRank = L.df.slice().sort((a, b) => b.pairs - a.pairs).slice(0, size);
      const lbSet = new Set(lbRank.map((p) => p.pid));
      const dfSet = new Set(dfRank.map((p) => p.pid));

      const nodes = [];
      lbRank.forEach((p, i) => nodes.push({ id: "l" + p.pid, p, side: "lb", i }));
      dfRank.forEach((p, i) => nodes.push({ id: "d" + p.pid, p, side: "df", i }));

      const edges = L.edges.filter((e) => lbSet.has(e.lpid) && dfSet.has(e.dpid));
      const map = new Map(nodes.map((n) => [n.id, n]));
      const links = edges
        .map((e) => ({ a: map.get("l" + e.lpid), b: map.get("d" + e.dpid), e }))
        .filter((l) => l.a && l.b);

      nodes.forEach((n) => {
        n.r = 2.2 + Math.sqrt(n.p.pairs || 0) * 1.15;
        n.pinned = false;
      });
      this.nodes = nodes;
      this.links = links;
      this.view = { x: 0, y: 0, k: 1 };
      this.layout();
      this.updateStats();
    },
    /* 两道相对的竖列：李白在左，杜甫在右，节点按配对多少由内向外 */
    layout() {
      const W = this.canvas.clientWidth || 800;

      const lb = this.nodes.filter((n) => n.side === "lb").sort((a, b) => b.p.pairs - a.p.pairs);
      const df = this.nodes.filter((n) => n.side === "df").sort((a, b) => b.p.pairs - a.p.pairs);

      const need = Math.max(lb.length, df.length) * 16 + 90;
      const H = Math.max(560, need);
      this.canvas.parentElement.style.height = H + "px";

      const top = 46;
      const bot = H - 46;
      const place = (arr, x) => {
        const n = arr.length;
        arr.forEach((node, i) => {
          const t = n <= 1 ? 0.5 : i / (n - 1);
          /* 依据配对数做轻微错位，让长诗靠中间 */
          const rank = node.p.pairs ? Math.min(1, node.p.pairs / 160) : 0;
          node.x = x + (1 - rank) * 20;
          node.y = top + t * (bot - top);
          node.pinned = false;
        });
      };
      place(lb, W * 0.21);
      place(df, W * 0.79);

      /* 轻微松弛，避免重叠但不改变整体结构 */
      const all = this.nodes;
      for (let iter = 0; iter < 40; iter++) {
        for (let i = 0; i < all.length; i++) {
          const a = all[i];
          for (let j = i + 1; j < all.length; j++) {
            const b = all[j];
            if (a.side !== b.side) continue;
            const min = a.r + b.r + 3;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d < min && d > 0.001) {
              const push = ((min - d) / d) * 0.5;
              dx *= push;
              dy *= push;
              a.x -= dx;
              a.y -= dy;
              b.x += dx;
              b.y += dy;
            }
          }
        }
      }
      this.redraw();
    },
    updateStats() {
      const hint = $("#netHint");
      if (hint)
        hint.textContent = `已排布 ${this.nodes.filter((n) => n.side === "lb").length} 首李诗 · ${this.nodes.filter((n) => n.side === "df").length} 首杜诗 · ${this.links.length} 条连线`;
    },
    toScreen(x, y) {
      return [x * this.view.k + this.view.x, y * this.view.k + this.view.y];
    },
    toWorld(sx, sy) {
      return [(sx - this.view.x) / this.view.k, (sy - this.view.y) / this.view.k];
    },
    redraw() {
      if (!this.canvas) return;
      const { ctx, w, h } = setupCanvas(this.canvas);
      const C = colors();
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(this.view.x, this.view.y);
      ctx.scale(this.view.k, this.view.k);

      /* 连线：向中心弯曲 */
      const midX = w / 2;
      this.links.forEach((l) => {
        const hi = this.hover && (l.a === this.hover || l.b === this.hover);
        const alpha = hi ? 0.55 : 0.13 + Math.min(0.14, l.e.n / 130);
        ctx.strokeStyle = hi ? hexA(C.goldBright, alpha) : hexA(C.ink, alpha);
        ctx.lineWidth = hi ? 1.3 : state.net.edgeWeight ? 0.4 + Math.min(2, l.e.n / 70) : 0.55;
        ctx.beginPath();
        ctx.moveTo(l.a.x, l.a.y);
        const bend = (midX - (l.a.x + l.b.x) / 2) * 0.22;
        ctx.bezierCurveTo(l.a.x + bend, l.a.y, l.b.x - bend, l.b.y, l.b.x, l.b.y);
        ctx.stroke();
      });

      /* 节点：只给配对最多的一批加标签，避免拥挤 */
      const labelled = new Set(
        this.nodes
          .slice()
          .sort((a, b) => b.p.pairs - a.p.pairs)
          .slice(0, state.net.size === "ALL" ? 18 : 9)
          .map((n) => n.id)
      );
      this.nodes.forEach((n) => {
        const isHover = this.hover === n;
        const isSel = state.selected && state.selected.side === n.side && state.selected.p.pid === n.p.pid;
        const color = n.side === "lb" ? C.gold : C.jade;
        const r = n.r * (isHover || isSel ? 1.25 : 1);
        if (isHover || isSel) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
          ctx.fillStyle = hexA(color, 0.16);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isHover || isSel ? color : hexA(color, 0.82);
        ctx.fill();
        ctx.strokeStyle = hexA(C.card, 0.92);
        ctx.lineWidth = 1;
        ctx.stroke();

        const show = state.net.labels && (labelled.has(n.id) || isHover || isSel);
        if (show) {
          ctx.font = `${isHover || isSel ? 600 : 400} ${11 / this.view.k}px "Noto Serif SC","Songti SC",SimSun,serif`;
          ctx.textAlign = n.side === "lb" ? "right" : "left";
          ctx.textBaseline = "middle";
          const label = n.p.title.length > 11 ? n.p.title.slice(0, 11) + "…" : n.p.title;
          const lx = n.x + (n.side === "lb" ? -(r + 6) : r + 6);
          ctx.fillStyle = hexA(C.ink, isHover || isSel ? 0.95 : 0.62);
          ctx.fillText(label, lx, n.y);
        }
      });
      ctx.restore();
    },
    bind() {
      const c = this.canvas;
      let panning = false;
      let last = null;

      const pick = (sx, sy) => {
        const [wx, wy] = this.toWorld(sx, sy);
        let best = null;
        let bd = 18 / this.view.k;
        for (const n of this.nodes) {
          const d = Math.hypot(n.x - wx, n.y - wy);
          if (d < Math.max(n.r + 4, bd)) {
            if (!best || d < bd) {
              best = n;
              bd = d;
            }
          }
        }
        return best;
      };

      c.addEventListener("pointerdown", (e) => {
        const r = c.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const n = pick(sx, sy);
        if (n) {
          this.dragging = { node: n, moved: false };
          c.setPointerCapture(e.pointerId);
        } else {
          panning = true;
          last = { x: e.clientX, y: e.clientY };
          c.setPointerCapture(e.pointerId);
        }
      });

      c.addEventListener("pointermove", (e) => {
        const r = c.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        if (this.dragging) {
          const [wx, wy] = this.toWorld(sx, sy);
          this.dragging.node.x = wx;
          this.dragging.node.y = wy;
          this.dragging.moved = true;
          this.redraw();
          return;
        }
        if (panning && last) {
          this.view.x += e.clientX - last.x;
          this.view.y += e.clientY - last.y;
          last = { x: e.clientX, y: e.clientY };
          this.redraw();
          return;
        }
        const n = pick(sx, sy);
        if (n !== this.hover) {
          this.hover = n;
          this.redraw();
          c.style.cursor = n ? "pointer" : "grab";
          if (n) {
            tooltip(e.clientX, e.clientY, `<b>${escapeHtml(n.p.title)}</b><br>${n.side === "lb" ? "李白" : "杜甫"} · ${n.p.pairs} 组配对<span class="tip-dim">点击查看</span>`);
          } else hideTooltip();
        } else if (n) {
          tooltip(e.clientX, e.clientY, `<b>${escapeHtml(n.p.title)}</b><br>${n.side === "lb" ? "李白" : "杜甫"} · ${n.p.pairs} 组配对<span class="tip-dim">点击查看</span>`);
        }
      });

      const up = () => {
        if (this.dragging) {
          if (!this.dragging.moved) selectPoem(this.dragging.node.side, this.dragging.node.p);
          this.dragging = null;
        }
        panning = false;
        last = null;
        hideTooltip();
      };
      c.addEventListener("pointerup", up);
      c.addEventListener("pointercancel", up);
      c.addEventListener("pointerleave", () => {
        this.hover = null;
        hideTooltip();
        this.redraw();
      });
      c.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const r = c.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const k0 = this.view.k;
          const k = clamp(k0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.45, 3.2);
          this.view.x = mx - (mx - this.view.x) * (k / k0);
          this.view.y = my - (my - this.view.y) * (k / k0);
          this.view.k = k;
          this.redraw();
        },
        { passive: false }
      );

      $("#netReset")?.addEventListener("click", () => {
        this.view = { x: 0, y: 0, k: 1 };
        this.redraw();
      });
      $("#netLabels")?.addEventListener("change", (e) => {
        state.net.labels = e.target.checked;
        this.redraw();
      });
      $("#netEdge")?.addEventListener("change", (e) => {
        state.net.edgeWeight = e.target.checked;
        this.redraw();
      });
      $$("[data-net]").forEach((b) =>
        b.addEventListener("click", () => {
          $$("[data-net]").forEach((x) => x.classList.remove("is-active"));
          b.classList.add("is-active");
          state.net.size = b.dataset.net === "ALL" ? "ALL" : +b.dataset.net;
          this.build();
        })
      );
    },
  };

  function selectPoem(side, p) {
    state.selected = { side, p };
    const C = colors();
    network.redraw();
    const panel = $("#netDetail");
    const pairs = side === "lb" ? L.pairsByLpid.get(p.pid) || [] : L.pairsByDpid.get(p.pid) || [];
    const tops = pairs.slice(0, 8);
    const otherTitle = (x) => (side === "lb" ? L.dfByPid.get(x.p2).title : L.lbByPid.get(x.p1).title);
    panel.innerHTML = `
      <div class="detail-poet ${side}">${side === "lb" ? "李白" : "杜甫"}</div>
      <h3 class="detail-title">${escapeHtml(p.title)}</h3>
      <div class="detail-stats">
        <div class="detail-stat"><span>配对条目</span><b>${p.pairs}</b></div>
        <div class="detail-stat"><span>配对诗作</span><b>${p.degree}</b></div>
        <div class="detail-stat"><span>平均相似度</span><b>${p.avg ? score(p.avg) : "—"}</b></div>
        <div class="detail-stat"><span>最高相似度</span><b>${p.max ? score(p.max) : "—"}</b></div>
      </div>
      <div class="detail-label">配对对象 · 前 ${tops.length}</div>
      ${tops
        .map(
          (x) => `
        <button class="detail-link" data-pair="${x.id}">
          <span class="t">${escapeHtml(otherTitle(x))}</span>
          <span class="m">${score(x.s)} · 第 ${side === "lb" ? x.i2 + 1 : x.i1 + 1} 句</span>
        </button>`
        )
        .join("")}
      <button class="detail-btn" data-poem="${side}:${p.pid}">查看全诗与配对</button>`;
    $$("#netDetail .detail-link").forEach((el) => el.addEventListener("click", () => openPair(+el.dataset.pair)));
    $("#netDetail .detail-btn").addEventListener("click", () => openPoem(side, p.pid));
  }

  function renderPoemRank() {
    const cols = [
      { side: "lb", list: L.lb.slice().sort((a, b) => b.pairs - a.pairs).slice(0, 10), cls: "lb" },
      { side: "df", list: L.df.slice().sort((a, b) => b.pairs - a.pairs).slice(0, 10), cls: "df" },
    ];
    $("#poemRank").innerHTML = cols
      .map(
        (c) => `
      <div>
        <div class="rank-head"><b>${c.side === "lb" ? "李白" : "杜甫"}</b><span>配对条目最多的诗作</span></div>
        ${c.list
          .map(
            (p, i) => `
          <div class="rank-row" data-poem="${c.side}:${p.pid}">
            <span class="n">${String(i + 1).padStart(2, "0")}</span>
            <span class="t">${escapeHtml(p.title)}</span>
            <span class="v">${p.pairs}</span>
          </div>`
          )
          .join("")}
      </div>`
      )
      .join("");
    $$("#poemRank .rank-row").forEach((el) =>
      el.addEventListener("click", () => {
        const [s, pid] = el.dataset.poem.split(":");
        openPoem(s, +pid);
      })
    );
  }

  /* =========================================================
     对照页 · 位置散点
     ========================================================= */
  function drawScatter(canvas) {
    const { ctx, w, h } = setupCanvas(canvas);
    const C = colors();
    const pad = { l: 52, r: 18, t: 20, b: 46 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    ctx.clearRect(0, 0, w, h);

    const maxPos = 60;
    const xOf = (i) => pad.l + (Math.min(i, maxPos - 1) / (maxPos - 1)) * iw;
    const yOf = (i) => pad.t + ih - (Math.min(i, maxPos - 1) / (maxPos - 1)) * ih;

    ctx.strokeStyle = hexA(C.ink, 0.06);
    ctx.lineWidth = 1;
    for (let i = 0; i < maxPos; i += 5) {
      const x = xOf(i);
      const y = yOf(i);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ih);
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + iw, y);
      ctx.stroke();
    }

    /* 以 5 句为刻度绘制浅色刻度线 */
    ctx.strokeStyle = hexA(C.ink, 0.12);
    ctx.beginPath();
    for (let i = 0; i < maxPos; i += 5) {
      ctx.moveTo(xOf(i) + 0.5, pad.t + ih);
      ctx.lineTo(xOf(i) + 0.5, pad.t + ih + 4);
      ctx.moveTo(pad.l, yOf(i) + 0.5);
      ctx.lineTo(pad.l - 4, yOf(i) + 0.5);
    }
    ctx.stroke();

    L.pairs.forEach((p) => {
      const x = xOf(p.i1);
      const y = yOf(p.i2);
      const t = clamp((p.s - 7000) / 3000, 0, 1);
      ctx.fillStyle = hexA(C.gold, 0.09 + t * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, 0.85 + t * 2.1, 0, Math.PI * 2);
      ctx.fill();
    });

    /* 轴 */
    ctx.strokeStyle = hexA(C.ink, 0.22);
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ih + 0.5);
    ctx.lineTo(pad.l + iw, pad.t + ih + 0.5);
    ctx.moveTo(pad.l + 0.5, pad.t);
    ctx.lineTo(pad.l + 0.5, pad.t + ih);
    ctx.stroke();

    ctx.fillStyle = C.ink4;
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < maxPos; i += 10) ctx.fillText(String(i + 1), xOf(i), pad.t + ih + 8);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i < maxPos; i += 10) ctx.fillText(String(i + 1), pad.l - 8, yOf(i));

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = C.ink3;
    ctx.font = '11px "Noto Serif SC","Songti SC",serif';
    ctx.fillText("李白诗中的句序", pad.l + iw / 2, h - 6);
    ctx.save();
    ctx.translate(13, pad.t + ih / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("杜甫诗中的句序", 0, 0);
    ctx.restore();

    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < pad.l - 6 || x > pad.l + iw + 6 || y < pad.t - 6 || y > pad.t + ih + 6) return hideTooltip();
      const i1 = Math.round(((x - pad.l) / iw) * (maxPos - 1));
      const i2 = Math.round(((pad.t + ih - y) / ih) * (maxPos - 1));
      let cnt = 0;
      let best = 0;
      L.pairs.forEach((p) => {
        if (p.i1 === i1 && p.i2 === i2) {
          cnt++;
          best = Math.max(best, p.s);
        }
      });
      if (!cnt) return hideTooltip();
      tooltip(e.clientX, e.clientY, `<b>李白第 ${i1 + 1} 句 × 杜甫第 ${i2 + 1} 句</b><br>${cnt} 组配对<span class="tip-dim">最高相似度 ${score(best)}</span>`);
    };
    canvas.onmouseleave = hideTooltip;
  }
  register(() => {
    const c = $("#scatterCanvas");
    if (c) drawScatter(c);
  });

  /* =========================================================
     对照页 · 共同语汇
     ========================================================= */
  function renderChars() {
    const max = L.chars[0].pairs;
    $("#charGrid").innerHTML = L.chars
      .slice(0, 40)
      .map(
        (c) => `
      <div class="char-cell" title="${escapeHtml(c.l1)} / ${escapeHtml(c.l2)}">
        <span class="ch">${escapeHtml(c.ch)}</span>
        <div class="meta"><span>${fmt(c.pairs)} 组</span><b>${score(c.s)}</b></div>
        <span class="char-bar" style="width:${(c.pairs / max) * 100}%"></span>
      </div>`
      )
      .join("");
  }

  /* 诗长与配对：对数坐标散点 */
  function drawLen(canvas) {
    const { ctx, w, h } = setupCanvas(canvas);
    const C = colors();
    const pad = { l: 44, r: 14, t: 20, b: 34 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    ctx.clearRect(0, 0, w, h);

    const maxN = 60;
    const maxPairs = 320;
    const xOf = (n) => pad.l + (Math.log10(clamp(n, 1, maxN)) / Math.log10(maxN)) * iw;
    const yOf = (v) => pad.t + ih - (Math.log10(clamp(v, 1, maxPairs)) / Math.log10(maxPairs)) * ih;

    /* 网格：对数刻度 */
    ctx.strokeStyle = hexA(C.ink, 0.06);
    ctx.lineWidth = 1;
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = C.ink4;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    [1, 3, 10, 30, 100, 300].forEach((v) => {
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y + 0.5);
      ctx.lineTo(pad.l + iw, y + 0.5);
      ctx.stroke();
      ctx.fillText(v === 1 ? "1" : String(v), pad.l - 8, y);
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    [1, 2, 5, 10, 20, 50].forEach((v) => {
      const x = xOf(v);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ih);
      ctx.stroke();
      ctx.fillText(String(v), x, pad.t + ih + 7);
    });

    const drawPts = (list, color) => {
      list.forEach((p) => {
        if (!p.pairs) return;
        const x = xOf(p.n);
        const y = yOf(p.pairs);
        ctx.fillStyle = hexA(color, 0.42);
        ctx.beginPath();
        ctx.arc(x, y, 1.7 + Math.sqrt(p.pairs) * 0.28, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    drawPts(L.lb, C.gold);
    drawPts(L.df, C.jade);

    /* 轴 */
    ctx.strokeStyle = hexA(C.ink, 0.22);
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ih + 0.5);
    ctx.lineTo(pad.l + iw, pad.t + ih + 0.5);
    ctx.moveTo(pad.l + 0.5, pad.t);
    ctx.lineTo(pad.l + 0.5, pad.t + ih);
    ctx.stroke();

    ctx.fillStyle = C.ink3;
    ctx.font = '11px "Noto Serif SC","Songti SC",serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("诗的行数（对数）", pad.l + iw / 2, h - 4);

    /* 图例 */
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(pad.l + 6, 9, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.ink3;
    ctx.fillText("李白", pad.l + 14, 9);
    ctx.fillStyle = C.jade;
    ctx.beginPath();
    ctx.arc(pad.l + 58, 9, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.ink3;
    ctx.fillText("杜甫", pad.l + 66, 9);

    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best = null;
      let bd = 12;
      const scan = (list, color) =>
        list.forEach((p) => {
          if (!p.pairs) return;
          const d = Math.hypot(xOf(p.n) - x, yOf(p.pairs) - y);
          if (d < bd) {
            bd = d;
            best = { p, color };
          }
        });
      scan(L.lb, C.gold);
      scan(L.df, C.jade);
      if (!best) return hideTooltip();
      tooltip(
        e.clientX,
        e.clientY,
        `<b>${escapeHtml(best.p.title)}</b><br>${best.color === C.gold ? "李白" : "杜甫"} · ${best.p.n} 行<span class="tip-dim">${best.p.pairs} 组配对 · 均分 ${best.p.avg ? score(best.p.avg) : "—"}</span>`
      );
    };
    canvas.onmouseleave = hideTooltip;
  }
  register(() => {
    const c = $("#lenCanvas");
    if (c) drawLen(c);
  });

  /* =========================================================
     检索
     ========================================================= */
  let searchTimer = null;

  function runSearch() {
    const q = state.search.q.trim();
    const min = state.search.min;
    const scope = state.search.scope;
    const sort = state.search.sort;

    let res = L.pairs.filter((p) => p.s >= min);
    if (q) {
      const chars = Array.from(new Set(Array.from(q)));
      res = res.filter((p) => {
        const hay = (scope === "lb" ? p.l1 + " " + p.t1 : scope === "df" ? p.l2 + " " + p.t2 : p.l1 + " " + p.l2 + " " + p.t1 + " " + p.t2);
        if (hay.includes(q)) return true;
        if (q.length === 1) return false;
        /* 多字时允许“全部字都出现”的近似匹配 */
        let ok = 0;
        for (const c of chars) if (hay.includes(c)) ok++;
        return q.length >= 2 ? ok === chars.length : false;
      });
    }
    if (sort === "simAsc") res.sort((a, b) => a.s - b.s);
    else if (sort === "sim") res.sort((a, b) => b.s - a.s);
    else if (sort === "len") res.sort((a, b) => b.len1 + b.len2 - (a.len1 + a.len2));

    const per = 20;
    const page = clamp(state.search.page, 1, Math.max(1, Math.ceil(res.length / per)));
    state.search.page = page;
    const slice = res.slice((page - 1) * per, page * per);

    $("#resultCount").textContent = `共 ${fmt(res.length)} 组`;
    $("#resultTime").textContent = "";
    const list = $("#resultList");
    if (!res.length) {
      list.innerHTML = `<div class="empty-state">没有找到相关诗句，换一个字试试</div>`;
    } else {
      list.innerHTML = slice
        .map(
          (p) => `
        <div class="result" data-pair="${p.id}">
          <div>
            <div class="result-poem">${emphasize(p.l1, q)}<span class="result-sep">/</span>${emphasize(p.l2, q)}</div>
            <div class="result-meta-line">
              <span class="tag">李白</span><span>${escapeHtml(p.t1)}</span>
              <span class="dotsep">·</span>
              <span class="tag df">杜甫</span><span>${escapeHtml(p.t2)}</span>
            </div>
          </div>
          <div class="result-right">
            <div class="result-score">${score(p.s)}</div>
            <div class="score-bar"><i style="width:${clamp(((p.s - 7000) / 3000) * 100, 2, 100)}%"></i></div>
          </div>
        </div>`
        )
        .join("");
      $$("#resultList .result").forEach((el) => el.addEventListener("click", () => openPair(+el.dataset.pair)));
    }
    renderPager(res.length, per, page);
  }

  function renderPager(total, per, page) {
    const pages = Math.ceil(total / per);
    const el = $("#pager");
    if (pages <= 1) {
      el.innerHTML = "";
      return;
    }
    const nums = [];
    const push = (n) => {
      if (n >= 1 && n <= pages && !nums.includes(n)) nums.push(n);
    };
    push(1);
    push(page - 2);
    push(page - 1);
    push(page);
    push(page + 1);
    push(page + 2);
    push(pages);
    nums.sort((a, b) => a - b);
    let html = `<button data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>‹</button>`;
    let prev = 0;
    nums.forEach((n) => {
      if (prev && n - prev > 1) html += `<span class="gap">…</span>`;
      html += `<button data-page="${n}" class="${n === page ? "is-active" : ""}">${n}</button>`;
      prev = n;
    });
    html += `<button data-page="${page + 1}" ${page === pages ? "disabled" : ""}>›</button>`;
    el.innerHTML = html;
    $$("#pager button").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.disabled) return;
        state.search.page = +b.dataset.page;
        runSearch();
        document.querySelector("#view-search").scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  }

  /* =========================================================
     弹层：配对详情 / 诗作详情
     ========================================================= */
  const modal = $("#poemModal");
  function openModal(html) {
    $("#modalBody").innerHTML = html;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  $$("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });

  function openPair(id) {
    const p = L.pairs[id];
    if (!p) return;
    openModal(`
      <div class="mp-poet lb">李白 · 诗句</div>
      <h3 class="mp-title">${escapeHtml(p.t1)}</h3>
      <div class="mp-meta">第 ${p.i1 + 1} 句 · ${p.len1} 字</div>
      <div class="mp-lines"><div class="mp-line hit"><span class="i">李</span><span>${escapeHtml(p.l1)}</span></div></div>
      <div class="mp-poet df">杜甫 · 诗句</div>
      <h3 class="mp-title">${escapeHtml(p.t2)}</h3>
      <div class="mp-meta">第 ${p.i2 + 1} 句 · ${p.len2} 字</div>
      <div class="mp-lines"><div class="mp-line hit"><span class="i">杜</span><span>${escapeHtml(p.l2)}</span></div></div>
      <div class="mp-sec">相似度 ${score(p.s)} · 位于全部配对的前 ${(100 - L.percentileOf(p.s) * 100).toFixed(1)}%</div>
      <div class="mp-match">
        <div><div class="a">${escapeHtml(p.l1)}</div><div class="b">${escapeHtml(p.l2)}</div></div>
        <div><div class="s">${score(p.s)}</div><div class="p">${escapeHtml(p.t1)}</div></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:22px">
        <button class="detail-btn" data-poem="lb:${p.p1}">李白全诗</button>
        <button class="detail-btn" data-poem="df:${p.p2}">杜甫全诗</button>
      </div>
    `);
    $$("#modalBody [data-poem]").forEach((el) =>
      el.addEventListener("click", () => {
        const [s, pid] = el.dataset.poem.split(":");
        openPoem(s, +pid, true);
      })
    );
  }

  function openPoem(side, pid, keepScroll) {
    const p = side === "lb" ? L.lbByPid.get(pid) : L.dfByPid.get(pid);
    if (!p) return;
    const pairs = (side === "lb" ? L.pairsByLpid.get(pid) : L.pairsByDpid.get(pid)) || [];
    const hitIdx = new Set(pairs.map((x) => (side === "lb" ? x.i1 : x.i2)));
    const otherTitle = (x) => (side === "lb" ? L.dfByPid.get(x.p2).title : L.lbByPid.get(x.p1).title);
    const otherLine = (x) => (side === "lb" ? x.l2 : x.l1);

    openModal(`
      <div class="mp-poet ${side}">${side === "lb" ? "李白" : "杜甫"}</div>
      <h3 class="mp-title">${escapeHtml(p.title)}</h3>
      <div class="mp-meta">${p.n} 句 · ${p.chars} 字 · 共 ${pairs.length} 组配对 · 与 ${p.degree} 首${side === "lb" ? "杜" : "李"}诗相连</div>
      <div class="mp-lines">
        ${p.linesArr
          .map(
            (ln, i) =>
              `<div class="mp-line ${hitIdx.has(i) ? "hit" : "dim"}"><span class="i">${i + 1}</span><span>${escapeHtml(ln ? ln.text : "")}</span></div>`
          )
          .join("")}
      </div>
      <div class="mp-sec">最相似的 ${Math.min(pairs.length, 12)} 组配对</div>
      ${pairs
        .slice(0, 12)
        .map(
          (x) => `
        <div class="mp-match" data-pair="${x.id}" style="cursor:pointer">
          <div><div class="a">${escapeHtml(side === "lb" ? x.l1 : x.l2)}</div><div class="b">${escapeHtml(otherLine(x))}</div></div>
          <div><div class="s">${score(x.s)}</div><div class="p">${escapeHtml(otherTitle(x))}</div></div>
        </div>`
        )
        .join("")}
    `);
    $$("#modalBody [data-pair]").forEach((el) =>
      el.addEventListener("click", () => openPair(+el.dataset.pair))
    );
    if (keepScroll) modal.querySelector(".modal-card").scrollTop = 0;
  }

  /* =========================================================
     路由
     ========================================================= */
  const views = ["overview", "similarity", "network", "compare", "search"];
  function setView(v, push = true) {
    if (!views.includes(v)) v = "overview";
    state.view = v;
    $$(".view").forEach((el) => el.classList.toggle("is-active", el.dataset.view === v));
    $$(".nav-item").forEach((el) => el.classList.toggle("is-active", el.dataset.view === v));
    if (push && location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    /* 视图切换后重绘（canvas 尺寸可能变化） */
    requestAnimationFrame(() => {
      charts.forEach((fn) => fn());
      if (v === "network") {
        network.redraw();
        if (!network.nodes.length) network.init();
      }
      if (v === "search") runSearch();
    });
  }

  /* =========================================================
     初始化
     ========================================================= */
  function bindUI() {
    $$(".nav-item").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        setView(el.dataset.view);
      })
    );
    $$("[data-jump]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        setView(el.dataset.jump);
      })
    );
    $$(".theme-btn").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.theme)));
    window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));

    const range = $("#simRange");
    if (range) {
      range.addEventListener("input", (e) => {
        e.target.style.setProperty("--fill", ((e.target.value - 7000) / 2000) * 100 + "%");
        setThreshold(e.target.value);
      });
    }
    $$("#simPresets button").forEach((b) =>
      b.addEventListener("click", () => {
        setThreshold(b.dataset.v);
      })
    );

    /* 检索 */
    const q = $("#q");
    q.addEventListener("input", () => {
      state.search.q = q.value;
      state.search.page = 1;
      $("#qClear").classList.toggle("show", !!q.value);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 120);
    });
    $("#qClear").addEventListener("click", () => {
      q.value = "";
      state.search.q = "";
      state.search.page = 1;
      $("#qClear").classList.remove("show");
      runSearch();
      q.focus();
    });
    $$("[data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        $$("[data-scope]").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        state.search.scope = b.dataset.scope;
        state.search.page = 1;
        runSearch();
      })
    );
    const minSim = $("#minSim");
    minSim.addEventListener("input", () => {
      state.search.min = +minSim.value;
      $("#minSimOut").textContent = fmt(minSim.value);
      minSim.style.setProperty("--fill", ((minSim.value - 7000) / 2000) * 100 + "%");
      state.search.page = 1;
      runSearch();
    });
    $("#sortSel").addEventListener("change", (e) => {
      state.search.sort = e.target.value;
      runSearch();
    });

    /* 窗口尺寸变化：重绘所有图表 */
    let rT = null;
    window.addEventListener("resize", () => {
      clearTimeout(rT);
      rT = setTimeout(() => {
        charts.forEach((fn) => fn());
        if (state.view === "network") network.redraw();
      }, 150);
    });
  }

  function init() {
    applyTheme(state.theme);
    renderKpi();
    renderFindings();
    renderTwins();
    renderChars();
    renderPoemRank();
    setThreshold(7000);
    bindUI();
    hero.draw();
    const initial = location.hash.slice(1) || "overview";
    /* 便于分享与截图：?theme=ink&open=poem|pair&id= */
    const qp = new URLSearchParams(location.search);
    if (qp.get("theme")) applyTheme(qp.get("theme"));
    setView(views.includes(initial) ? initial : "overview", false);
    const open = qp.get("open");
    const id = qp.get("id");
    if (open === "poem" && id) {
      const [s, pid] = id.split(":");
      openPoem(s, +pid);
    } else if (open === "pair" && id) {
      openPair(+id);
    } else if (open === "poem") {
      openPoem("lb", 53871);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
