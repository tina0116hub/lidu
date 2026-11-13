# -*- coding: utf-8 -*-
"""
李白·杜甫诗句相似度 —— 数据整理脚本
输入：李白.csv / 杜甫.csv / 李白-杜甫.csv（上级目录）
输出：data.json（供可视化网站读取）

李白-杜甫.csv 字段（无表头，共 11 列）：
0 诗人1（李白）  1 诗题1  2 诗句1
3 诗人2（杜甫）  4 诗题2  5 诗句2
6 相似度（0-10000）
7 李白诗 ID      8 李白句序
9 杜甫诗 ID      10 杜甫句序（句序自 0 起）
"""
import json
import os
from collections import Counter, defaultdict

import pandas as pd

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
OUT = os.path.join(BASE, "data.json")

POEM_COLS = ["title", "line", "pid", "idx"]
PAIR_COLS = ["p1_name", "p1_title", "p1_line", "p2_name", "p2_title", "p2_line",
             "similarity", "lb_pid", "lb_idx", "df_pid", "df_idx"]


def read_csv(name, cols):
    return pd.read_csv(os.path.join(ROOT, name), header=None, names=cols, encoding="utf-8")


def main():
    lb = read_csv("李白.csv", POEM_COLS)
    df = read_csv("杜甫.csv", POEM_COLS)
    pairs = read_csv("李白-杜甫.csv", PAIR_COLS)

    # ---------- 诗歌级元数据 ----------
    def poem_meta(frame):
        g = frame.groupby("pid")
        meta = {}
        for pid, sub in g:
            sub = sub.sort_values("idx")
            meta[int(pid)] = {
                "title": sub["title"].iloc[0],
                "n": int(len(sub)),
                "chars": int(sub["line"].str.len().sum()),
                "lines": sub["line"].tolist(),
            }
        return meta

    lb_meta = poem_meta(lb)
    df_meta = poem_meta(df)

    # ---------- 诗句 ID 与配对索引 ----------
    lb_line_id, df_line_id = {}, {}
    lb_lines, df_lines = [], []

    def intern(meta, store, index, pid, idx):
        key = (pid, idx)
        if key in index:
            return index[key]
        info = meta.get(pid)
        if info is None or idx >= len(info["lines"]):
            return -1
        lid = len(store)
        store.append({
            "p": pid, "i": idx,
            "t": info["lines"][idx],
            "l": len(info["lines"][idx]),
        })
        index[key] = lid
        return lid

    rows = []
    skipped = 0
    for r in pairs.itertuples(index=False):
        a = intern(lb_meta, lb_lines, lb_line_id, int(r.lb_pid), int(r.lb_idx))
        b = intern(df_meta, df_lines, df_line_id, int(r.df_pid), int(r.df_idx))
        if a < 0 or b < 0:
            skipped += 1
            continue
        rows.append((a, b, int(r.similarity)))

    rows.sort(key=lambda x: -x[2])

    # ---------- 诗作级聚合 ----------
    lb_pid_index = {pid: i for i, pid in enumerate(sorted(lb_meta))}
    df_pid_index = {pid: i for i, pid in enumerate(sorted(df_meta))}

    lb_nodes = [dict(pid=pid, title=meta["title"], n=meta["n"], chars=meta["chars"])
                for pid, meta in sorted(lb_meta.items())]
    df_nodes = [dict(pid=pid, title=meta["title"], n=meta["n"], chars=meta["chars"])
                for pid, meta in sorted(df_meta.items())]

    lb_stat = defaultdict(lambda: {"n": 0, "s": 0, "mx": 0, "partners": Counter(), "best": None})
    df_stat = defaultdict(lambda: {"n": 0, "s": 0, "mx": 0, "partners": Counter(), "best": None})
    edge_stat = defaultdict(lambda: {"n": 0, "s": 0, "mx": 0})

    for a, b, s in rows:
        la, ldf = lb_lines[a], df_lines[b]
        lpid, dpid = la["p"], ldf["p"]
        st = lb_stat[lpid]
        st["n"] += 1
        st["s"] += s
        st["mx"] = max(st["mx"], s)
        st["partners"][dpid] += 1
        if st["best"] is None or s > st["best"][0]:
            st["best"] = (s, dpid, ldf["i"], la["i"])
        sd = df_stat[dpid]
        sd["n"] += 1
        sd["s"] += s
        sd["mx"] = max(sd["mx"], s)
        sd["partners"][lpid] += 1
        if sd["best"] is None or s > sd["best"][0]:
            sd["best"] = (s, lpid, la["i"], ldf["i"])
        e = edge_stat[(lpid, dpid)]
        e["n"] += 1
        e["s"] += s
        e["mx"] = max(e["mx"], s)

    for nodes, stat, other_index, other_nodes in (
        (lb_nodes, lb_stat, df_pid_index, df_nodes),
        (df_nodes, df_stat, lb_pid_index, lb_nodes),
    ):
        for node in nodes:
            st = stat.get(node["pid"])
            if not st or st["n"] == 0:
                node.update(pairs=0, avg=None, max=None, degree=0, top=[], best=None)
                continue
            node.update(
                pairs=st["n"],
                avg=round(st["s"] / st["n"], 1),
                max=st["mx"],
                degree=len(st["partners"]),
            )
            tops = st["partners"].most_common(6)
            node["top"] = [{"pid": pid, "n": n} for pid, n in tops]
            s, opid, oi, si = st["best"]
            node["best"] = {
                "s": s,
                "pid": opid,
                "title": other_nodes[other_index[opid]]["title"],
                "mine": si,
                "other": oi,
            }

    # ---------- 全局统计 ----------
    sims = [s for _, _, s in rows]
    sims_sorted = sorted(sims)
    n = len(sims_sorted)

    def pct(p):
        return sims_sorted[min(n - 1, int(round(p / 100 * (n - 1))))]

    histogram = Counter()
    for s in sims:
        histogram[(s // 100) * 100] += 1
    buckets = []
    for k in range(7000, 10001, 100):
        buckets.append([k, histogram.get(k, 0)])

    # ---------- 字词层面的“共同语汇” ----------
    char_pairs = Counter()          # 同一诗句对中共同出现的字
    char_lines = defaultdict(int)   # 该字出现在多少个诗句对中
    char_lb = Counter()
    char_df = Counter()
    for a, b, _ in rows:
        ca, cb = set(lb_lines[a]["t"]), set(df_lines[b]["t"])
        common = ca & cb
        for ch in ca:
            char_lb[ch] += 1
        for ch in cb:
            char_df[ch] += 1
        for ch in common:
            if "\u4e00" <= ch <= "\u9fff":
                char_pairs[ch] += 1
                char_lines[ch] += 1

    stop = set("，。？！、；：\u3000 　“”‘’（）《》…—·,.?!;:\"'()")

    # 每个共同字对应的典型诗句对（取相似度最高的一条）
    best_example = {}
    for a, b, s in rows:
        ca, cb = set(lb_lines[a]["t"]), set(df_lines[b]["t"])
        for ch in ca & cb:
            if ch in stop:
                continue
            if ch not in best_example or s > best_example[ch][0]:
                best_example[ch] = (s, lb_lines[a]["t"], df_lines[b]["t"], a, b)

    char_top = []
    for ch, c in char_pairs.most_common(48):
        ex = best_example.get(ch)
        char_top.append({
            "ch": ch,
            "pairs": c,
            "lb": char_lb[ch],
            "df": char_df[ch],
            "s": ex[0] if ex else 0,
            "l1": ex[1] if ex else "",
            "l2": ex[2] if ex else "",
        })

    # ---------- 输出 ----------
    data = {
        "meta": {
            "lb_poems": len(lb_nodes),
            "df_poems": len(df_nodes),
            "lb_lines_total": len(lb),
            "df_lines_total": len(df),
            "lb_chars_total": int(lb["line"].str.len().sum()),
            "df_chars_total": int(df["line"].str.len().sum()),
            "pairs": len(rows),
            "skipped": skipped,
            "lb_poems_paired": sum(1 for x in lb_nodes if x["pairs"]),
            "df_poems_paired": sum(1 for x in df_nodes if x["pairs"]),
            "sim_mean": round(sum(sims) / n, 1),
            "sim_median": sims_sorted[n // 2],
            "sim_max": sims_sorted[-1],
            "sim_min": sims_sorted[0],
            "sim_p90": pct(90),
            "sim_p95": pct(95),
            "sim_p99": pct(99),
            "thresholds": [pct(50), pct(80), pct(90), pct(95), pct(99)],
        },
        "hist": buckets,
        "lb": lb_nodes,
        "df": df_nodes,
        "linesL": lb_lines,
        "linesD": df_lines,
        "pairs": [[a, b, s] for a, b, s in rows],
        "edges": [[lb_pid_index[l], df_pid_index[d], v["n"], round(v["s"] / v["n"], 1), v["mx"]]
                  for (l, d), v in edge_stat.items()],
        "chars": char_top,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    # 同时生成 data.js，供 index.html 直接以 <script> 引入（无需本地服务器）
    with open(os.path.join(BASE, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.__LIDU_DATA__ = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")

    size = os.path.getsize(OUT)
    print(f"pairs={len(rows)} skipped={skipped} lb_nodes={len(lb_nodes)} df_nodes={len(df_nodes)}")
    print(f"edges={len(data['edges'])} chars={len(char_top)} json={size/1024:.1f} KB")
    print(f"sim mean={data['meta']['sim_mean']} median={data['meta']['sim_median']} "
          f"p90={data['meta']['sim_p90']} p95={data['meta']['sim_p95']} p99={data['meta']['sim_p99']}")


if __name__ == "__main__":
    main()

