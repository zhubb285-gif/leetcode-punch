/* ============================================================
 * dashboard.js — 登录态主应用（我的打卡 / 数据大屏 / 题解书库 / 求职搜索 / 个人信息）
 * ============================================================ */
(function () {
  "use strict";

  const TOKEN = localStorage.getItem("lc_token");
  if (!TOKEN) location.href = "/";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const DIFF = { easy: "简单", medium: "中等", hard: "困难" };

  let me = null;
  let myRecords = [];
  let board = null;
  let currentTab = "mine";
  let heatYear = new Date().getFullYear();
  let selectedUserId = "all"; // 大屏选中用户
  let tocLoaded = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, type) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (type ? " " + type : "");
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.className = "toast"), 2800);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: Object.assign(
        { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
        opts.headers || {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      localStorage.removeItem("lc_token");
      location.href = "/";
      throw new Error("请重新登录");
    }
    if (!res.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function fmtTime(ts) {
    const d = new Date(+ts);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  /* ==================== 我的打卡 ==================== */
  async function loadMe() {
    me = await api("/api/me");
    myRecords = await api("/api/records").then((d) => d.records);
    renderMine();
    renderProfile();
  }

  function renderMine() {
    const u = me.user;
    $("#meName").textContent = u.name;
    $("#meAvatar").textContent = u.name.slice(0, 1).toUpperCase();
    $("#todayLabel").textContent = me.today.date;

    const t = me.today.totals;
    const T = me.target;
    const bar = (diff, cur, target, cap) => {
      const pct = Math.min(100, (cur / cap) * 100);
      const met = cur >= target;
      return `<div class="pbar-row">
        <div class="pbar-label"><span>${DIFF[diff]}</span><span class="cnt">${cur} / 目标 ${target}</span></div>
        <div class="pbar-track"><div class="pbar-fill ${diff} ${met ? "met" : ""}" style="width:${pct}%"></div></div>
      </div>`;
    };
    $("#myProgress").innerHTML =
      bar("easy", t.easy, T.easy, T.easy) +
      bar("medium", t.medium, T.medium, 3) +
      bar("hard", t.hard, T.hard, T.hard);

    const hour = new Date().getHours();
    const met = t.easy >= T.easy && t.medium >= T.medium && t.hard >= T.hard;
    const cls = met ? "light" : hour >= 21 ? "light warn" : "light off";
    const label = met ? "已达标" : hour >= 21 ? "未达标 · 预警" : "未达标";
    $("#myLight").innerHTML = `<div class="${cls}"><span class="bulb"></span><span>${label}</span></div>`;

    const pf = me.profile;
    $("#myStatLine").innerHTML = `
      <span>连击 <b>${me.streak}</b> 天</span>
      <span>平台累计 <b>${me.cumulative.total}</b> 题</span>
      ${pf ? `<span>力扣 <b>${pf.totalSolved}</b> 题（简${pf.easy}/中${pf.medium}/难${pf.hard}）</span>` : ""}`;

    $("#todayCount").textContent = `共 ${me.today.records.length} 题`;
    $("#todayList").innerHTML = me.today.records.length
      ? me.today.records
          .map((r) => {
            const tags = (r.tags || []).map((tg) => `<span class="tag">${esc(tg)}</span>`).join("");
            const meta = [];
            meta.push(r.source === "leetcode" ? "🔗 力扣同步" : "✍️ 手动");
            meta.push("🕓 " + fmtTime(r.timestamp));
            return `<li class="prob-item">
              <div class="prob-top"><span class="prob-title">${esc(r.title)}</span>
                <span><span class="badge ${r.difficulty}">${DIFF[r.difficulty]}</span>
                <button class="btn danger" data-del="${r.id}" style="margin-left:6px">删</button></span>
              </div>
              <div class="prob-meta">${meta.join("　")}</div>
              ${tags ? `<div class="prob-tags">${tags}</div>` : ""}
            </li>`;
          })
          .join("")
      : `<li class="empty">今日暂无记录 — 去「个人信息」绑定力扣 ID 并点击同步</li>`;

    $$("#todayList [data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api("/api/records/" + b.dataset.del, { method: "DELETE" });
          toast("已删除");
          await loadMe();
          if (board) renderBoard();
        } catch (e) { toast(e.message, "err"); }
      })
    );
  }

  /* ==================== 数据大屏 ==================== */
  async function loadBoard() {
    board = await api("/api/board");
    renderBoard();
  }

  function selectedUser() {
    if (!board) return null;
    return board.users.find((u) => u.id === selectedUserId) || null;
  }

  function renderBoard() {
    if (!board) return;
    const s = board.summary;

    $("#kpiGrid").innerHTML = `
      <div class="kpi"><div class="k-num">${s.userCount}</div><div class="k-label">注册用户</div></div>
      <div class="kpi blue"><div class="k-num">${s.totalAC}</div><div class="k-label">累计 AC（平台内）</div></div>
      <div class="kpi green"><div class="k-num">${s.todayAC}</div><div class="k-label">今日 AC</div></div>
      <div class="kpi blue"><div class="k-num">${s.activeToday}/${s.userCount}</div><div class="k-label">今日活跃</div></div>
      <div class="kpi ${s.metToday === s.userCount && s.userCount > 0 ? "green" : "red"}"><div class="k-num">${s.metToday}/${s.userCount}</div><div class="k-label">今日达标</div></div>`;

    // 热力墙用户选择器
    const sel = $("#heatUser");
    const prev = sel.value || selectedUserId;
    sel.innerHTML = `<option value="all">全站</option>` + board.users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
    sel.value = board.users.some((u) => u.id === prev) || prev === "all" ? prev : "all";
    selectedUserId = sel.value;

    // 用户榜（点击联动热力墙/雷达）
    $("#boardSub").textContent = `共 ${s.userCount} 人 · 点击可查看个人数据`;
    $("#userBoard").innerHTML = board.users.length
      ? board.users
          .map((u, i) => {
            const rankCls = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
            const dot = u.todayMet ? "on" : u.todayCount > 0 ? "miss" : "off";
            const status = u.todayMet ? "达标" : u.todayCount > 0 ? "未达标" : "未打卡";
            const pf = u.profile;
            return `<div class="user-row ${u.id === selectedUserId ? "sel" : ""}" data-uid="${u.id}">
              <div class="user-rank ${rankCls}">${i + 1}</div>
              <div class="user-info">
                <div class="user-name">${esc(u.name)}</div>
                <div class="user-sub">
                  <span class="status-dot ${dot}"></span>${status} · 连击 ${u.streak} 天 · 活跃 ${u.daysActive} 天
                  ${u.leetcodeId ? " · 力扣 " + esc(u.leetcodeId) : ""}
                  ${pf ? " · 总AC " + pf.totalSolved : ""}
                </div>
              </div>
              <div class="user-stats">
                <b>${u.totalAC}</b> 题<br/>
                <span class="diff-pill e">简${u.easy}</span><span class="diff-pill m">中${u.medium}</span><span class="diff-pill h">难${u.hard}</span>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="empty">还没有注册用户</div>`;
    $$("#userBoard .user-row").forEach((row) =>
      row.addEventListener("click", () => {
        selectedUserId = row.dataset.uid;
        renderBoard();
      })
    );

    // 难度分布（全站）
    const dist = board.users.reduce(
      (a, u) => ({ easy: a.easy + u.easy, medium: a.medium + u.medium, hard: a.hard + u.hard }),
      { easy: 0, medium: 0, hard: 0 }
    );
    const distTotal = Math.max(1, dist.easy + dist.medium + dist.hard);
    const dbar = (diff, cur) => `<div class="dist-row">
      <div class="pbar-label"><span>${DIFF[diff]}</span><span class="cnt">${cur} 题 · ${Math.round((cur / distTotal) * 100)}%</span></div>
      <div class="pbar-track"><div class="pbar-fill ${diff}" style="width:${(cur / distTotal) * 100}%"></div></div>
    </div>`;
    $("#distBars").innerHTML = dbar("easy", dist.easy) + dbar("medium", dist.medium) + dbar("hard", dist.hard);

    // 标签雷达（跟随选中用户；全站则聚合）
    const su = selectedUser();
    let tagArr;
    if (su) {
      tagArr = su.tagsTop || [];
      $("#radarTitle").textContent = `标签雷达 · ${su.name}`;
    } else {
      const agg = {};
      board.users.forEach((u) => (u.tagsTop || []).forEach(([t, c]) => (agg[t] = (agg[t] || 0) + c)));
      tagArr = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12);
      $("#radarTitle").textContent = "标签雷达 · 全站";
    }
    const labels = tagArr.slice(0, 8).map((x) => x[0]);
    const max = Math.max(1, ...tagArr.slice(0, 8).map((x) => x[1]));
    Charts.radar($("#radar"), {
      labels,
      series: [{ name: su ? su.name : "全站", color: su ? "#e8c06d" : "#6ea8fe", values: labels.map((t) => tagArr.find((x) => x[0] === t)[1] / max) }]
    });

    // 最近动态
    $("#feed").innerHTML = board.recent.length
      ? board.recent
          .map((r) => `<div class="feed-item">
            <span class="badge ${r.difficulty}">${DIFF[r.difficulty]}</span>
            <span class="fi-text"><span class="feed-name">${esc(r.name)}</span> AC 了 ${esc(r.title)}</span>
            <span class="fi-time">${fmtTime(r.ts)}</span>
          </div>`)
          .join("")
      : `<div class="empty">暂无动态</div>`;

    renderHeatmap();
  }

  function renderHeatmap() {
    if (!board) return;
    const yearSel = $("#heatYear");
    const curYear = new Date().getFullYear();
    if (!yearSel.options.length) {
      for (let y = curYear; y >= 2024; y--) {
        const o = document.createElement("option");
        o.value = y; o.textContent = y + " 年";
        yearSel.appendChild(o);
      }
      yearSel.value = heatYear;
      yearSel.addEventListener("change", () => { heatYear = +yearSel.value; renderHeatmap(); });
      $("#heatUser").addEventListener("change", (e) => { selectedUserId = e.target.value; renderBoard(); });
    }

    const su = selectedUser();
    let counts, detail;
    if (su) {
      counts = board.heatByUser[su.id] || {};
      detail = {};
      Object.entries(board.detailAll).forEach(([d, arr]) => {
        const own = arr.filter((x) => x.name === su.name);
        if (own.length) detail[d] = own;
      });
    } else {
      counts = board.heatAll;
      detail = board.detailAll;
    }

    const maxCount = Math.max(1, ...Object.values(counts));
    const dataByDate = {}, yearDetail = {}, yearCounts = {};
    Object.entries(counts).forEach(([d, n]) => {
      if (String(d).startsWith(String(heatYear))) {
        dataByDate[d] = n / maxCount;
        yearCounts[d] = n;
      }
    });
    Object.entries(detail).forEach(([d, arr]) => {
      if (String(d).startsWith(String(heatYear))) yearDetail[d] = arr;
    });

    Charts.heatmap($("#heatmap"), { year: heatYear, dataByDate, counts: yearCounts, detail: yearDetail, unit: "题" });
  }

  /* ==================== 题解书库 ==================== */
  let bookTocData = null;
  let bookZh = localStorage.getItem("book_zh") !== "0"; // 默认中文
  let progTimer = null;

  async function loadBookToc() {
    if (tocLoaded) return;
    tocLoaded = true;
    try {
      bookTocData = await api("/api/book/toc");
      $("#bookTotal").textContent = bookTocData.totalPages;
      renderTree(bookTocData.tree, "");
      refreshPrewarm();
    } catch (e) {
      tocLoaded = false;
      $("#bookTree").innerHTML = `<div class="empty">目录加载失败：<a href="https://books.halfrost.com/leetcode/en/" target="_blank" rel="noopener" style="color:var(--blue)">点这里去原站阅读</a></div>`;
    }
  }

  // 预翻译进度（后台全量预热，进行中每 5s 刷新）
  async function refreshPrewarm() {
    try {
      const p = await api("/api/book/progress");
      const bar = $("#prewarmBar");
      const total = p.total || 0;
      const done = p.done || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      if (p.running) {
        bar.style.display = "flex";
        $("#prewarmFill").style.width = pct + "%";
        $("#prewarmText").textContent = `后台预翻译中 ${done}/${total}（${pct}%）· 已翻好的页面秒开`;
        if (!progTimer) progTimer = setInterval(refreshPrewarm, 5000);
      } else if (total && done >= total) {
        bar.style.display = "flex";
        $("#prewarmFill").style.width = "100%";
        $("#prewarmText").textContent = `全部 ${total} 页已翻译完成 ✅`;
        if (progTimer) { clearInterval(progTimer); progTimer = null; }
      } else {
        bar.style.display = "none";
        if (progTimer) { clearInterval(progTimer); progTimer = null; }
      }
    } catch (e) { /* 忽略 */ }
  }

  function renderTree(tree, filter) {
    const f = filter.trim().toLowerCase();
    function matchNode(t) { return !f || t.toLowerCase().includes(f); }
    function renderNode(node, isPage) {
      // 自身或后代匹配才渲染
      if (f && !matchNode(node.title)) {
        const kids = (node.children || []).filter((k) => nodeMatches(k));
        if (!kids.length) return "";
      }
      const children = node.children || [];
      const hasKids = children.length > 0;
      const open = f ? true : !hasKids ? false : node._open === true;
      node._open = open;
      const kidHtml = children
        .map((c) => renderNode(c, !c.children || !c.children.length))
        .join("");
      return `<div class="bt-node">
        <div class="bt-row ${isPage ? "bt-page" : ""}" data-path="${esc(node.path)}" data-page="${isPage ? 1 : 0}">
          <span class="bt-arrow">${hasKids ? (open ? "▾" : "▸") : ""}</span>
          <span class="bt-title">${esc(node.title)}</span>
        </div>
        ${hasKids ? `<div class="bt-children ${open ? "" : "hidden"}">${kidHtml}</div>` : ""}
      </div>`;
    }
    function nodeMatches(n) {
      if (matchNode(n.title)) return true;
      return (n.children || []).some(nodeMatches);
    }
    $("#bookTree").innerHTML = tree.map((c) => renderNode(c, false)).join("");

    $$("#bookTree .bt-row").forEach((row) => {
      row.addEventListener("click", () => {
        const isPage = row.dataset.page === "1";
        const path = row.dataset.path;
        if (isPage) {
          $$("#bookTree .bt-row").forEach((r) => r.classList.remove("active"));
          row.classList.add("active");
          loadBookPage(path);
        } else {
          const kids = row.nextElementSibling;
          if (kids) {
            kids.classList.toggle("hidden");
            const arrow = row.querySelector(".bt-arrow");
            arrow.textContent = kids.classList.contains("hidden") ? "▸" : "▾";
          }
        }
      });
    });
  }

  async function loadBookPage(path) {
    const reader = $("#bookReader");
    const head = $("#brHead");
    const lang = $("#brLang");
    const pathLabel = $("#brPath");
    head.style.display = "flex";
    pathLabel.textContent = path;
    lang.innerHTML = (bookZh ? "中文 <span class='muted'>/ EN</span>" : "EN <span class='muted'>/ 中文</span>");
    // 清空旧内容保留 head
    [...reader.children].forEach((c) => { if (c !== head) c.remove(); });
    const loading = document.createElement("div");
    loading.className = "br-loading";
    loading.textContent = bookZh ? "翻译中，约 1-5 秒…" : "加载中…";
    reader.appendChild(loading);
    try {
      const url = "/api/book/page?path=" + encodeURIComponent(path) + (bookZh ? "&zh=1" : "");
      const page = await api(url);
      const content = `<div class="md-content">${page.html}</div>
        <div class="book-src">内容来源：<a href="${page.source}" target="_blank" rel="noopener">${page.source}</a>（版权归原作者所有）</div>`;
      const wrap = document.createElement("div");
      wrap.innerHTML = content;
      reader.replaceChild(wrap, loading);
      reader.scrollTop = 0;
      $$(".md-content a", wrap).forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (href.startsWith("#b:")) {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            loadBookPage(href.slice(3).replace(/\/+$/, ""));
          });
        } else if (href.startsWith("#")) {
          // 页内锚点保留默认
        } else {
          a.target = "_blank";
          a.rel = "noopener";
        }
      });
    } catch (e) {
      loading.textContent = "页面加载失败：" + e.message;
      loading.className = "br-empty";
    }
  }

  // 切换中/EN
  function bindBookLang() {
    $("#brLang").addEventListener("click", () => {
      const active = $$("#bookTree .bt-row.active")[0];
      bookZh = !bookZh;
      localStorage.setItem("book_zh", bookZh ? "1" : "0");
      if (active) loadBookPage(active.dataset.path);
    });
  }

  /* ==================== 求职搜索 ==================== */
  const PLATFORMS = [
    { name: "BOSS直聘", icon: "🤝", desc: "直聊式招聘", url: (kw, c) => `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(kw + (c ? " " + c : ""))}` },
    { name: "拉勾招聘", icon: "🧑‍💻", desc: "互联网职位", url: (kw, c) => `https://www.lagou.com/wn/jobs?kd=${encodeURIComponent(kw)}${c ? "&city=" + encodeURIComponent(c) : ""}` },
    { name: "猎聘", icon: "🎯", desc: "中高端职位", url: (kw) => `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(kw)}` },
    { name: "智联招聘", icon: "📋", desc: "综合招聘", url: (kw) => `https://sou.zhaopin.com/?kw=${encodeURIComponent(kw)}` },
    { name: "LinkedIn", icon: "🌐", desc: "全球职场平台", url: (kw, c) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}${c ? "&location=" + encodeURIComponent(c) : ""}` },
    { name: "实习僧", icon: "🎓", desc: "实习专场", url: (kw, c) => `https://www.shixiseng.com/interns?keyword=${encodeURIComponent(kw)}${c ? "&city=" + encodeURIComponent(c) : ""}` }
  ];
  const JOB_CHIPS = ["算法工程师", "Java后端", "前端开发", "Go开发", "数据分析", "测试开发", "产品经理", "实习生"];

  /* 热门岗位滚动小屏数据（岗位 / 方向 / 热度） */
  const HOT_JOBS = [
    ["大模型应用工程师", "AI 大模型", 98], ["算法工程师", "AI 算法", 96],
    ["前端开发工程师", "前端", 92], ["Java 后端开发", "后端", 90],
    ["Go 后端开发", "后端", 88], ["数据分析师", "数据", 85],
    ["大数据开发工程师", "数据", 84], ["Python 开发工程师", "后端", 84],
    ["C++ 开发工程师", "后端", 82], ["自动驾驶算法工程师", "自动驾驶", 82],
    ["云计算工程师", "云原生", 80], ["测试开发工程师", "测试", 80],
    ["全栈工程师", "综合", 79], ["DevOps 工程师", "运维", 78],
    ["嵌入式软件工程师", "嵌入式", 76], ["网络安全工程师", "安全", 75],
    ["芯片设计工程师", "半导体", 74], ["机器人算法工程师", "机器人", 72],
    ["iOS 开发工程师", "移动端", 70], ["Android 开发工程师", "移动端", 70],
    ["游戏客户端开发", "游戏", 68], ["数据库管理员 DBA", "数据", 62],
    ["区块链开发工程师", "区块链", 58], ["技术支持工程师", "支持", 55]
  ];
  const JT_ROW_H = 44;
  let tickerTimer = null;

  function initJobTicker() {
    if (tickerTimer || $("#jobTrack").dataset.init) return;
    const track = $("#jobTrack");
    track.dataset.init = "1";
    // 尾部复制前 5 行实现无缝循环
    const rows = HOT_JOBS.concat(HOT_JOBS.slice(0, 5));
    track.innerHTML = rows
      .map((j, i) => {
        const rank = (i % HOT_JOBS.length) + 1;
        return `<div class="jt-row" data-job="${esc(j[0])}">
          <span class="jt-rank ${rank <= 3 ? "hot" : ""}">${rank}</span>
          <span class="jt-name">${esc(j[0])}</span>
          <span class="jt-cat">${esc(j[1])}</span>
          <span class="jt-heat"><span class="jt-heat-bar"><span class="jt-heat-fill" style="width:${j[2]}%"></span></span><span class="jt-heat-num">${j[2]}</span></span>
        </div>`;
      })
      .join("");

    let idx = 0;
    const step = () => {
      idx++;
      track.style.transform = `translateY(${-idx * JT_ROW_H}px)`;
      if (idx === HOT_JOBS.length) {
        // 过渡结束后瞬移回起点（无动画）
        setTimeout(() => {
          track.style.transition = "none";
          track.style.transform = "translateY(0)";
          idx = 0;
          track.offsetHeight; // 强制回流
          track.style.transition = "";
        }, 600);
      }
    };
    tickerTimer = setInterval(step, 2200);
    const screen = $(".jt-screen");
    screen.addEventListener("mouseenter", () => { clearInterval(tickerTimer); tickerTimer = null; });
    screen.addEventListener("mouseleave", () => { if (!tickerTimer) tickerTimer = setInterval(step, 2200); });
    // 点击岗位 → 填入关键词
    $$(".jt-row", track).forEach((row) =>
      row.addEventListener("click", () => {
        $("#jobKw").value = row.dataset.job;
        renderJobCards();
        toast("已填入关键词：" + row.dataset.job);
      })
    );
  }

  function renderJobs() {
    initJobTicker();
    $("#jobChips").innerHTML = JOB_CHIPS.map((c) => `<span class="job-chip">${c}</span>`).join("");
    $$("#jobChips .job-chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        $("#jobKw").value = chip.textContent;
        renderJobCards();
      })
    );
    ["jobKw", "jobCity"].forEach((id) => $("#" + id).addEventListener("input", renderJobCards));
    renderJobCards();
  }

  function renderJobCards() {
    const kw = $("#jobKw").value.trim() || "程序员";
    const city = $("#jobCity").value.trim();
    $("#jobGrid").innerHTML = PLATFORMS.map(
      (p, i) => `<div class="job-card" data-idx="${i}">
        <div class="jc-icon">${p.icon}</div>
        <div class="jc-name">${p.name}</div>
        <div class="jc-desc">${p.desc} · 搜索「${esc(kw)}${city ? " · " + esc(city) : ""}」</div>
      </div>`
    ).join("");
    $$("#jobGrid .job-card").forEach((card) =>
      card.addEventListener("click", () => {
        const p = PLATFORMS[+card.dataset.idx];
        window.open(p.url(kw, city), "_blank", "noopener");
      })
    );
  }

  /* ==================== 个人信息 ==================== */
  function renderProfile() {
    if (!me) return;
    const u = me.user;
    $("#pfName").textContent = u.name;
    $("#pfCreated").textContent = (u.createdAt || "").slice(0, 10);

    const box = $("#pfLc");
    const syncArea = $("#pfSyncArea");
    if (u.leetcodeId) {
      const pf = me.profile;
      box.innerHTML = `<div class="pf-val" style="flex:1">${esc(u.leetcodeId)}</div><span class="lock-badge">🔒 已绑定</span>`;
      syncArea.innerHTML = `<button class="btn primary" id="btnSync">立即同步力扣</button>
        ${pf ? `<span class="muted" style="align-self:center">总AC ${pf.totalSolved}（简${pf.easy}/中${pf.medium}/难${pf.hard}）</span>` : ""}`;
      $("#btnSync").addEventListener("click", doSync);
    } else {
      box.innerHTML = `<input class="inp" id="pfLcInput" placeholder="力扣 ID（leetcode.cn 用户名）" style="flex:1" />`;
      syncArea.innerHTML = `<button class="btn primary" id="btnBind">绑定力扣 ID</button>`;
      $("#btnBind").addEventListener("click", async () => {
        const id = $("#pfLcInput").value.trim();
        if (!id) return toast("请填写力扣 ID", "err");
        try {
          await api("/api/settings", { method: "POST", body: { leetcodeId: id } });
          toast("绑定成功 🔒（此后不可修改）", "ok");
          await loadMe();
        } catch (e) { toast(e.message, "err"); }
      });
    }

    // 数据备份：导出 / 导入
    const btnExport = $("#btnExport");
    const btnImport = $("#btnImport");
    const fileInput = $("#backupFile");
    if (btnExport) btnExport.onclick = exportData;
    if (btnImport) btnImport.onclick = () => fileInput && fileInput.click();
    if (fileInput) fileInput.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    };
  }

  async function exportData() {
    try {
      const res = await fetch("/api/backup", { headers: { Authorization: "Bearer " + TOKEN } });
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leetcode-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
      toast("已导出数据，请妥善保存", "ok");
    } catch (e) { toast(e.message || "导出失败", "err"); }
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const data = await api("/api/restore", { method: "POST", body: obj });
      if (data.token) localStorage.setItem("lc_token", data.token);
      toast("数据已恢复，正在刷新…", "ok");
      setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message || "导入失败", "err"); }
  }

  async function doSync() {
    const btn = $("#btnSync");
    btn.disabled = true; btn.textContent = "同步中…";
    try {
      const r = await api("/api/sync", { method: "POST" });
      toast(r.added ? `同步成功，新增 ${r.added} 条 AC 🎉` : "同步完成，最近提交已全部入库", "ok");
      await loadMe();
      board = null;
      await loadBoard();
    } catch (e) {
      toast("同步失败：" + e.message, "err");
    } finally {
      const b = $("#btnSync");
      if (b) { b.disabled = false; b.textContent = "立即同步力扣"; }
    }
  }

  /* ==================== 框架 ==================== */
  function showTab(tab) {
    currentTab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
    if (tab === "board") loadBoard().catch(() => {});
    if (tab === "book") loadBookToc().catch(() => {});
    if (tab === "jobs") renderJobs();
  }

  async function init() {
    $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
    $("#btnLogout").addEventListener("click", async () => {
      try { await api("/api/logout", { method: "POST" }); } catch (e) {}
      localStorage.removeItem("lc_token");
      localStorage.removeItem("lc_user");
      location.href = "/";
    });
    $("#bookSearch").addEventListener("input", (e) => {
      if (bookTocData) renderTree(bookTocData.tree, e.target.value);
    });
    bindBookLang();
    // 修改密码（静态元素，只绑一次）
    $("#btnPw").addEventListener("click", async () => {
      const o = $("#pwOld").value, n = $("#pwNew").value, n2 = $("#pwNew2").value;
      if (n.length < 4) return toast("新密码至少 4 位", "err");
      if (n !== n2) return toast("两次新密码不一致", "err");
      try {
        await api("/api/password", { method: "POST", body: { oldPassword: o, newPassword: n } });
        $("#pwOld").value = $("#pwNew").value = $("#pwNew2").value = "";
        toast("密码已修改", "ok");
      } catch (e) { toast(e.message, "err"); }
    });
    try {
      await loadMe();
      await loadBoard();
    } catch (e) {
      toast(e.message, "err");
    }
    setInterval(() => {
      if (currentTab === "board" && !document.hidden) loadBoard().catch(() => {});
    }, 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
