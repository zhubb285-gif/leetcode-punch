/* ============================================================
 * app.js — 交互主逻辑与五大功能模块
 * ============================================================ */
(function () {
  "use strict";

  const DIFF = {
    easy: { label: "简单", cls: "easy" },
    medium: { label: "中等", cls: "medium" },
    hard: { label: "困难", cls: "hard" }
  };

  let today = Store.todayStr();
  let currentTab = "checkin";
  let me = "p1"; // 复盘互评时的身份
  let settledToday = false;

  /* ---------- 工具 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function toast(msg, type) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (type ? " " + type : "");
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.className = "toast"), 2600);
  }

  function esc(s) {
    return MD.escapeHtml(String(s == null ? "" : s));
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  /* ============================================================
   * 渲染：顶栏玩家芯片
   * ============================================================ */
  function renderChips() {
    const players = Store.getPlayers();
    const pts = Store.getPoints();
    $("#playersChip").innerHTML = players
      .map(
        (p) => `<div class="pchip">
          <span class="pdot" style="background:${p.color}"></span>
          <span class="pname">${esc(p.name)}</span>
          <span class="ppoints">${pts[p.id] || 0} 分</span>
        </div>`
      )
      .join("");
  }

  /* ============================================================
   * 模块一：打卡台
   * ============================================================ */
  function renderCheckin() {
    today = Store.todayStr();
    $("#todayLabel").textContent = "今日 " + today;

    // 配置
    const players = Store.getPlayers();
    $("#configGrid").innerHTML = players
      .map(
        (p) => `<div class="config-player" data-pid="${p.id}">
          <h3><span class="dot" style="background:${p.color}"></span>${esc(p.id === "p1" ? "玩家一" : "玩家二")} 配置</h3>
          <input class="c-name" value="${esc(p.name)}" placeholder="昵称" />
          <input class="c-lc" value="${esc(p.leetcodeId)}" placeholder="力扣 ID（leetcode.cn 用户名）" />
          <a class="lc-link" href="https://leetcode.cn/u/${esc(p.leetcodeId)}/" target="_blank" rel="noopener" ${p.leetcodeId ? "" : 'style="display:none"'}>↗ 打开力扣主页</a>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="c-color" type="color" value="${p.color}" style="width:42px;height:34px;padding:2px" />
            <button class="btn ghost c-sync" style="flex:1">拉取力扣总题数</button>
          </div>
        </div>`
      )
      .join("");

    // 绑定配置事件
    $$("#configGrid .config-player").forEach((box) => {
      const pid = box.dataset.pid;
      const save = () => {
        const players2 = Store.getPlayers();
        const p = players2.find((x) => x.id === pid);
        p.name = box.querySelector(".c-name").value.trim() || p.name;
        p.leetcodeId = box.querySelector(".c-lc").value.trim();
        p.color = box.querySelector(".c-color").value;
        Store.setPlayers(players2);
        renderCheckin();
        renderChips();
      };
      box.querySelector(".c-name").addEventListener("change", save);
      box.querySelector(".c-lc").addEventListener("change", save);
      box.querySelector(".c-color").addEventListener("change", save);
      box.querySelector(".c-sync").addEventListener("click", () => syncLeetCode(pid));
    });

    // 两位玩家
    players.forEach((p) => refreshPlayer(p.id));
    refreshSummary();
  }

  function refreshPlayer(pid) {
    const p = Store.getPlayer(pid);
    const probs = Store.getPlayerDay(today, pid).problems;
    const t = Store.totals(probs);

    $("#pcName-" + pid).textContent = p.name;
    $("#pcName-" + pid).previousElementSibling.style.background = p.color;

    const bar = (diff, cur, target, cap) => {
      const pct = Math.min(100, (cur / cap) * 100);
      const met = cur >= target;
      return `<div class="pbar-row">
        <div class="pbar-label"><span>${DIFF[diff].label}</span><span class="cnt">${cur} / 目标 ${target}</span></div>
        <div class="pbar-track"><div class="pbar-fill ${DIFF[diff].cls} ${met ? "met" : ""}" style="width:${pct}%"></div></div>
      </div>`;
    };
    $("#prog-" + pid).innerHTML =
      bar("easy", t.easy, Store.TARGET.easy, Store.TARGET.easy) +
      bar("medium", t.medium, Store.TARGET.medium, Store.TARGET.mediumSoftMax) +
      bar("hard", t.hard, Store.TARGET.hard, Store.TARGET.hard);

    // 题目列表
    const list = probs
      .map((pr, i) => {
        const tags = (pr.tags || [])
          .map((tg) => `<span class="tag">${esc(tg)}</span>`)
          .join("");
        const note = pr.note ? `<div class="prob-note">${MD.render(pr.note)}</div>` : "";
        const meta = [];
        if (pr.timeSpent) meta.push(`⏱ ${pr.timeSpent} 分`);
        if (pr.beats) meta.push(`🏆 击败 ${pr.beats}%`);
        meta.push(`🕓 ${fmtTime(pr.createdAt)}`);
        return `<li class="prob-item">
          <div class="prob-top">
            <span class="prob-title">${esc(pr.title)}</span>
            <span class="badge ${DIFF[pr.difficulty].cls}">${DIFF[pr.difficulty].label}</span>
          </div>
          <div class="prob-meta">${meta.join("")}</div>
          ${tags ? `<div class="prob-tags">${tags}</div>` : ""}
          ${note}
          <div class="prob-actions">
            <button data-del="${i}">删除</button>
          </div>
        </li>`;
      })
      .join("");
    $("#prob-" + pid).innerHTML = list || `<li class="empty">今日暂无 AC，去添加第一道吧</li>`;

    $$("#prob-" + pid + " [data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        Store.removeProblem(today, pid, +b.dataset.del);
        refreshPlayer(pid);
        refreshSummary();
        renderChips();
      })
    );
  }

  function refreshSummary() {
    const players = Store.getPlayers();
    const rows = players
      .map((p) => {
        const t = Store.totals(Store.getPlayerDay(today, p.id).problems);
        const met = Store.metTarget(t);
        const hour = new Date().getHours();
        let cls = "light";
        if (met) cls = "light";
        else if (hour >= 21) cls = "light warn";
        else cls = "light off";
        const label = met ? "已达标" : hour >= 21 ? "未达标·预警" : "未达标";
        return `<div class="${cls}"><span class="bulb"></span><span style="color:${p.color}">${esc(p.name)}</span> · ${label}</div>`;
      })
      .join("");
    const totalAC = players.reduce((s, p) => s + Store.getPlayerDay(today, p.id).problems.length, 0);
    const allMet = players.every((p) => Store.metTarget(Store.totals(Store.getPlayerDay(today, p.id).problems)));
    $("#summaryCard").innerHTML = `
      <div class="summary-left">
        <h2>今日达标状态</h2>
        <div class="light-row">${rows}</div>
      </div>
      <div class="summary-right">
        <div class="big">${totalAC}</div>
        <div class="sub">${allMet ? "🎉 双方均已达标" : "道题 · 继续加油"}</div>
      </div>`;
  }

  function bindAddForms() {
    $$(".add-form").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const pid = form.dataset.pid;
        const title = form.querySelector(".f-title").value.trim();
        if (!title) return toast("请填写题目标题", "err");
        const difficulty = form.querySelector(".f-diff").value;
        const tags = form
          .querySelector(".f-tags")
          .value.split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const timeSpent = +form.querySelector(".f-time").value || 0;
        const beats = +form.querySelector(".f-beats").value || 0;
        const code = form.querySelector(".f-code").value.trim();
        const note = form.querySelector(".f-note").value.trim();
        Store.addProblem(today, pid, { title, difficulty, tags, timeSpent, beats, code, note });
        form.reset();
        refreshPlayer(pid);
        refreshSummary();
        renderChips();
        toast("已记录 AC ✅");
      });
    });
  }

  async function syncLeetCode(pid) {
    const p = Store.getPlayer(pid);
    if (!p.leetcodeId) return toast("请先填写力扣 ID", "err");
    const profileUrl = "https://leetcode.cn/u/" + encodeURIComponent(p.leetcodeId) + "/";
    toast("正在拉取 " + p.leetcodeId + " 的力扣数据 …");
    try {
      // 力扣中国站 GraphQL（受跨域限制，多数浏览器环境会失败，失败则回退到打开主页）
      const res = await fetch("https://leetcode.cn/graphql/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($u:String!){ matchedUser(username:$u){ submitStatsGlobal { acSubmissionNum { difficulty count } } } }`,
          variables: { u: p.leetcodeId }
        })
      });
      if (!res.ok) throw new Error("网络");
      const d = await res.json();
      const nums = d?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum || [];
      const map = {};
      nums.forEach((n) => (map[n.difficulty] = n.count));
      if (nums.length) {
        toast(
          `${p.name} 累计 AC：总 ${map.All || Object.values(map).reduce((a, b) => a + b, 0)}（简${map.Easy || 0}/中${map.Medium || 0}/难${map.Hard || 0}）`,
          "ok"
        );
      } else {
        throw new Error("空");
      }
    } catch (e) {
      // 跨域/登录限制：打开力扣主页供手动核对
      window.open(profileUrl, "_blank", "noopener");
      toast("力扣接口跨域受限，已为你打开主页，请核对后手动打卡", "err");
    }
  }

  /* ============================================================
   * 模块二：竞技场
   * ============================================================ */
  function renderArena() {
    const players = Store.getPlayers();
    // 排行榜
    const rows = players
      .map((p) => {
        const cum = Store.cumulative(p.id);
        const st = Store.streak(p.id);
        const dist = Store.difficultyDist(p.id);
        const pts = Store.getPoints()[p.id] || 0;
        return `<tr>
          <td class="name"><span class="pdot" style="background:${p.color}"></span>${esc(p.name)}</td>
          <td><b>${cum}</b></td>
          <td>🔥 ${st}</td>
          <td>
            <span class="diff-pill e">简 ${dist.easy}</span>
            <span class="diff-pill m">中 ${dist.medium}</span>
            <span class="diff-pill h">难 ${dist.hard}</span>
          </td>
          <td style="color:var(--gold);font-weight:700">${pts}</td>
        </tr>`;
      })
      .join("");
    $("#leaderboard").innerHTML = `<table class="lb-table">
      <thead><tr><th>玩家</th><th>累计 AC</th><th>连击</th><th>难度分布</th><th>积分</th></tr></thead>
      <tbody>${rows}</tbody></table>`;

    // 惩罚池
    const pen = Store.penalties;
    $("#penaltyTotal").textContent = "奖池累计 " + Store.penaltyPoolTotal() + " 分";
    $("#penaltyList").innerHTML = pen.length
      ? pen
          .slice()
          .reverse()
          .map((p) => {
            const pl = Store.getPlayer(p.playerId);
            return `<div class="penalty-item">
              <div><span class="who" style="color:${pl ? pl.color : "#fff"}">${esc(pl ? pl.name : p.playerId)}</span>
              <div class="reason">${esc(p.reason)} · ${p.date}</div></div>
              <span class="pts">-${p.points}</span>
            </div>`;
          })
          .join("")
      : `<div class="empty">暂无违约记录，保持住！</div>`;

    // 竞速
    renderDuel();
  }

  function renderDuel() {
    const players = Store.getPlayers();
    const existing = Store.getDuel(today) || { title: "", p1: {}, p2: {} };
    $("#duelTitle").value = existing.title || "";
    $("#duelRows").innerHTML = players
      .map((p) => {
        const d = existing[p.id] || {};
        return `<div class="duel-row" data-pid="${p.id}">
          <div class="dr-name"><span class="pdot" style="background:${p.color}"></span>${esc(p.name)}</div>
          <div class="dr-inputs">
            <input class="d-time" type="number" min="0" placeholder="用时(分)" value="${d.time || ""}" />
            <input class="d-beats" type="number" min="0" max="100" placeholder="击败率%" value="${d.beats || ""}" />
          </div>
        </div>`;
      })
      .join("");
    renderDuelResult();
  }

  function renderDuelResult() {
    const duel = Store.getDuel(today);
    const box = $("#duelResult");
    if (!duel || !duel.title) {
      box.innerHTML = `<div class="muted">尚未保存今日竞速。</div>`;
      return;
    }
    const p1 = Store.getPlayer("p1"), p2 = Store.getPlayer("p2");
    const a = duel.p1 || {}, b = duel.p2 || {};
    let winner = "平局";
    if (a.time && b.time) {
      if (a.time !== b.time) winner = (a.time < b.time ? p1 : p2).name + "（用时更短）";
      else if (a.beats !== b.beats) winner = (a.beats > b.beats ? p1 : p2).name + "（击败率更高）";
    }
    box.innerHTML = `<div>今日竞速：<b>${esc(duel.title)}</b></div>
      <div style="margin-top:8px">
        ${p1.name}：用时 ${a.time || "-"} 分 · 击败 ${a.beats || "-"}%
        ｜ ${p2.name}：用时 ${b.time || "-"} 分 · 击败 ${b.beats || "-"}%
      </div>
      <div class="win" style="margin-top:8px">🏆 胜者：${winner}</div>`;
  }

  /* ============================================================
   * 模块三：复盘室
   * ============================================================ */
  function renderReview() {
    // 共同题目（两人都做过）
    const titles1 = collectTitles("p1");
    const titles2 = collectTitles("p2");
    const common = [...titles1].filter((t) => titles2.has(t));
    const list = $("#commonList");
    if (!common.length) {
      list.innerHTML = `<div class="empty">还没有双方共同做过的题目。先在打卡台添加 AC，周末再来复盘吧。</div>`;
    } else {
      list.innerHTML = common
        .map((t) => {
          const pr = findProblem("p1", t);
          return `<div class="common-item" data-title="${esc(t)}">
            <h4>${esc(t)}</h4>
            <div class="ci-meta">${DIFF[pr.difficulty].label} · ${Store.getNote(t).comments.length} 条讨论 · ${Store.getNote(t).likes.length} 赞</div>
          </div>`;
        })
        .join("");
      $$("#commonList .common-item").forEach((el) =>
        el.addEventListener("click", () => openCompare(el.dataset.title))
      );
    }

    // 盲盒提示
    const dow = new Date().getDay();
    const isWeekend = dow === 0 || dow === 6;
    $("#blindHint").textContent = isWeekend
      ? "周末专属仪式 🎲：基于历史低击败率/薄弱标签生成重刷清单。"
      : "重刷盲盒为周末专属仪式，周六/周日开启（点击仍可按需生成）。";
    if (!$("#blindBox").dataset.filled) $("#blindBox").innerHTML = "";
  }

  function collectTitles(pid) {
    const set = new Set();
    const data = JSON.parse(localStorage.getItem("leetcode_duel_v1"));
    Object.keys(data.checkins || {}).forEach((date) => {
      const d = data.checkins[date][pid];
      if (d) d.problems.forEach((p) => set.add(p.title));
    });
    return set;
  }
  function findProblem(pid, title) {
    const data = JSON.parse(localStorage.getItem("leetcode_duel_v1"));
    let res = null;
    Object.keys(data.checkins || {}).forEach((date) => {
      const d = data.checkins[date][pid];
      if (d) d.problems.forEach((p) => { if (p.title === title && !res) res = p; });
    });
    return res || { title, difficulty: "easy" };
  }

  function openCompare(title) {
    const p1 = Store.getPlayer("p1"), p2 = Store.getPlayer("p2");
    const a = findProblem("p1", title), b = findProblem("p2", title);
    const col = (p, pr) => {
      const meta = [];
      if (pr.timeSpent) meta.push(`⏱ 用时 ${pr.timeSpent} 分`);
      if (pr.beats) meta.push(`🏆 击败 ${pr.beats}%`);
      const tags = (pr.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      const note = pr.note ? MD.render(pr.note) : `<span class="muted">（无笔记）</span>`;
      const code = pr.code ? esc(pr.code) : "（未附代码）";
      return `<div class="compare-col">
        <h4><span class="pdot" style="background:${p.color}"></span>${esc(p.name)}</h4>
        <div class="meta-row">难度：${DIFF[pr.difficulty].label} ${tags ? "· " + tags : ""}</div>
        <div class="meta-row">${meta.join(" ｜ ") || "—"}</div>
        <div class="meta-row"><b>解法代码</b></div>
        <pre>${code}</pre>
        <div class="meta-row"><b>题解笔记</b></div>
        <div>${note}</div>
      </div>`;
    };
    const note = Store.getNote(title);
    const comments = note.comments
      .map(
        (c) => `<div class="comment">
          <div class="c-meta">${esc(c.by)} · ${fmtTime(c.ts)}</div>
          <div class="c-text">${esc(c.text)}</div>
        </div>`
      )
      .join("");
    const liked = note.likes.includes(me);

    $("#modalTitle").textContent = "同题对比 · " + title;
    $("#modalBody").innerHTML = `
      <div class="compare">${col(p1, a)}${col(p2, b)}</div>
      <div class="discuss">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h4 style="margin:0">互评讨论（${note.comments.length}）</h4>
          <button class="like-btn" id="likeBtn">${liked ? "❤️ 已赞" : "🤍 点赞"} ${note.likes.length}</button>
        </div>
        <div id="commentList">${comments || `<div class="muted">还没有讨论，来抢沙发～</div>`}</div>
        <div class="discuss-form">
          <select id="meSel" style="width:90px;padding:8px;border-radius:9px;border:1px solid var(--stroke);background:rgba(0,0,0,0.25);color:var(--text)">
            <option value="p1">以 ${esc(p1.name)}</option>
            <option value="p2">以 ${esc(p2.name)}</option>
          </select>
          <input id="commentInput" placeholder="写下你的点评…" />
          <button class="btn primary" id="commentSend">发送</button>
        </div>
      </div>`;
    $("#meSel").value = me;
    $("#meSel").addEventListener("change", (e) => (me = e.target.value));
    $("#commentSend").addEventListener("click", () => {
      const v = $("#commentInput").value.trim();
      if (!v) return;
      const name = Store.getPlayer(me).name;
      Store.addComment(title, name, v);
      openCompare(title); // 刷新
    });
    $("#likeBtn").addEventListener("click", () => {
      Store.toggleLike(title, me);
      openCompare(title);
    });

    $("#modal").hidden = false;
  }

  function generateBlindBox() {
    const all = [];
    const data = JSON.parse(localStorage.getItem("leetcode_duel_v1"));
    Object.keys(data.checkins || {}).forEach((date) => {
      ["p1", "p2"].forEach((pid) => {
        const d = data.checkins[date][pid];
        if (d) d.problems.forEach((p) => all.push(Object.assign({ date, pid }, p)));
      });
    });
    if (!all.length) return toast("还没有任何题目可生成盲盒", "err");

    // 评分：击败率越低越优先（缺省 0）；同分时按难度（难>中>简）加权
    const w = { hard: 3, medium: 2, easy: 1 };
    const scored = all
      .map((p) => ({
        p,
        score: (100 - (p.beats || 0)) + w[p.difficulty] * 10
      }))
      .sort((a, b) => b.score - a.score);

    // 去重取前 5（按标题）
    const seen = new Set();
    const pick = [];
    for (const s of scored) {
      if (seen.has(s.p.title)) continue;
      seen.add(s.p.title);
      pick.push(s.p);
      if (pick.length >= 5) break;
    }
    $("#blindBox").dataset.filled = "1";
    $("#blindBox").innerHTML = pick
      .map((p) => {
        const reason = p.beats ? `历史击败率仅 ${p.beats}%，建议重刷巩固` : `缺少击败率数据，基础巩固`;
        return `<div class="blind-item">
          <div><b>${esc(p.title)}</b><div class="bi-reason">${reason} · 原难度 ${DIFF[p.difficulty].label}</div></div>
          <span class="badge ${DIFF[p.difficulty].cls}">${DIFF[p.difficulty].label}</span>
        </div>`;
      })
      .join("");
    toast("盲盒已生成 🎲");
  }

  /* ============================================================
   * 模块四：数据馆
   * ============================================================ */
  function renderStats() {
    const players = Store.getPlayers();
    const stats = players.map((p) => Store.tagStats(p.id));
    const allTags = {};
    stats.forEach((m) => Object.keys(m).forEach((t) => (allTags[t] = (allTags[t] || 0) + m[t])));
    const labels = Object.keys(allTags)
      .sort((a, b) => allTags[b] - allTags[a])
      .slice(0, 8);
    const max = Math.max(1, ...labels.map((t) => Math.max(...stats.map((m) => m[t] || 0))));
    const series = players.map((p, i) => ({
      name: p.name,
      color: p.color,
      values: labels.map((t) => (stats[i][t] || 0) / max)
    }));
    Charts.radar($("#radar"), { labels, series });

    // 热力墙：当年每日双方合计饱和度
    const year = new Date().getFullYear();
    const dataByDate = {};
    const data = JSON.parse(localStorage.getItem("leetcode_duel_v1"));
    Object.keys(data.checkins || {}).forEach((date) => {
      if (!date.startsWith(String(year))) return;
      let got = 0;
      ["p1", "p2"].forEach((pid) => {
        const d = data.checkins[date][pid];
        if (d) {
          const t = Store.totals(d.problems);
          got += Math.min(t.easy, 5) + Math.min(t.medium, 3) + Math.min(t.hard, 1);
        }
      });
      dataByDate[date] = Math.min(1, got / 16); // 双人目标 16
    });
    Charts.heatmap($("#heatmap"), { year, dataByDate });
  }

  /* ============================================================
   * 模块五：提醒台 + 自动播报
   * ============================================================ */
  function renderAlert() {
    const s = Store.getSettings();
    $("#wh-wechat").value = s.webhooks.wechat || "";
    $("#wh-feishu").value = s.webhooks.feishu || "";
    $("#wh-telegram").value = s.webhooks.telegram || "";
    $("#btLabel").textContent = s.broadcastTime || "21:00";
    const done = s.lastBroadcast === today;
    $("#broadcastStatus").textContent = done
      ? "✅ 今晚已播报"
      : `⏰ 将于 ${s.broadcastTime} 自动播报（需保持本页打开）`;
  }

  function saveWebhooks() {
    Store.setSettings({
      webhooks: {
        wechat: $("#wh-wechat").value.trim(),
        feishu: $("#wh-feishu").value.trim(),
        telegram: $("#wh-telegram").value.trim()
      }
    });
    renderAlert();
    toast("提醒配置已保存", "ok");
  }

  function buildSummary() {
    const players = Store.getPlayers();
    let lines = [`【LeetCode 双人对决 · ${today} 打卡播报】`];
    players.forEach((p) => {
      const t = Store.totals(Store.getPlayerDay(today, p.id).problems);
      const met = Store.metTarget(t);
      lines.push(
        `${met ? "✅" : "❌"} ${p.name}：简单 ${t.easy}/5，中等 ${t.medium}/2，困难 ${t.hard}/1，共 ${t.total} 道${met ? "" : "（未达标！）"}`
      );
    });
    return lines.join("\n");
  }

  async function broadcast(force) {
    const s = Store.getSettings();
    const urls = [s.webhooks.wechat, s.webhooks.feishu, s.webhooks.telegram].filter(Boolean);
    if (!urls.length) {
      if (force) toast("请先填写至少一个 Webhook 地址", "err");
      return;
    }
    const text = buildSummary();
    let ok = 0;
    for (const url of urls) {
      try {
        const body = url.includes("telegram.org")
          ? { text }
          : { msgtype: "text", text: { content: text } };
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (r.ok) ok++;
        else console.warn("webhook 返回", r.status, await r.text());
      } catch (e) {
        console.warn("webhook 发送失败", e);
      }
    }
    Store.setSettings({ lastBroadcast: today });
    renderAlert();
    toast(force ? `已播报到 ${ok}/${urls.length} 个机器人` : `自动播报完成（${ok}/${urls.length}）`, ok ? "ok" : "err");
  }

  // 定时检查：21:00 播报 + 23:59 结算违约
  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const cur = hh + ":" + mm;
    const s = Store.getSettings();
    // 自动播报
    if (cur === (s.broadcastTime || "21:00") && s.lastBroadcast !== today) {
      broadcast(false);
    }
    // 23:59 结算违约
    if (hh === "23" && mm === "59" && !settledToday) {
      const trig = Store.settleDay(today);
      settledToday = true;
      if (trig.length) {
        toast("⏰ 23:59 结算：有玩家未达标已被扣分", "err");
        if (currentTab === "arena") renderArena();
      }
      renderChips();
    }
    if (cur !== "23:59") settledToday = false;
  }

  /* ============================================================
   * 标签切换
   * ============================================================ */
  function showTab(tab) {
    currentTab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
    if (tab === "checkin") renderCheckin();
    if (tab === "arena") renderArena();
    if (tab === "review") renderReview();
    if (tab === "stats") renderStats();
    if (tab === "alert") renderAlert();
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function init() {
    Store.load();
    renderChips();
    bindAddForms();

    $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

    $("#btnReset").addEventListener("click", () => {
      if (confirm("确定重置全部数据？此操作不可撤销。")) {
        Store.reset();
        renderChips();
        showTab("checkin");
        toast("已重置为初始零数据", "ok");
      }
    });
    $("#btnSettle").addEventListener("click", () => {
      const trig = Store.settleDay(today);
      renderArena();
      renderChips();
      toast(trig.length ? `结算完成，${trig.length} 位玩家未达标被扣分` : "今日双方均已达标，无需扣分", trig.length ? "err" : "ok");
    });
    $("#btnDuelSave").addEventListener("click", () => {
      const title = $("#duelTitle").value.trim();
      if (!title) return toast("请填写竞速题目", "err");
      const duel = { title, p1: {}, p2: {} };
      $$("#duelRows .duel-row").forEach((row) => {
        const pid = row.dataset.pid;
        duel[pid] = {
          time: +row.querySelector(".d-time").value || 0,
          beats: +row.querySelector(".d-beats").value || 0
        };
      });
      Store.setDuel(today, duel);
      renderDuel();
      toast("竞速结果已保存", "ok");
    });
    $("#btnBlindBox").addEventListener("click", generateBlindBox);

    $("#btnSaveWh").addEventListener("click", saveWebhooks);
    $("#btnTestWh").addEventListener("click", () => broadcast(true));

    $("#modalClose").addEventListener("click", () => ($("#modal").hidden = true));
    $("#modal").addEventListener("click", (e) => {
      if (e.target.id === "modal") $("#modal").hidden = true;
    });

    showTab("checkin");
    setInterval(tick, 30 * 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
