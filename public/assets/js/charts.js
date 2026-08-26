/* ============================================================
 * charts.js — 纯 SVG 图表（无第三方依赖）
 *   Charts.radar(svgEl, {labels, series})  标签熟练度雷达图
 *   Charts.heatmap(containerEl, {year, dataByDate})  GitHub 风格热力墙
 * 暴露 window.Charts
 * ============================================================ */
(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";

  function el(name, attrs) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ---------------- 雷达图 ---------------- */
  function radar(svg, opts) {
    svg.innerHTML = "";
    const labels = opts.labels || [];
    const series = opts.series || [];
    const W = 420, H = 380, cx = W / 2, cy = H / 2 + 6, R = 140;
    const n = labels.length;
    if (n === 0) {
      const t = el("text", { x: cx, y: cy, fill: "#8a93a6", "text-anchor": "middle", "font-size": 14 });
      t.textContent = "暂无标签数据";
      svg.appendChild(t);
      return;
    }

    // 网格环
    const rings = 4;
    for (let r = 1; r <= rings; r++) {
      const rr = (R * r) / rings;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
      }
      svg.appendChild(el("polygon", { points: pts.join(" "), fill: "none", stroke: "rgba(255,255,255,0.08)", "stroke-width": 1 }));
    }
    // 轴线 + 标签
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
      svg.appendChild(el("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "rgba(255,255,255,0.12)", "stroke-width": 1 }));
      const lx = cx + (R + 22) * Math.cos(a), ly = cy + (R + 22) * Math.sin(a);
      const t = el("text", {
        x: lx, y: ly, fill: "#c4cbdb", "font-size": 12, "text-anchor": "middle", "dominant-baseline": "middle"
      });
      t.textContent = labels[i];
      svg.appendChild(t);
    }
    // 数据多边形
    series.forEach((s) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Math.min(1, s.values[i] || 0));
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push(`${(cx + R * v * Math.cos(a)).toFixed(1)},${(cy + R * v * Math.sin(a)).toFixed(1)}`);
      }
      svg.appendChild(el("polygon", {
        points: pts.join(" "), fill: s.color + "33", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round"
      }));
      // 顶点圆点
      pts.forEach((p) => {
        const [x, y] = p.split(",");
        svg.appendChild(el("circle", { cx: x, cy: y, r: 3, fill: s.color }));
      });
      // 图例
      const lg = el("text", { x: 16, y: 16 + series.indexOf(s) * 18, fill: s.color, "font-size": 12 });
      lg.textContent = "● " + s.name;
      svg.appendChild(lg);
    });
  }

  /* ---------------- 热力墙 ---------------- */
  // opts: { year, dataByDate: {date: 饱和度0..1}, counts: {date: n},
  //         detail: {date: [{name,title,difficulty}]}, unit: "题" }
  function fmtLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function heatmap(container, opts) {
    container.innerHTML = "";
    const year = opts.year;
    const dataByDate = opts.dataByDate || {};
    const counts = opts.counts || {};
    const detail = opts.detail || {};
    const unit = opts.unit || "题";
    const cell = 13, gap = 3, padL = 28, padT = 18;

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    const weeks = Math.ceil(((end - start) / 86400000 + start.getDay() + 1) / 7);

    const W = padL + weeks * (cell + gap);
    const H = padT + 7 * (cell + gap);
    const svg = el("svg", { width: "100%", viewBox: `0 0 ${W} ${H}`, class: "heat-svg" });

    // 月份标签
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const d = new Date(start);
      d.setDate(d.getDate() + w * 7 - start.getDay());
      if (d.getMonth() !== lastMonth && d.getFullYear() === year) {
        lastMonth = d.getMonth();
        const t = el("text", { x: padL + w * (cell + gap), y: 12, fill: "#8a93a6", "font-size": 11 });
        t.textContent = d.getMonth() + 1 + "月";
        svg.appendChild(t);
      }
    }
    // 周几标签
    ["日", "一", "二", "三", "四", "五", "六"].forEach((d, i) => {
      if (i % 2 === 1) {
        const t = el("text", { x: 16, y: padT + i * (cell + gap) + cell - 2, fill: "#8a93a6", "font-size": 10 });
        t.textContent = d;
        svg.appendChild(t);
      }
    });

    const colors = ["#1b2236", "#2f5d3a", "#3f8a4d", "#57c06a", "#9be86f"];
    function level(sat) {
      if (!sat || sat <= 0) return 0;
      if (sat < 0.34) return 1;
      if (sat < 0.67) return 2;
      if (sat < 1) return 3;
      return 4;
    }
    const DIFF_ZH = { easy: "简单", medium: "中等", hard: "困难" };

    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(date.getDate() + w * 7 + d - start.getDay());
        if (date.getFullYear() !== year) continue;
        const ds = fmtLocal(date);
        const sat = dataByDate[ds] || 0;
        const rect = el("rect", {
          x: padL + w * (cell + gap),
          y: padT + d * (cell + gap),
          width: cell, height: cell, rx: 3,
          fill: colors[level(sat)]
        });
        // 悬浮明细：日期 + 数量 + 题目列表
        let tip = `${ds}  ${counts[ds] || 0} ${unit}`;
        const items = detail[ds];
        if (items && items.length) {
          const lines = items.slice(0, 6).map((it) =>
            `· ${it.name ? it.name + " " : ""}${it.title}〔${DIFF_ZH[it.difficulty] || it.difficulty || ""}〕`
          );
          if (items.length > 6) lines.push(`… 等共 ${items.length} 条`);
          tip += "\n" + lines.join("\n");
        }
        const title = el("title", {});
        title.textContent = tip;
        rect.appendChild(title);
        svg.appendChild(rect);
      }
    }
    container.appendChild(svg);

    // 图例
    const legend = document.createElement("div");
    legend.className = "heat-legend";
    legend.innerHTML =
      '<span>少</span>' + colors.map((c) => `<i style="background:${c}"></i>`).join("") + "<span>多</span>";
    container.appendChild(legend);
  }

  window.Charts = { radar, heatmap };
})();
