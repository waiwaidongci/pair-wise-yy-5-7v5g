/*
 * 页面操作（独立业务源码三）
 * 负责 DOM 渲染与用户交互：方案切换、画布绘制、库房编辑、统计/阻断/风险展示、导出。
 * 画布规则问 PatternCanvas，方案与库存读写问 SchemeStore，本文件只做"页面操作"。
 */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const els = {
    schemeSelect: $("schemeSelect"), newSchemeName: $("newSchemeName"), newSchemeBtn: $("newSchemeBtn"),
    delSchemeBtn: $("delSchemeBtn"), cols: $("cols"), rows: $("rows"), newBtn: $("newBtn"),
    palette: $("palette"), stock: $("stock"), blocks: document.querySelectorAll("[data-block]"),
    grid: $("grid"), undoBtn: $("undoBtn"), redoBtn: $("redoBtn"),
    blocked: $("blocked"), stats: $("stats"), preview: $("preview"), risk: $("risk"),
    saveBtn: $("saveBtn"), exportBtn: $("exportBtn")
  };

  const store = new SchemeStore();
  let canvas = null;
  let dragging = false;

  // 无方案时先建一套空白方案
  if (!store.list().length) {
    store.create("", {
      cols: 18, rows: 14, colors: PatternCanvasDefaults.colors,
      cells: Array(18 * 14).fill(0), activeColor: 1, block: "dot"
    });
  }

  function loadCurrent() {
    const s = store.current();
    canvas = new PatternCanvas({
      cols: s.cols, rows: s.rows,
      colors: s.colors || PatternCanvasDefaults.colors,
      cells: s.cells, activeColor: s.activeColor, block: s.block
    });
    store.ensureStock(canvas.colors.slice(1), PatternCanvasDefaults.stock);
    els.cols.value = canvas.cols;
    els.rows.value = canvas.rows;
  }

  function commitCurrent() {
    const s = store.current();
    if (s) store.commit(s.id, canvas.toJSON());
  }

  /* ---------- 渲染 ---------- */

  function render() {
    renderSchemes();
    renderPalette();
    renderStock();
    renderGrid();
    renderStats();
    renderPreview();
    renderRisk();
    renderBlocks();
  }

  function renderSchemes() {
    const cur = store.current();
    els.schemeSelect.innerHTML = store.list()
      .map(s => '<option value="' + s.id + '"' + (cur && s.id === cur.id ? " selected" : "") + ">" + escapeHtml(s.name) + "</option>")
      .join("");
  }

  function renderPalette() {
    const usage = canvas.usage(store.getStock());
    els.palette.innerHTML = canvas.colors.map((c, i) => {
      const short = usage[i].missing;
      return '<button type="button" class="swatch ' + (i === canvas.activeColor ? "active" : "") + (short ? " short" : "") +
        '" data-color="' + i + '" style="background:' + c + '" title="色线' + (i + 1) + (short ? "：缺线" : "") + '">' +
        (short ? '<span class="badge">缺</span>' : "") + "</button>";
    }).join("");
  }

  function renderStock() {
    const stockMap = store.getStock();
    els.stock.innerHTML = canvas.colors.map((c, i) => {
      if (i === 0) {
        return '<div class="stock-row"><span class="chip" style="background:' + c + '"></span><span>色线1（画布底色，不耗线）</span>' +
          '<input type="text" value="不限" disabled></div>';
      }
      const v = Object.prototype.hasOwnProperty.call(stockMap, c) ? stockMap[c] : PatternCanvasDefaults.stock;
      return '<div class="stock-row"><span class="chip" style="background:' + c + '"></span><span>色线' + (i + 1) +
        '</span><input type="number" min="0" data-stock="' + i + '" value="' + (v === null ? "" : v) + '" placeholder="不限"></div>';
    }).join("");
  }

  function renderGrid() {
    els.grid.style.gridTemplateColumns = "repeat(" + canvas.cols + ", 1fr)";
    els.grid.innerHTML = canvas.cells
      .map((v, i) => '<div class="cell" data-i="' + i + '" style="background:' + canvas.colors[v] + '"></div>')
      .join("");
  }

  function renderStats() {
    const usage = canvas.usage(store.getStock());
    els.stats.innerHTML = usage.map(u =>
      '<div class="stat"><span><span class="chip" style="background:' + u.color + '"></span>色线' + (u.index + 1) +
      '<em>库存 ' + (u.stock === null ? "不限" : u.stock) + "</em></span>" +
      "<b>" + u.used + "</b>" +
      (u.short ? '<span class="short-num">缺 ' + u.short + "</span>" : "") +
      "</div>"
    ).join("") +
    '<div class="stat"><span>合计格数</span><b>' + canvas.cells.length + "</b></div>" +
    '<div class="stat"><span>缺线格合计</span><b class="' + (canvas.shortageCellCount(store.getStock()) ? "warning" : "") + '">' +
      canvas.shortageCellCount(store.getStock()) + "</b></div>";
  }

  function renderPreview() {
    const p = canvas.preview(6);
    els.preview.style.gridTemplateColumns = "repeat(" + p.cols + ", 1fr)";
    els.preview.innerHTML = p.colors.map(c => '<div class="mini" style="background:' + c + '"></div>').join("");
  }

  function renderRisk() {
    const rows = canvas.riskRows();
    els.risk.innerHTML = rows.length
      ? '<p class="warning">第' + rows.join("、") + "行换色过密，可能断线。</p>"
      : "<p>暂无明显断线风险。</p>";
  }

  function renderBlocks() {
    els.blocks.forEach(btn => btn.classList.toggle("active", btn.dataset.block === canvas.block));
    els.undoBtn.disabled = !canvas.undoStack.length;
    els.redoBtn.disabled = !canvas.redoStack.length;
    renderBlocked();
  }

  function renderBlocked() {
    const usage = canvas.usage(store.getStock());
    const short = usage.filter(u => u.missing);
    if (!short.length) {
      els.blocked.innerHTML = '<p class="ok">库存充足，可上机织造。</p>';
      return;
    }
    const total = canvas.shortageCellCount(store.getStock());
    els.blocked.innerHTML =
      '<p class="warning">⚠ 库房缺线，排产阻断：共 ' + total + " 格缺线。</p><ul>" +
      short.map(u => "<li>" + escapeHtml(store.describeShortage(u)) + "</li>").join("") +
      "</ul>";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  /* ---------- 事件 ---------- */

  // 切换方案：先把当前画布自动写回旧方案，再载入所选方案
  els.schemeSelect.onchange = () => {
    commitCurrent();
    store.select(els.schemeSelect.value);
    loadCurrent();
    render();
  };

  els.newSchemeBtn.onclick = () => {
    commitCurrent();
    const blank = new PatternCanvas({ cols: 18, rows: 14, colors: canvas.colors, activeColor: 1 });
    store.create(els.newSchemeName.value.trim(), blank.toJSON());
    els.newSchemeName.value = "";
    loadCurrent();
    render();
  };

  els.delSchemeBtn.onclick = () => {
    const s = store.current();
    if (!s) return;
    if (!confirm("确认删除方案「" + s.name + "」？此操作不可恢复。")) return;
    store.remove(s.id);
    if (!store.list().length) {
      store.create("", {
        cols: 18, rows: 14, colors: PatternCanvasDefaults.colors,
        cells: Array(18 * 14).fill(0), activeColor: 1, block: "dot"
      });
    }
    loadCurrent();
    render();
  };

  els.saveBtn.onclick = () => {
    commitCurrent();
    renderSchemes();
    flash(els.saveBtn, "已保存");
  };

  els.exportBtn.onclick = () => {
    commitCurrent(); // 导出的是最近一次保存语义下的完整内容
    const s = store.current();
    store.download(s, canvas, canvas.usage(store.getStock()), canvas.riskRows());
  };

  els.newBtn.onclick = () => {
    canvas = new PatternCanvas({
      cols: Number(els.cols.value), rows: Number(els.rows.value),
      colors: canvas.colors, activeColor: canvas.activeColor, block: canvas.block
    });
    render();
  };

  els.grid.addEventListener("pointerdown", e => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    dragging = true;
    try { els.grid.setPointerCapture(e.pointerId); } catch (_) {}
    paint(Number(cell.dataset.i));
  });
  els.grid.addEventListener("pointermove", e => {
    if (!dragging) return;
    const cell = e.target.closest(".cell");
    if (cell) paint(Number(cell.dataset.i));
  });
  window.addEventListener("pointerup", () => { dragging = false; });

  function paint(i) {
    if (canvas.paintAt(i)) {
      renderGrid();
      renderStats();
      renderPreview();
      renderRisk();
      renderPalette();
      renderBlocked();
      renderBlocks();
    }
  }

  els.palette.addEventListener("click", e => {
    const sw = e.target.closest("[data-color]");
    if (!sw) return;
    canvas.activeColor = Number(sw.dataset.color);
    renderPalette();
  });

  els.stock.addEventListener("change", e => {
    const input = e.target.closest("[data-stock]");
    if (!input) return;
    const color = canvas.colors[Number(input.dataset.stock)];
    store.setStock(color, input.value.trim() === "" ? null : Number(input.value));
    renderStock();
    renderStats();
    renderPalette();
    renderBlocked();
  });

  els.blocks.forEach(btn => btn.onclick = () => { canvas.block = btn.dataset.block; renderBlocks(); });

  els.undoBtn.onclick = () => { if (canvas.undo()) render(); };
  els.redoBtn.onclick = () => { if (canvas.redo()) render(); };

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 900);
  }

  loadCurrent();
  render();
})();
