// Vercel serverless 入口：把 server.js 导出的 handler 直接作为函数导出。
// vercel.json 中 /api(/.*)? 的全部请求都会 rewrite 到这里。
module.exports = require("../server.js");
