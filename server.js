#!/usr/bin/env node
/* ============================================================
 * server.js — LeetCode 打卡平台后端（零依赖，Node >= 18）
 *   node server.js  →  http://localhost:3000
 * 数据保存在 data/db.json（无数据库）
 * ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

/* ---------------- 存储 ---------------- */
let db = {
  users: [],        // {id, name, nameLower, salt, passHash, leetcodeId, createdAt, lastLoginAt}
  sessions: {},     // token -> {userId, createdAt}
  records: {},      // userId -> [ {id, title, titleSlug, difficulty, tags, timeSpent, beats, code, note, source, timestamp, date, submissionId} ]
  profiles: {},     // userId -> {totalSolved, easy, medium, hard, ranking, updatedAt}
  syncedIds: {}     // userId -> [已入库的力扣提交 id]
};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } catch (e) { console.error("读取数据失败，使用空库", e.message); }
}
let saveTimer = null;
function saveDb() {
  // 防抖落盘
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db));
    } catch (e) { console.error("保存数据失败", e.message); }
  }, 150);
}

/* ---------------- 工具 ---------------- */
const DIFF = { EASY: "easy", MEDIUM: "medium", HARD: "hard" };
const TARGET = { easy: 5, medium: 2, hard: 1 };

function nowStr() { return new Date().toISOString(); }
function uid() { return crypto.randomBytes(8).toString("hex"); }
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString("hex"); }
function bjDate(ms) {
  // 统一按北京时间（UTC+8）归日期
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function todayBj() { return bjDate(Date.now()); }
function metTarget(t) { return t.easy >= TARGET.easy && t.medium >= TARGET.medium && t.hard >= TARGET.hard; }
function totals(records) {
  const t = { easy: 0, medium: 0, hard: 0, total: 0 };
  records.forEach((r) => {
    if (t[r.difficulty] != null) t[r.difficulty]++;
    t.total++;
  });
  return t;
}
function calcStreak(records) {
  const byDate = {};
  records.forEach((r) => { byDate[r.date] = true; });
  let n = 0;
  let cur = todayBj();
  if (!byDate[cur]) { // 今天没打卡则从昨天算
    const d = new Date(cur + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    cur = d.toISOString().slice(0, 10);
  }
  while (byDate[cur]) { n++; cur = dateAdd(cur, -1); }
  return n;
}
function dateAdd(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function publicUser(u) {
  return { id: u.id, name: u.name, leetcodeId: u.leetcodeId, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
}

/* ---------------- 力扣 GraphQL 代理（leetcode.cn） ---------------- */
const LC_URL = "https://leetcode.cn/graphql/";

async function lcFetch(query, variables) {
  const res = await fetch(LC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Referer": "https://leetcode.cn/",
      "Origin": "https://leetcode.cn",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error("力扣接口 HTTP " + res.status);
  const data = await res.json();
  if (data.errors) throw new Error("力扣接口错误: " + (data.errors[0]?.message || "unknown"));
  return data.data;
}

async function syncUser(user) {
  if (!user.leetcodeId) throw new Error("请先在设置中填写力扣 ID");
  const slug = user.leetcodeId;

  // 1) 最近提交（leetcode.cn 返回最近 30 条，status 以 A_ 开头为通过）
  const d = await lcFetch(
    `query($u:String!){ recentSubmissions(userSlug:$u){ id status submitTime question{ questionId translatedTitle titleSlug difficulty topicTags{ translatedName } } } }`,
    { u: slug }
  );
  const subs = (d && d.recentSubmissions) || [];
  if (!subs.length) throw new Error("力扣未返回该用户的提交记录，请检查 ID 是否正确");
  const acSubs = subs.filter((s) => String(s.status || "").startsWith("A_"));
  const synced = new Set(db.syncedIds[user.id] || []);
  const fresh = acSubs.filter((s) => !synced.has(s.id));

  // 按「题目+日期」去重：同一天同一题只保留一条（力扣多次提交很常见）
  const existingKeys = new Set(
    (db.records[user.id] || [])
      .filter((r) => r.titleSlug)
      .map((r) => r.titleSlug + "|" + r.date)
  );

  const newRecords = [];
  fresh.forEach((s) => {
    const q = s.question || {};
    const slug = q.titleSlug || "";
    const date = bjDate(s.submitTime * 1000);
    const key = slug + "|" + date;
    if (slug && existingKeys.has(key)) return;
    if (slug) existingKeys.add(key);
    newRecords.push({
      id: uid(),
      title: (q.questionId ? q.questionId + ". " : "") + (q.translatedTitle || slug || "未知题目"),
      titleSlug: slug,
      difficulty: DIFF[String(q.difficulty || "").toUpperCase()] || "easy",
      tags: (q.topicTags || []).map((t) => t.translatedName).filter(Boolean),
      timeSpent: 0,
      beats: 0,
      code: "",
      note: "",
      source: "leetcode",
      timestamp: s.submitTime * 1000,
      date,
      submissionId: s.id
    });
  });
  if (!db.records[user.id]) db.records[user.id] = [];
  db.records[user.id].push(...newRecords);
  const allIds = new Set([...synced, ...fresh.map((s) => s.id)]);
  db.syncedIds[user.id] = Array.from(allIds).slice(-500);

  // 2) 力扣账号总题数快照
  try {
    const p = await lcFetch(
      `query($u:String!){ userProfileUserQuestionProgress(userSlug:$u){ numAcceptedQuestions{ difficulty count } } }`,
      { u: slug }
    );
    const nums = (p && p.userProfileUserQuestionProgress && p.userProfileUserQuestionProgress.numAcceptedQuestions) || [];
    const prof = { totalSolved: 0, easy: 0, medium: 0, hard: 0, ranking: 0, updatedAt: nowStr() };
    nums.forEach((n) => {
      if (DIFF[n.difficulty]) prof[DIFF[n.difficulty]] = n.count;
      prof.totalSolved += n.count;
    });
    db.profiles[user.id] = prof;
  } catch (e) { /* 快照失败不影响 */ }
  saveDb();
  return { added: newRecords.length, records: newRecords };
}

/* ---------------- API 处理 ---------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1024 * 1024) { reject(new Error("请求体过大")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error("JSON 格式错误")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function auth(req) {
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token || !db.sessions[token]) return null;
  const user = db.users.find((u) => u.id === db.sessions[token].userId);
  return user || null;
}

async function handleApi(req, res, pathname, query) {
  const method = req.method;

  /* ---- 注册 ---- */
  if (pathname === "/api/register" && method === "POST") {
    const { name, password, leetcodeId } = await readBody(req);
    const n = String(name || "").trim();
    if (n.length < 1 || n.length > 20) return sendJson(res, 400, { error: "名字需为 1-20 个字符" });
    if (String(password || "").length < 4) return sendJson(res, 400, { error: "密码至少 4 位" });
    if (db.users.some((u) => u.nameLower === n.toLowerCase())) return sendJson(res, 409, { error: "该名字已被注册" });
    const salt = crypto.randomBytes(16).toString("hex");
    const user = {
      id: uid(), name: n, nameLower: n.toLowerCase(), salt,
      passHash: hashPassword(password, salt),
      leetcodeId: String(leetcodeId || "").trim(),
      createdAt: nowStr(), lastLoginAt: nowStr()
    };
    db.users.push(user);
    db.records[user.id] = [];
    const token = crypto.randomBytes(24).toString("hex");
    db.sessions[token] = { userId: user.id, createdAt: nowStr() };
    saveDb();
    return sendJson(res, 200, { token, user: publicUser(user) });
  }

  /* ---- 登录 ---- */
  if (pathname === "/api/login" && method === "POST") {
    const { name, password } = await readBody(req);
    const u = db.users.find((x) => x.nameLower === String(name || "").trim().toLowerCase());
    if (!u) return sendJson(res, 401, { error: "用户不存在" });
    if (hashPassword(password || "", u.salt) !== u.passHash) return sendJson(res, 401, { error: "密码错误" });
    u.lastLoginAt = nowStr();
    const token = crypto.randomBytes(24).toString("hex");
    db.sessions[token] = { userId: u.id, createdAt: nowStr() };
    saveDb();
    return sendJson(res, 200, { token, user: publicUser(u) });
  }

  /* ---- 退出 ---- */
  if (pathname === "/api/logout" && method === "POST") {
    const h = req.headers["authorization"] || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token && db.sessions[token]) { delete db.sessions[token]; saveDb(); }
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 以下需要登录 ---- */
  const me = auth(req);
  if (!me) return sendJson(res, 401, { error: "请先登录" });

  if (pathname === "/api/me" && method === "GET") {
    const recs = db.records[me.id] || [];
    const today = todayBj();
    const todayRecs = recs.filter((r) => r.date === today);
    return sendJson(res, 200, {
      user: publicUser(me),
      profile: db.profiles[me.id] || null,
      target: TARGET,
      today: { date: today, totals: totals(todayRecs), records: todayRecs },
      streak: calcStreak(recs),
      cumulative: totals(recs)
    });
  }

  if (pathname === "/api/settings" && method === "POST") {
    const { leetcodeId } = await readBody(req);
    const newId = String(leetcodeId || "").trim();
    // 力扣 ID 一经绑定不可随意更改（防作弊）
    if (me.leetcodeId && newId !== me.leetcodeId) {
      return sendJson(res, 403, { error: "力扣 ID 已绑定，不可修改" });
    }
    me.leetcodeId = newId;
    saveDb();
    return sendJson(res, 200, { user: publicUser(me) });
  }

  /* ---- 修改密码 ---- */
  if (pathname === "/api/password" && method === "POST") {
    const { oldPassword, newPassword } = await readBody(req);
    if (String(newPassword || "").length < 4) return sendJson(res, 400, { error: "新密码至少 4 位" });
    if (hashPassword(oldPassword || "", me.salt) !== me.passHash) return sendJson(res, 403, { error: "原密码错误" });
    me.salt = crypto.randomBytes(16).toString("hex");
    me.passHash = hashPassword(newPassword, me.salt);
    // 改密后作废其他会话，仅保留当前
    const cur = (req.headers["authorization"] || "").slice(7);
    Object.keys(db.sessions).forEach((t) => {
      if (db.sessions[t].userId === me.id && t !== cur) delete db.sessions[t];
    });
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 导出数据（整库备份下载） ---- */
  if (pathname === "/api/backup" && method === "GET") {
    const payload = JSON.stringify(db);
    const fname = "leetcode-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store"
    });
    return res.end(payload);
  }

  /* ---- 导入数据（整库恢复） ---- */
  if (pathname === "/api/restore" && method === "POST") {
    const obj = await readBody(req);
    if (!obj || !Array.isArray(obj.users)) {
      return sendJson(res, 400, { error: "备份文件格式不正确" });
    }
    const merged = Object.assign(
      { users: [], sessions: {}, records: {}, profiles: {}, syncedIds: {} },
      obj
    );
    const meId = me.id;
    const exists = merged.users.find((u) => u.id === meId);
    if (!exists) return sendJson(res, 403, { error: "该备份不含当前账号，无法恢复" });
    const oldToken = (req.headers["authorization"] || "").slice(7);
    merged.sessions[oldToken] = { userId: meId, createdAt: nowStr() };
    db = merged;
    saveDb();
    return sendJson(res, 200, { ok: true, token: oldToken, user: publicUser(exists) });
  }

  /* ---- 手动打卡 ---- */
  if (pathname === "/api/records" && method === "POST") {
    const b = await readBody(req);
    const title = String(b.title || "").trim();
    if (!title) return sendJson(res, 400, { error: "请填写题目标题" });
    if (!DIFF_EASY_OK(b.difficulty)) return sendJson(res, 400, { error: "难度参数错误" });
    const rec = {
      id: uid(),
      title,
      titleSlug: "",
      difficulty: b.difficulty,
      tags: Array.isArray(b.tags) ? b.tags.map(String).slice(0, 10) : [],
      timeSpent: Math.max(0, +b.timeSpent || 0),
      beats: Math.min(100, Math.max(0, +b.beats || 0)),
      code: String(b.code || "").slice(0, 20000),
      note: String(b.note || "").slice(0, 20000),
      source: "manual",
      timestamp: Date.now(),
      date: todayBj()
    };
    if (!db.records[me.id]) db.records[me.id] = [];
    db.records[me.id].push(rec);
    saveDb();
    return sendJson(res, 200, { record: rec, today: { totals: totals(db.records[me.id].filter((r) => r.date === rec.date)) } });
  }

  if (pathname === "/api/records" && method === "GET") {
    // 自己的全部记录（供个人热力图/雷达）
    const recs = db.records[me.id] || [];
    return sendJson(res, 200, { records: recs });
  }

  if (pathname.startsWith("/api/records/") && method === "DELETE") {
    const id = pathname.split("/")[3];
    db.records[me.id] = (db.records[me.id] || []).filter((r) => r.id !== id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 力扣同步 ---- */
  if (pathname === "/api/sync" && method === "POST") {
    try {
      const result = await syncUser(me);
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 502, { error: e.message || "同步失败" });
    }
  }

  /* ---- 大屏聚合 ---- */
  if (pathname === "/api/board" && method === "GET") {
    const board = buildBoard(query.user);
    return sendJson(res, 200, board);
  }

  /* ---- 电子书：目录树 ---- */
  if (pathname === "/api/book/toc" && method === "GET") {
    try {
      const toc = await bookToc();
      return sendJson(res, 200, toc);
    } catch (e) {
      return sendJson(res, 502, { error: "电子书目录获取失败: " + e.message });
    }
  }

  /* ---- 电子书：正文 ---- */
  if (pathname === "/api/book/page" && method === "GET") {
    const p = query.get("path") || "";
    const zh = query.get("zh") === "1";
    try {
      const page = await bookPage(p, { zh });
      return sendJson(res, 200, page);
    } catch (e) {
      return sendJson(res, 502, { error: "页面获取失败: " + e.message });
    }
  }

  /* ---- 电子书：预翻译进度 ---- */
  if (pathname === "/api/book/progress" && method === "GET") {
    let cached = 0;
    try {
      if (fs.existsSync(ZH_CACHE_DIR)) cached = fs.readdirSync(ZH_CACHE_DIR).filter((f) => f.endsWith(".html")).length;
    } catch (e) { /* 忽略 */ }
    return sendJson(res, 200, {
      running: prewarm.running,
      total: prewarm.total || cached,
      done: prewarm.running ? prewarm.done : cached,
      failed: prewarm.failed,
      cached
    });
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

function DIFF_EASY_OK(d) { return d === "easy" || d === "medium" || d === "hard"; }

function buildBoard(filterUserId) {
  const today = todayBj();
  const users = [];
  const heatAll = {};         // date -> count（全站）
  const heatByUser = {};      // userId -> {date: count}
  const detailAll = {};       // date -> [ {name, title, difficulty} ]（tooltip 明细）
  const recent = [];

  db.users.forEach((u) => {
    const recs = db.records[u.id] || [];
    const t = totals(recs);
    const byDate = {};
    const tagMap = {};
    recs.forEach((r) => {
      byDate[r.date] = (byDate[r.date] || 0) + 1;
      (r.tags || []).forEach((tg) => (tagMap[tg] = (tagMap[tg] || 0) + 1));
      heatAll[r.date] = (heatAll[r.date] || 0) + 1;
      if (!heatByUser[u.id]) heatByUser[u.id] = {};
      heatByUser[u.id][r.date] = (heatByUser[u.id][r.date] || 0) + 1;
      if (!detailAll[r.date]) detailAll[r.date] = [];
      detailAll[r.date].push({ name: u.name, title: r.title, difficulty: r.difficulty, ts: r.timestamp });
      recent.push({ name: u.name, title: r.title, difficulty: r.difficulty, ts: r.timestamp, date: r.date, source: r.source });
    });
    const tagsTop = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
    users.push({
      id: u.id, name: u.name, leetcodeId: u.leetcodeId, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      totalAC: t.total, easy: t.easy, medium: t.medium, hard: t.hard,
      daysActive: Object.keys(byDate).length,
      streak: calcStreak(recs),
      todayCount: byDate[today] || 0,
      todayMet: metTarget(totals(recs.filter((r) => r.date === today))),
      profile: db.profiles[u.id] || null,
      tagsTop
    });
  });

  users.sort((a, b) => b.totalAC - a.totalAC || b.streak - a.streak);
  recent.sort((a, b) => b.ts - a.ts);

  const todayTotals = totals([].concat(...db.users.map((u) => (db.records[u.id] || []).filter((r) => r.date === today))));

  return {
    generatedAt: nowStr(),
    today,
    summary: {
      userCount: db.users.length,
      totalAC: users.reduce((s, u) => s + u.totalAC, 0),
      todayAC: todayTotals.total,
      activeToday: users.filter((u) => u.todayCount > 0).length,
      metToday: users.filter((u) => u.todayMet).length
    },
    users,
    heatAll,
    heatByUser,
    detailAll: Object.fromEntries(Object.entries(detailAll).map(([d, arr]) => [d, arr.slice(-8)])),
    recent: recent.slice(0, 50)
  };
}

/* ---------------- 电子书代理（halfrost LeetCode Cookbook） ---------------- */
const BOOK_BASE = "https://books.halfrost.com/leetcode/en/";
const bookCache = new Map(); // key: "toc" | "page:<path>" -> 缓存结果

/* 章节/节 中文翻译表 */
const ZH_SECTION = {
  "Chapter 1 Prologue": "第 1 章 · 序言",
  "Chapter 2 Algorithm Topics": "第 2 章 · 算法专题",
  "Chapter 3 Some Templates": "第 3 章 · 常用模板",
  "Chapter 4 LeetCode Solutions": "第 4 章 · LeetCode 题解",
  "1.1 Data Structure Knowledge": "1.1 数据结构知识",
  "1.2 Algorithm Knowledge": "1.2 算法知识",
  "1.3 Time Complexity": "1.3 时间复杂度",
  "2.01 Array": "2.01 数组",
  "2.02 String": "2.02 字符串",
  "2.03 Two Pointers": "2.03 双指针",
  "2.04 Linked List": "2.04 链表",
  "2.05 Stack": "2.05 栈",
  "2.06 Tree": "2.06 树",
  "2.07 Dynamic Programming": "2.07 动态规划",
  "2.08 Backtracking": "2.08 回溯",
  "2.09 Depth First Search": "2.09 深度优先搜索",
  "2.10 Breadth First Search": "2.10 广度优先搜索",
  "2.11 Binary Search": "2.11 二分查找",
  "2.12 Math": "2.12 数学",
  "2.13 Hash Table": "2.13 哈希表",
  "2.14 Sorting": "2.14 排序",
  "2.15 Bit Manipulation": "2.15 位运算",
  "2.16 Union Find": "2.16 并查集",
  "2.17 Sliding Window": "2.17 滑动窗口",
  "2.18 Segment Tree": "2.18 线段树",
  "2.19 Binary Indexed Tree": "2.19 树状数组",
  "3.1 Segment Tree": "3.1 线段树",
  "3.2 UnionFind": "3.2 并查集",
  "3.3 LRUCache": "3.3 LRU 缓存",
  "3.4 LFUCache": "3.4 LFU 缓存",
  "3.5 Binary Indexed Tree": "3.5 树状数组"
};

/* 力扣题库 slug -> 中文题名（分页拉取，磁盘缓存） */
const SLUGMAP_FILE = path.join(DATA_DIR, "slugmap.json");
let slugTitleMap = null;

async function buildSlugMap() {
  if (slugTitleMap) return slugTitleMap;
  try {
    if (fs.existsSync(SLUGMAP_FILE)) {
      slugTitleMap = JSON.parse(fs.readFileSync(SLUGMAP_FILE, "utf8"));
      return slugTitleMap;
    }
  } catch (e) { /* 重建 */ }
  const map = {};
  const Q = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
    problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
      total
      questions { titleSlug titleCn title }
    }
  }`;
  const LIMIT = 100;
  let skip = 0, total = Infinity;
  while (skip < total) {
    const batch = [];
    for (let i = 0; i < 5 && skip + i * LIMIT < total; i++) {
      batch.push(lcFetch(Q, { categorySlug: "", limit: LIMIT, skip: skip + i * LIMIT, filters: {} }));
    }
    const results = await Promise.all(batch);
    for (const d of results) {
      const ql = d && d.problemsetQuestionList;
      if (!ql) continue;
      total = ql.total;
      (ql.questions || []).forEach((q) => {
        const cn = q.titleCn || q.title;
        if (cn) map[q.titleSlug] = cn;
      });
    }
    skip += batch.length * LIMIT;
  }
  slugTitleMap = map;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SLUGMAP_FILE, JSON.stringify(map));
  } catch (e) { /* 忽略 */ }
  console.log(`题库中文题名映射已构建：${Object.keys(map).length} 条`);
  return map;
}

/* 目录条目中文名 */
function zhBookTitle(rawTitle, relPath, slugMap) {
  const t = String(rawTitle || "").replace(/\s+/g, " ").trim();
  if (ZH_SECTION[t]) return ZH_SECTION[t];
  if (/^\d{4}~\d{4}$/.test(t)) return "第 " + t + " 题";
  const mm = t.match(/^(\d{4})\.\s*(.+)$/);
  if (mm && slugMap) {
    const slug = relPath.split("/").pop().replace(/^\d{4}\.?/, "").toLowerCase();
    const cn = slugMap[slug];
    if (cn) return mm[1] + ". " + cn;
  }
  return t;
}

async function bookFetch(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// 解析目录页：章(深度1) -> 节(深度2) -> 题目(深度3)，标题全部中文化
async function bookToc() {
  if (bookCache.has("toc")) return bookCache.get("toc");
  const html = await bookFetch(BOOK_BASE);
  const navM = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/);
  if (!navM) throw new Error("目录结构未识别");
  // 题库中文题名映射（首次约需数秒，之后磁盘缓存秒开）
  const slugMap = await buildSlugMap().catch((e) => {
    console.warn("题库映射构建失败，题目名将保持英文:", e.message);
    return null;
  });
  const linkRe = /href="?https:\/\/books\.halfrost\.com\/leetcode\/en\/([^"\s>]+)"?[^>]*>([\s\S]*?)<\/a>/g;
  const chapters = new Map(); // depth1 path -> {title, sections: []}
  const sections = new Map(); // depth2 path -> {title, pages: []}
  const allPaths = new Set();
  let m;
  while ((m = linkRe.exec(navM[0]))) {
    const rel = m[1].replace(/\/+$/, "");
    const rawTitle = stripTags(m[2]).replace(/✅/g, "").trim();
    if (!rel || !rawTitle) continue;
    allPaths.add(rel);
    const title = zhBookTitle(rawTitle, rel, slugMap);
    const depth = rel.split("/").length;
    if (depth === 1) {
      if (!chapters.has(rel)) chapters.set(rel, { title, path: rel, sections: [] });
    } else if (depth === 2) {
      if (!sections.has(rel)) {
        sections.set(rel, { title, path: rel, pages: [] });
        const chap = chapters.get(rel.split("/")[0]);
        if (chap) chap.sections.push(sections.get(rel));
      }
    } else if (depth >= 3) {
      const secKey = rel.split("/").slice(0, 2).join("/");
      let sec = sections.get(secKey);
      if (!sec) {
        // 导航缺少中间层时自动补建（如 ChapterFour/0001~0099）
        sec = { title: zhBookTitle(secKey.split("/")[1], secKey, slugMap), path: secKey, pages: [] };
        sections.set(secKey, sec);
        const chap = chapters.get(secKey.split("/")[0]);
        if (chap) chap.sections.push(sec);
      }
      sec.pages.push({ title, path: rel });
    }
  }
  const tree = Array.from(chapters.values()).map((c) => ({
    title: c.title,
    path: c.path,
    children: c.sections.map((s) => ({ title: s.title, path: s.path, children: s.pages }))
  }));
  const result = { source: BOOK_BASE, totalPages: allPaths.size, tree };
  bookCache.set("toc", result);
  return result;
}

// 抓取正文页：提取 article、清洗、链接重写
/* ---------------- 全文翻译（clients5 为主 + MyMemory 兜底 + 磁盘缓存） ---------------- */
const ZH_CACHE_DIR = path.join(DATA_DIR, "bookzhcache");
const crypto_ = require("crypto");

function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s || ""); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 翻译一小段文本：clients5（长块，快）优先，失败退 MyMemory（短块，有日配额）
async function c5Chunk(text) {
  try {
    const url = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=zh-CN&q=" + encodeURIComponent(text);
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    if (Array.isArray(j) && typeof j[0] === "string") return j[0];
    if (Array.isArray(j) && Array.isArray(j[0])) return j[0].map((x) => (typeof x === "string" ? x : x && x[0]) || "").join("");
    return null;
  } catch (e) { return null; }
}
async function mmChunk(text) {
  try {
    const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en|zh-CN";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    return t ? String(t).split(/\n+/)[0].trim() : null;
  } catch (e) { return null; }
}

async function translateText(text) {
  if (!text || !text.trim()) return text;
  // 句子边界切分（clients5 单次可 ~4500 字符；MyMemory 兜底时再细切 480）
  const MAX = 4500;
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + MAX, text.length);
    if (end < text.length) {
      const candidates = [". ", "!\n", "?\n", ";\n", "\n", ", ", " "].map((s) => text.lastIndexOf(s, end));
      const br = Math.max(...candidates);
      if (br > i + 80) end = br + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  const out = [];
  const CONC = 3;
  for (let k = 0; k < chunks.length; k += CONC) {
    const batch = chunks.slice(k, k + CONC).map(async (c) => {
      // clients5 两次尝试
      let t = await c5Chunk(c);
      if (t === null || !hasCJK(t)) t = await c5Chunk(c);
      // MyMemory 兜底（480 字符细切）
      if (t === null || !hasCJK(t)) {
        const subs = [];
        let j = 0;
        while (j < c.length) {
          let e = Math.min(j + 480, c.length);
          if (e < c.length) {
            const br = Math.max(c.lastIndexOf(". ", e), c.lastIndexOf("\n", e), c.lastIndexOf(" ", e));
            if (br > j + 60) e = br + 1;
          }
          subs.push(c.slice(j, e));
          j = e;
        }
        const trs = [];
        for (let m = 0; m < subs.length; m += 3) {
          trs.push(...(await Promise.all(subs.slice(m, m + 3).map(async (s) => (await mmChunk(s)) || s))));
        }
        t = trs.join("");
      }
      return t || c;
    });
    out.push(...(await Promise.all(batch)));
  }
  return out.join("");
}

async function translateHtmlToChinese(html) {
  // 1) 保护 <pre> 代码块（不翻译代码）
  const pres = [];
  let masked = html.replace(/<pre[\s\S]*?<\/pre>/g, (m) => {
    pres.push(m);
    return `@@PRE${pres.length - 1}@@`;
  });
  // 2) 用哨兵替换所有标签
  const tags = [];
  masked = masked.replace(/<[^>]+>/g, (tag) => {
    tags.push(tag);
    return `@@TAG${tags.length - 1}@@`;
  });
  // 3) 切分为「文本/索引/文本/...」交替；每个文本段内再按 PRE 占位符切分，PRE 段原样保留
  const parts = masked.split(/@@TAG(\d+)@@/);
  for (let k = 0; k < parts.length; k += 2) {
    if (parts[k] && parts[k].trim()) {
      const sub = parts[k].split(/(@@PRE\d+@@)/);
      for (let m = 0; m < sub.length; m += 2) {
        if (sub[m] && sub[m].trim()) sub[m] = await translateText(sub[m]);
      }
      parts[k] = sub.join("");
    }
  }
  // 4) 还原标签与代码块
  let out = "";
  for (let k = 0; k < parts.length; k += 2) {
    out += parts[k];
    if (k + 1 < parts.length) out += `@@TAG${parts[k + 1]}@@`;
  }
  out = out.replace(/@@TAG(\d+)@@/g, (_, i) => tags[+i]);
  out = out.replace(/@@PRE(\d+)@@/g, (_, i) => pres[+i]);
  return out;
}

const zhInflight = new Map(); // 并发去重：同一页面同时只翻译一次
async function getZhPage(relPath) {
  const key = "zh:" + relPath;
  if (bookCache.has(key)) return bookCache.get(key);
  if (zhInflight.has(key)) return zhInflight.get(key);
  const task = (async () => {
    if (!fs.existsSync(ZH_CACHE_DIR)) fs.mkdirSync(ZH_CACHE_DIR, { recursive: true });
    const hash = crypto_.createHash("sha1").update(relPath).digest("hex");
    const cacheFile = path.join(ZH_CACHE_DIR, hash + ".html");
    let zhHtml;
    if (fs.existsSync(cacheFile)) {
      zhHtml = fs.readFileSync(cacheFile, "utf8");
    } else {
      const orig = await bookPage(relPath);
      zhHtml = await translateHtmlToChinese(orig.html);
      // CJK 校验：翻译基本失败时（无中文字符）不写缓存，返回原文
      if (!hasCJK(zhHtml) || (zhHtml === orig.html)) {
        return { title: orig.title, path: relPath, source: BOOK_BASE + relPath + "/", html: orig.html, translated: false };
      }
      try { fs.writeFileSync(cacheFile, zhHtml); } catch (e) { /* 忽略 */ }
    }
    const h1 = zhHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const title = h1 ? stripTags(h1[1]).replace(/#$/, "").trim() : relPath.split("/").pop();
    const result = { title, path: relPath, source: BOOK_BASE + relPath + "/", html: zhHtml, translated: true };
    bookCache.set(key, result);
    return result;
  })();
  zhInflight.set(key, task);
  try { return await task; } finally { zhInflight.delete(key); }
}

/* ---------------- 后台全量预热：启动后自动翻译全部页面 ---------------- */
const prewarm = { running: false, total: 0, done: 0, failed: 0 };

async function prewarmBook() {
  if (prewarm.running) return;
  prewarm.running = true;
  try {
    const toc = await bookToc();
    const paths = [];
    toc.tree.forEach((c) => {
      paths.push(c.path);
      c.children.forEach((s) => {
        paths.push(s.path);
        s.children.forEach((p) => paths.push(p.path));
      });
    });
    prewarm.total = paths.length;
    const queue = [...paths];
    const N = 2; // 两个 worker，避免过猛
    async function worker() {
      while (queue.length) {
        const p = queue.shift();
        try {
          const r = await getZhPage(p);
          if (r && r.translated === false) prewarm.failed++;
        } catch (e) { prewarm.failed++; }
        prewarm.done++;
      }
    }
    await Promise.all(Array.from({ length: N }, worker));
    console.log(`书库预热完成：${prewarm.done}/${prewarm.total}，失败 ${prewarm.failed}`);
  } catch (e) {
    console.warn("书库预热中断:", e.message);
  }
  prewarm.running = false;
}

async function bookPage(relPath, opts) {
  relPath = String(relPath).replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9._~\/-]+$/.test(relPath)) throw new Error("非法路径");
  if (opts && opts.zh) return getZhPage(relPath);
  const key = "page:" + relPath;
  if (bookCache.has(key)) return bookCache.get(key);
  const html = await bookFetch(BOOK_BASE + relPath + "/");
  const art = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
  if (!art) throw new Error("页面结构未识别");
  let content = art[1];

  // 清洗：去脚本/事件/嵌入
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=[^\s>]+/gi, "");

  // 链接重写：
  // 1) 站内绝对链接 → 站内阅读路由 #b:path
  content = content.replace(/href="?https:\/\/books\.halfrost\.com\/leetcode\/en\/([^"\s>]+)"?/g, (m, p) => `href="#b:${p}"`);
  // 2) 相对链接 → 相对当前页解析后同样路由
  content = content.replace(/href="?(\.\.\/[^"\s>]+)"?/g, (m, p) => {
    const resolved = resolveRel(relPath, p);
    return `href="#b:${resolved}"`;
  });
  // 3) 站外 http 链接 → 新窗口打开
  content = content.replace(/<a ([^>]*href="?https?:\/\/[^"\s>]+"?(?![^>]*target))/g, '<a target="_blank" rel="noopener" $1');
  // 4) 图片相对路径 → 绝对
  content = content.replace(/src="?(\.\.\/[^"\s>]+|\.\/[^"\s>]+)"?/g, (m, p) => {
    return `src="${resolveAbs(relPath, p)}"`;
  });

  const h1 = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1 ? stripTags(h1[1]).replace(/#$/, "").trim() : relPath.split("/").pop();
  const result = { title, path: relPath, source: BOOK_BASE + relPath + "/", html: content, translated: false };
  bookCache.set(key, result);
  return result;
}

function resolveRel(base, rel) {
  // base: "ChapterFour/0001~0099/0001.Two-Sum"（文件路径，不含末尾/）
  const parts = base.split("/").slice(0, -1); // 上级目录
  rel.split("/").forEach((seg) => {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  });
  return parts.join("/").replace(/\/+$/, "");
}
function resolveAbs(base, rel) {
  return BOOK_BASE + resolveRel(base, rel);
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  let file = pathname;
  if (pathname === "/") file = "/login.html";
  else if (pathname === "/app" || pathname === "/app/") file = "/app.html";
  const filePath = path.normalize(path.join(ROOT, file));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

/* ---------------- 启动 ---------------- */
loadDb();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname, url.searchParams);
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error("请求处理错误:", e);
    return sendJson(res, 500, { error: "服务器内部错误" });
  }
});
server.listen(PORT, () => {
  console.log(`LeetCode 打卡平台已启动: http://localhost:${PORT}`);
  console.log(`数据文件: ${DB_FILE}`);
  // 启动 5 秒后开始后台全量预翻译书库（已缓存的页面会秒过）
  setTimeout(() => {
    prewarmBook().catch((e) => console.warn("预热任务异常:", e.message));
  }, 5000);
});
