/* ============================================================
 * markdown.js — 轻量、安全（先转义）的 Markdown -> HTML
 * 支持：标题、加粗、斜体、行内代码、代码块、无序/有序列表、链接、引用、分割线
 * 暴露 window.MD.render(text)
 * ============================================================ */
(function () {
  "use strict";

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inline(text) {
    // 行内代码
    text = text.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    // 链接 [t](u)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
      const safe = /^(https?:|mailto:|\/)/i.test(u) ? u : "#";
      return `<a href="${safe}" target="_blank" rel="noopener">${t}</a>`;
    });
    // 加粗
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // 斜体
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return text;
  }

  function render(src) {
    if (!src) return "";
    const lines = escapeHtml(src).split(/\r?\n/);
    let html = "";
    let i = 0;
    let inCode = false;
    let codeBuf = [];
    let listType = null; // ul / ol
    let listBuf = [];

    function flushList() {
      if (listType) {
        html += `<${listType}>` + listBuf.join("") + `</${listType}>`;
        listBuf = [];
        listType = null;
      }
    }

    while (i < lines.length) {
      const line = lines[i];

      // 代码块 ```
      if (/^```/.test(line.trim())) {
        if (inCode) {
          html += `<pre class="md-pre"><code>${codeBuf.join("\n")}</code></pre>`;
          codeBuf = [];
          inCode = false;
        } else {
          flushList();
          inCode = true;
        }
        i++;
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        i++;
        continue;
      }

      const trimmed = line.trim();

      if (trimmed === "") {
        flushList();
        i++;
        continue;
      }
      // 分割线
      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        flushList();
        html += "<hr/>";
        i++;
        continue;
      }
      // 标题
      const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushList();
        const lvl = h[1].length;
        html += `<h${lvl} class="md-h md-h${lvl}">${inline(h[2])}</h${lvl}>`;
        i++;
        continue;
      }
      // 引用
      const q = trimmed.match(/^>\s?(.*)$/);
      if (q) {
        flushList();
        html += `<blockquote class="md-quote">${inline(q[1])}</blockquote>`;
        i++;
        continue;
      }
      // 无序列表
      const ul = trimmed.match(/^[-*]\s+(.*)$/);
      if (ul) {
        if (listType && listType !== "ul") flushList();
        listType = "ul";
        listBuf.push(`<li>${inline(ul[1])}</li>`);
        i++;
        continue;
      }
      // 有序列表
      const ol = trimmed.match(/^\d+\.\s+(.*)$/);
      if (ol) {
        if (listType && listType !== "ol") flushList();
        listType = "ol";
        listBuf.push(`<li>${inline(ol[1])}</li>`);
        i++;
        continue;
      }
      // 普通段落
      flushList();
      html += `<p>${inline(line)}</p>`;
      i++;
    }
    flushList();
    if (inCode) html += `<pre class="md-pre"><code>${codeBuf.join("\n")}</code></pre>`;
    return html;
  }

  window.MD = { render, escapeHtml };
})();
