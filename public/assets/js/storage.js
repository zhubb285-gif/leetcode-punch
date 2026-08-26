/* ============================================================
 * storage.js — 本地存储数据层（无数据库，localStorage 持久化）
 * 暴露全局对象 window.Store
 * ============================================================ */
(function () {
  "use strict";

  const KEY = "leetcode_duel_v1";

  // 每日目标：简单 >=5，中等 >=2（区间 2-3，超过算奖励），困难 >=1
  const TARGET = { easy: 5, medium: 2, hard: 1, mediumSoftMax: 3 };

  function defaultData() {
    return {
      players: [
        { id: "p1", name: "玩家一", leetcodeId: "", color: "#6ea8fe" },
        { id: "p2", name: "玩家二", leetcodeId: "", color: "#f5b14c" }
      ],
      // checkins[date][playerId] = { problems:[...], updatedAt }
      checkins: {},
      // notes[title] = { comments:[{by,text,ts}], likes:[playerId,...] }
      notes: {},
      // duels[date] = { title, p1:{time,beats}, p2:{time,beats} }
      duels: {},
      // penalties = [{date, playerId, reason, points}]
      penalties: [],
      // 虚拟积分
      points: { p1: 100, p2: 100 },
      // 设置
      settings: {
        webhooks: { wechat: "", feishu: "", telegram: "" },
        broadcastTime: "21:00",
        penaltyPoint: 10,
        lastBroadcast: "" // 已播报的日期
      }
    };
  }

  let data = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : defaultData();
    } catch (e) {
      data = defaultData();
    }
    // 形状兜底
    const d = defaultData();
    data.players = data.players && data.players.length === 2 ? data.players : d.players;
    data.checkins = data.checkins || {};
    data.notes = data.notes || {};
    data.duels = data.duels || {};
    data.penalties = data.penalties || [];
    data.points = data.points || { p1: 100, p2: 100 };
    data.settings = Object.assign(d.settings, data.settings || {});
    if (!data.settings.webhooks) data.settings.webhooks = { wechat: "", feishu: "", telegram: "" };
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error("保存失败", e);
    }
  }

  function reset() {
    data = defaultData();
    save();
  }

  /* ---------- 日期工具 ---------- */
  function todayStr() {
    const d = new Date();
    return fmt(d);
  }
  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function dateAdd(dateStr, delta) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return fmt(d);
  }

  /* ---------- 玩家 ---------- */
  function getPlayers() {
    return data.players;
  }
  function getPlayer(id) {
    return data.players.find((p) => p.id === id) || null;
  }
  function setPlayers(players) {
    data.players = players;
    save();
  }

  /* ---------- 打卡 ---------- */
  function getDay(dateStr) {
    return data.checkins[dateStr] || {};
  }
  function getPlayerDay(dateStr, pid) {
    const day = data.checkins[dateStr];
    if (!day || !day[pid]) return { problems: [] };
    return day[pid];
  }
  function setPlayerDay(dateStr, pid, problems) {
    if (!data.checkins[dateStr]) data.checkins[dateStr] = {};
    data.checkins[dateStr][pid] = { problems: problems || [], updatedAt: Date.now() };
    save();
  }
  function addProblem(dateStr, pid, problem) {
    const day = getPlayerDay(dateStr, pid);
    day.problems.push(
      Object.assign(
        { title: "", difficulty: "easy", tags: [], timeSpent: 0, beats: 0, code: "", note: "", createdAt: Date.now() },
        problem
      )
    );
    setPlayerDay(dateStr, pid, day.problems);
  }
  function removeProblem(dateStr, pid, idx) {
    const day = getPlayerDay(dateStr, pid);
    day.problems.splice(idx, 1);
    setPlayerDay(dateStr, pid, day.problems);
  }

  /* ---------- 统计 ---------- */
  function totals(problems) {
    const t = { easy: 0, medium: 0, hard: 0, total: 0 };
    (problems || []).forEach((p) => {
      if (p.difficulty === "easy") t.easy++;
      else if (p.difficulty === "medium") t.medium++;
      else if (p.difficulty === "hard") t.hard++;
      t.total++;
    });
    return t;
  }
  // 是否达标
  function metTarget(t) {
    return t.easy >= TARGET.easy && t.medium >= TARGET.medium && t.hard >= TARGET.hard;
  }
  function saturation(t) {
    // 目标饱和度 0..1+（封顶 1）
    const goal = TARGET.easy + TARGET.medium + TARGET.hard;
    const got = Math.min(t.easy, TARGET.easy) + Math.min(t.medium, TARGET.mediumSoftMax) + Math.min(t.hard, TARGET.hard);
    return Math.min(1, got / goal);
  }
  function cumulative(pid) {
    let total = 0;
    Object.keys(data.checkins).forEach((date) => {
      const d = data.checkins[date][pid];
      if (d) total += d.problems.length;
    });
    return total;
  }
  function difficultyDist(pid) {
    const t = { easy: 0, medium: 0, hard: 0 };
    Object.keys(data.checkins).forEach((date) => {
      const d = data.checkins[date][pid];
      if (d) d.problems.forEach((p) => {
        if (p.difficulty === "easy") t.easy++;
        else if (p.difficulty === "medium") t.medium++;
        else if (p.difficulty === "hard") t.hard++;
      });
    });
    return t;
  }
  function tagStats(pid) {
    const map = {};
    Object.keys(data.checkins).forEach((date) => {
      const d = data.checkins[date][pid];
      if (!d) return;
      d.problems.forEach((p) => {
        (p.tags || []).forEach((tag) => {
          map[tag] = (map[tag] || 0) + 1;
        });
        // 无标签也归入“未分类”
        if (!p.tags || p.tags.length === 0) map["未分类"] = (map["未分类"] || 0) + 1;
      });
    });
    return map;
  }
  function streak(pid) {
    // 从今天往前连续达标天数
    let n = 0;
    let cur = todayStr();
    // 若今天还没打卡，从昨天开始算（避免误判）
    const todayDay = getPlayerDay(cur, pid);
    if (!todayDay.problems.length) cur = dateAdd(cur, -1);
    while (true) {
      const day = getPlayerDay(cur, pid);
      if (!day.problems.length) break;
      if (metTarget(totals(day.problems))) n++;
      else break;
      cur = dateAdd(cur, -1);
    }
    return n;
  }

  /* ---------- 笔记 / 互评 ---------- */
  function getNote(title) {
    return data.notes[title] || { comments: [], likes: [] };
  }
  function addComment(title, by, text) {
    if (!data.notes[title]) data.notes[title] = { comments: [], likes: [] };
    data.notes[title].comments.push({ by, text, ts: Date.now() });
    save();
  }
  function toggleLike(title, pid) {
    if (!data.notes[title]) data.notes[title] = { comments: [], likes: [] };
    const likes = data.notes[title].likes;
    const i = likes.indexOf(pid);
    if (i >= 0) likes.splice(i, 1);
    else likes.push(pid);
    save();
  }

  /* ---------- 竞速 ---------- */
  function setDuel(dateStr, duel) {
    data.duels[dateStr] = duel;
    save();
  }
  function getDuel(dateStr) {
    return data.duels[dateStr] || null;
  }

  /* ---------- 惩罚池 / 积分 ---------- */
  function addPenalty(dateStr, pid, reason, points) {
    data.penalties.push({ date: dateStr, playerId: pid, reason: reason, points: points });
    data.points[pid] = (data.points[pid] || 100) - points;
    save();
  }
  function penaltyPoolTotal() {
    return data.penalties.reduce((s, p) => s + p.points, 0);
  }
  function settleDay(dateStr) {
    // 对未达标玩家扣分（同日同人只扣一次），返回触发惩罚的玩家列表
    const triggered = [];
    data.players.forEach((pl) => {
      const t = totals(getPlayerDay(dateStr, pl.id).problems);
      const already = data.penalties.some((p) => p.date === dateStr && p.playerId === pl.id);
      if (!metTarget(t) && !already) {
        addPenalty(dateStr, pl.id, "当日未达标", data.settings.penaltyPoint);
        triggered.push(pl.id);
      }
    });
    return triggered;
  }

  /* ---------- 设置 ---------- */
  function getSettings() {
    return data.settings;
  }
  function setSettings(patch) {
    data.settings = Object.assign({}, data.settings, patch);
    save();
  }
  function getPoints() {
    return data.points;
  }

  window.Store = {
    TARGET,
    load, save, reset,
    todayStr, fmt, dateAdd,
    getPlayers, getPlayer, setPlayers,
    getDay, getPlayerDay, setPlayerDay, addProblem, removeProblem,
    totals, metTarget, saturation, cumulative, difficultyDist, tagStats, streak,
    getNote, addComment, toggleLike,
    setDuel, getDuel,
    addPenalty, penaltyPoolTotal, settleDay,
    getSettings, setSettings, getPoints
  };
})();
