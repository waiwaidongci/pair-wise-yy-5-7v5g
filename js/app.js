/**
 * 页面操作层：DOM 渲染与所有交互。
 * 画布计算走 BrocadeCanvas，方案读写走 BrocadeStore，本文件只负责把两者接到页面上。
 */
(function () {
  "use strict";

  const C = window.BrocadeCanvas;
  const store = new window.BrocadeStore();

  const $ = function (sel) { return document.querySelector(sel); };

  let scheme = store.getActive();
  let stocks = store.getStocks();
  let active = 1;             // 当前选色
  let block = "dot";          // 当前纹样块
  let dragging = false;
  let dragPainted = false;    // 本次拖动是否已落过笔（每笔一次撤销栈）
  let undoStack = [];
  let redoStack = [];
  let dirty = false;
  let shortSet = new Set();   // 缺线色线索引（驱动色板/网格标记）
  let miss = null;            // 最近一次缺线盘点结果

  /* ---------- 状态维护 ---------- */

  function setDirty(v) {
    dirty = v;
    $("#saveState").textContent = v ? "有未保存改动" : "已保存";
    $("#saveState").className = v ? "warning" : "saved";
  }

  function pushUndo() {
    undoStack.push({ cells: scheme.cells.slice(), cols: scheme.cols, rows: scheme.rows });
    redoStack = [];
    if (undoStack.length > 50) undoStack.shift();
  }

  function restoreSnapshot(snap) {
    scheme.cells = snap.cells;
    scheme.cols = snap.cols;
    scheme.rows = snap.rows;
    $("#cols").value = snap.cols;
    $("#rows").value = snap.rows;
    setDirty(true);
    recomputeShort();
    renderGrid();
    renderStats();
    renderPreview();
    renderRisk();
    renderPaletteShort();
  }

  function persistCurrent() {
    const summary = C.schemeSummary(scheme.cells);
    scheme = store.update(scheme.id, {
      cells: scheme.cells,
      cols: scheme.cols,
      rows: scheme.rows,
      threads: summary.threads
    });
    setDirty(false);
  }

  function loadScheme(s) {
    scheme = s;
    $("#cols").value = s.cols;
    $("#rows").value = s.rows;
    undoStack = [];
    redoStack = [];
    active = Math.min(active, C.COLORS.length - 1);
    setDirty(false);
    renderAll();
  }

  /* ---------- 色线与缺线 ---------- */

  function recomputeShort() {
    miss = C.shortage(scheme.cells, stocks);
    shortSet = new Set(miss.items.map(function (it) { return it.colorIndex; }));
  }

  // 库存编辑后只刷新受缺线影响的部分，避免输入框失焦
  function refreshShortUI() {
    recomputeShort();
    renderPaletteShort();
    markGridShort();
    renderStats();
  }

  /* ---------- 渲染 ---------- */

  function renderAll() {
    recomputeShort();
    renderSchemeBar();
    renderPalette();
    renderGrid();
    renderStats();
    renderPreview();
    renderRisk();
  }

  function renderSchemeBar() {
    $("#schemeSelect").value = scheme.id;
    const options = store.list().map(function (s) {
      return '<option value="' + escapeAttr(s.id) + '"' +
        (s.id === scheme.id ? " selected" : "") + ">" +
        escapeHtml(s.name) + "（" + s.cols + "×" + s.rows + "）</option>";
    }).join("");
    $("#schemeSelect").innerHTML = options;
    $("#schemeName").value = scheme.name;
  }

  function renderPalette() {
    $("#palette").innerHTML = C.COLORS.map(function (color, i) {
      return '<div class="swatch-wrap">' +
        '<button type="button" class="swatch" data-color="' + i + '" style="background:' + color + '"></button>' +
        '<label class="stock-label">库存 ' +
          '<input type="number" min="0" data-stock="' + i + '" value="' + stocks[i] + '">' +
        '</label>' +
      '</div>';
    }).join("");
    renderPaletteShort();
  }

  function renderPaletteShort() {
    document.querySelectorAll("[data-color]").forEach(function (el) {
      const i = Number(el.dataset.color);
      el.classList.toggle("active", i === active);
      el.classList.toggle("short", shortSet.has(i));
    });
  }

  function renderGrid() {
    const g = $("#grid");
    g.style.gridTemplateColumns = "repeat(" + scheme.cols + ", 1fr)";
    g.innerHTML = scheme.cells.map(function (v, i) {
      return '<div class="cell' + (shortSet.has(v) ? " cell-short" : "") +
        '" data-i="' + i + '" style="background:' + C.COLORS[v] + '"></div>';
    }).join("");
  }

  function markGridShort() {
    $("#grid").querySelectorAll(".cell").forEach(function (el) {
      const i = Number(el.dataset.i);
      el.classList.toggle("cell-short", shortSet.has(scheme.cells[i]));
    });
  }

  function renderStats() {
    const counts = C.usageByColor(scheme.cells);
    $("#stats").innerHTML = counts.map(function (n, i) {
      const isShort = shortSet.has(i);
      const stock = stocks[i];
      return '<div class="stat' + (isShort ? " stat-short" : "") + '">' +
        '<span><span class="dot-color" style="background:' + C.COLORS[i] + '"></span> ' +
        "色线" + i + (isShort ? ' <span class="tag-short">缺 ' + (n - stock) + " 格</span>" : "") +
        '</span><b>' + n + " / " + stock + '</b></div>';
    }).join("");

    const summaryEl = $("#missingSummary");
    if (miss.items.length) {
      summaryEl.className = "warning";
      summaryEl.textContent = "缺线格共 " + miss.missingCells + " 格，涉及色线：" +
        miss.items.map(function (it) { return it.colorIndex + "（缺" + it.short + "格）"; }).join("、") +
        "。未补齐前阻断上机。";
    } else {
      summaryEl.className = "saved";
      summaryEl.textContent = "各色线库存充足。";
    }
  }

  function renderPreview() {
    const pre = C.previewColors(scheme.cells, scheme.cols);
    $("#preview").innerHTML = pre.map(function (v) {
      return '<div class="mini" style="background:' + C.COLORS[v] + '"></div>';
    }).join("");
  }

  function renderRisk() {
    const rows = C.riskRows(scheme.cells, scheme.cols, scheme.rows);
    $("#risk").innerHTML = rows.length
      ? '<p class="warning">第' + rows.map(function (y) { return y + 1; }).join("、") +
        "行换色过密，可能断线。</p>"
      : "<p>暂无明显断线风险。</p>";
  }

  /* ---------- 画布操作 ---------- */

  function paintAt(i) {
    if (!dragPainted) pushUndo();
    const changed = C.paintAt(scheme.cells, scheme.cols, scheme.rows, i, active, block);
    if (changed.length) {
      dragPainted = true;
      setDirty(true);
      // 受影响格位重绘；缺线标记对全网格重新同步（改一色会影响该色缺线状态）
      recomputeShort();
      changed.forEach(function (t) {
        const el = $("#grid").querySelector('.cell[data-i="' + t + '"]');
        if (el) el.style.background = C.COLORS[scheme.cells[t]];
      });
      markGridShort();
      renderStats();
      renderPreview();
      renderRisk();
      renderPaletteShort();
    }
  }

  function readSizeInput(id) {
    return Math.max(6, Math.min(id === "#cols" ? 36 : 32, Math.floor(Number($(id).value) || 0)));
  }

  function newGrid() {
    const cols = readSizeInput("#cols");
    const rows = readSizeInput("#rows");
    $("#cols").value = cols;
    $("#rows").value = rows;
    pushUndo();
    scheme.cols = cols;
    scheme.rows = rows;
    scheme.cells = C.createCells(cols, rows);
    setDirty(true);
    renderAll();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push({ cells: scheme.cells.slice(), cols: scheme.cols, rows: scheme.rows });
    restoreSnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push({ cells: scheme.cells.slice(), cols: scheme.cols, rows: scheme.rows });
    restoreSnapshot(redoStack.pop());
  }

  /* ---------- 方案操作 ---------- */

  function createScheme() {
    const cols = readSizeInput("#cols");
    const rows = readSizeInput("#rows");
    const s = store.create(null, cols, rows);
    loadScheme(s);
  }

  function switchScheme(id) {
    if (id === scheme.id) return;
    if (dirty) persistCurrent();
    const s = store.select(id);
    if (s) loadScheme(s);
  }

  function renameScheme() {
    const name = $("#schemeName").value.trim();
    if (!name) { $("#schemeName").value = scheme.name; return; }
    scheme = store.rename(scheme.id, name);
    renderSchemeBar();
  }

  function deleteScheme() {
    if (store.list().length <= 1) return;
    if (!window.confirm("确定删除方案「" + scheme.name + "」？此操作不可恢复。")) return;
    const nextId = store.list().filter(function (s) { return s.id !== scheme.id; })[0].id;
    store.remove(scheme.id);
    loadScheme(store.select(nextId));
  }

  /* ---------- 导出 ---------- */

  function slugify(name) {
    return (name || "brocade-pattern").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "brocade-pattern";
  }

  function exportJSON() {
    const data = C.buildExport(scheme, stocks);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = slugify(scheme.name) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 工具 ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    $("#grid").addEventListener("pointerdown", function (e) {
      const el = e.target.closest(".cell");
      if (!el) return;
      e.preventDefault();
      dragging = true;
      dragPainted = false;
      paintAt(Number(el.dataset.i));
    });
    $("#grid").addEventListener("pointerover", function (e) {
      const el = e.target.closest(".cell");
      if (el && dragging) paintAt(Number(el.dataset.i));
    });
    window.addEventListener("pointerup", function () {
      if (dragging && dragPainted && dirty) persistCurrent(); // 落笔画完即存档，切换不丢活
      dragging = false;
      dragPainted = false;
    });

    $("#palette").addEventListener("click", function (e) {
      const sw = e.target.closest("[data-color]");
      if (sw) { active = Number(sw.dataset.color); renderPaletteShort(); }
    });
    $("#palette").addEventListener("change", function (e) {
      const input = e.target.closest("[data-stock]");
      if (input) {
        stocks = store.setStock(Number(input.dataset.stock), Number(input.value));
        refreshShortUI();
      }
    });

    document.querySelectorAll("[data-block]").forEach(function (btn) {
      btn.addEventListener("click", function () { block = btn.dataset.block; });
    });

    $("#newBtn").addEventListener("click", newGrid);
    $("#undoBtn").addEventListener("click", undo);
    $("#redoBtn").addEventListener("click", redo);
    $("#saveBtn").addEventListener("click", persistCurrent);
    $("#exportBtn").addEventListener("click", exportJSON);

    $("#schemeSelect").addEventListener("change", function (e) { switchScheme(e.target.value); });
    $("#addSchemeBtn").addEventListener("click", createScheme);
    $("#renameBtn").addEventListener("click", renameScheme);
    $("#deleteSchemeBtn").addEventListener("click", deleteScheme);
    $("#schemeName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") renameScheme();
    });

    window.addEventListener("beforeunload", function () {
      if (dirty) persistCurrent();
    });
  }

  bind();
  renderAll();
})();
