/* =========================================================
   李杜诗心 · 数据层
   读取 data.js（由 build_site.py 从 data.json 注入）并建立索引
   ========================================================= */
(function () {
  "use strict";

  const RAW = window.__LIDU_DATA__;
  if (!RAW) {
    document.body.innerHTML =
      '<div style="padding:80px;font-family:serif;color:#444">' +
      "数据未加载：请确认 index.html 与 data.js 在同一目录。</div>";
    return;
  }

  const D = RAW;

  /* ---------- 诗句索引 ----------
     linesL[i] = { p, i, t, l }  → 扁平化后带上全局 id 与归属诗作 */
  const lineL = D.linesL.map((x, id) => ({ id, side: "lb", pid: x.p, idx: x.i, text: x.t, len: x.l }));
  const lineD = D.linesD.map((x, id) => ({ id, side: "df", pid: x.p, idx: x.i, text: x.t, len: x.l }));

  /* 诗作按 pid 索引 */
  const lbByPid = new Map();
  D.lb.forEach((p, i) => {
    p.side = "lb";
    p.order = i;
    p.linesArr = [];
    lbByPid.set(p.pid, p);
  });
  const dfByPid = new Map();
  D.df.forEach((p, i) => {
    p.side = "df";
    p.order = i;
    p.linesArr = [];
    dfByPid.set(p.pid, p);
  });

  lineL.forEach((l) => {
    const p = lbByPid.get(l.pid);
    if (p) p.linesArr[l.idx] = l;
  });
  lineD.forEach((l) => {
    const p = dfByPid.get(l.pid);
    if (p) p.linesArr[l.idx] = l;
  });

  /* ---------- 配对 ---------- */
  const pairs = D.pairs.map(([a, b, s], id) => {
    const la = lineL[a];
    const lb2 = lineD[b];
    return {
      id,
      a,
      b,
      s,
      l1: la.text,
      l2: lb2.text,
      t1: lbByPid.get(la.pid).title,
      t2: dfByPid.get(lb2.pid).title,
      p1: la.pid,
      p2: lb2.pid,
      i1: la.idx,
      i2: lb2.idx,
      len1: la.len,
      len2: lb2.len,
    };
  });

  /* 按相似度降序的 rank，用于百分位 */
  const bySim = pairs.slice().sort((x, y) => y.s - x.s);
  const simsSorted = bySim.map((p) => p.s).sort((a, b) => a - b);
  const N = simsSorted.length;

  function percentileOf(score) {
    /* 返回该分数对应的百分位（0=最低，1=最高） */
    let lo = 0,
      hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (simsSorted[mid] < score) lo = mid + 1;
      else hi = mid;
    }
    return lo / N;
  }

  /* 每条配对在被匹配诗作中的“配对条目”缓存 */
  const pairsByLpid = new Map();
  const pairsByDpid = new Map();
  pairs.forEach((p) => {
    if (!pairsByLpid.has(p.p1)) pairsByLpid.set(p.p1, []);
    pairsByLpid.get(p.p1).push(p);
    if (!pairsByDpid.has(p.p2)) pairsByDpid.set(p.p2, []);
    pairsByDpid.get(p.p2).push(p);
  });
  pairsByLpid.forEach((arr) => arr.sort((x, y) => y.s - x.s));
  pairsByDpid.forEach((arr) => arr.sort((x, y) => y.s - x.s));

  /* 字 → 配对（用于检索高亮与共同语汇） */
  const charIndex = new Map();
  pairs.forEach((p) => {
    const seen = new Set();
    for (const ch of p.l1) {
      if (seen.has(ch) || !/[\u4e00-\u9fff]/.test(ch)) continue;
      seen.add(ch);
      addChar(ch, p);
    }
    for (const ch of p.l2) {
      if (seen.has(ch) || !/[\u4e00-\u9fff]/.test(ch)) continue;
      seen.add(ch);
      addChar(ch, p);
    }
  });
  function addChar(ch, p) {
    let arr = charIndex.get(ch);
    if (!arr) charIndex.set(ch, (arr = []));
    arr.push(p);
  }

  /* ---------- 网络边 ---------- */
  const edges = D.edges.map(([lp, dp, n, avg, mx]) => ({
    lp,
    dp,
    n,
    avg,
    mx,
    lpid: D.lb[lp].pid,
    dpid: D.df[dp].pid,
  }));

  window.LIDU = {
    raw: D,
    meta: D.meta,
    hist: D.hist,
    chars: D.chars,
    lineL,
    lineD,
    lb: D.lb,
    df: D.df,
    lbByPid,
    dfByPid,
    pairs,
    bySim,
    edges,
    N,
    percentileOf,
    pairsByLpid,
    pairsByDpid,
    charIndex,
  };
})();
