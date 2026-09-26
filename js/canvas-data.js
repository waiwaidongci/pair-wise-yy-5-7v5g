/*
 * 画布数据（独立业务源码一）
 * 只处理网格与纹样的纯数据：填色、撤销重做、用量/缺线统计、断线风险。
 * 不读写 DOM、不知道页面存在，后续接不同织机时直接复用本模块的数据输出。
 */
(function (global) {
  "use strict";

  const DEFAULT_COLORS = [
    "#f7e7c4", "#a6322d", "#1f5f78", "#d6a437",
    "#355b38", "#713d7b", "#1e1b18", "#e98c52"
  ];
  // 库存未登记时的默认备线量（格）
  const DEFAULT_STOCK = 40;
  const MAX_HISTORY = 50;

  function clampInt(v, min, max, fallback) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  class PatternCanvas {
    constructor(opts) {
      opts = opts || {};
      this.cols = clampInt(opts.cols, 6, 36, 18);
      this.rows = clampInt(opts.rows, 6, 32, 14);
      this.colors = Array.isArray(opts.colors) && opts.colors.length ? opts.colors.slice() : DEFAULT_COLORS.slice();
      const size = this.cols * this.rows;
      this.cells = Array.isArray(opts.cells) ? opts.cells.slice(0, size) : [];
      while (this.cells.length < size) this.cells.push(0);
      this.cells = this.cells.map(v => (Number.isInteger(v) && v >= 0 && v < this.colors.length ? v : 0));
      this.activeColor = clampInt(opts.activeColor, 0, this.colors.length - 1, 1);
      this.block = opts.block === "cross" || opts.block === "diamond" ? opts.block : "dot";
      this.undoStack = [];
      this.redoStack = [];
    }

    _pushHistory() {
      this.undoStack.push(this.cells.slice());
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }

    _idx(x, y) {
      return x < 0 || x >= this.cols || y < 0 || y >= this.rows ? null : y * this.cols + x;
    }

    _targets(i) {
      const x = i % this.cols, y = Math.floor(i / this.cols);
      if (this.block === "cross") {
        return [i, this._idx(x - 1, y), this._idx(x + 1, y), this._idx(x, y - 1), this._idx(x, y + 1)].filter(v => v !== null);
      }
      if (this.block === "diamond") {
        return [this._idx(x, y - 1), this._idx(x - 1, y), i, this._idx(x + 1, y), this._idx(x, y + 1)].filter(v => v !== null);
      }
      return [i];
    }

    paintAt(i) {
      if (i < 0 || i >= this.cells.length) return false;
      const targets = this._targets(i);
      if (targets.every(t => this.cells[t] === this.activeColor)) return false;
      this._pushHistory();
      targets.forEach(t => { this.cells[t] = this.activeColor; });
      return true;
    }

    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.cells.slice());
      this.cells = this.undoStack.pop();
      return true;
    }

    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.cells.slice());
      this.cells = this.redoStack.pop();
      return true;
    }

    // 每种色线的用量、库存与缺线情况；stockByColor: { "#hex": 数量|null(null=不限) }
    // 索引 0 为画布底色（空经格，不穿色线），统计用量但永不计缺线
    usage(stockByColor) {
      stockByColor = stockByColor || {};
      return this.colors.map((color, i) => {
        const used = this.cells.reduce((n, v) => n + (v === i ? 1 : 0), 0);
        if (i === 0) return { color, index: i, used, stock: null, short: 0, missing: false };
        const raw = Object.prototype.hasOwnProperty.call(stockByColor, color) ? stockByColor[color] : DEFAULT_STOCK;
        const stock = raw === null || raw === "" ? null : clampInt(raw, 0, 1e9, DEFAULT_STOCK);
        const short = stock === null ? 0 : Math.max(0, used - stock);
        return { color, index: i, used, stock, short, missing: stock !== null && used > stock };
      });
    }

    // 已经画进网格、但库存不够的格子总数
    shortageCellCount(stockByColor) {
      return this.usage(stockByColor).reduce((n, u) => n + u.short, 0);
    }

    // 取 6x6 重复单元（网格不足则取实际大小）
    preview(size) {
      size = size || 6;
      const w = Math.min(size, this.cols), h = Math.min(size, this.rows);
      const out = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) out.push(this.colors[this.cells[y * this.cols + x]]);
      }
      return { colors: out, cols: w, rows: h };
    }

    // 换色过密的纬行（1 起始行号）
    riskRows() {
      const rows = [];
      for (let y = 0; y < this.rows; y++) {
        let switches = 0;
        for (let x = 1; x < this.cols; x++) {
          if (this.cells[y * this.cols + x] !== this.cells[y * this.cols + x - 1]) switches++;
        }
        if (switches > this.cols * 0.62) rows.push(y + 1);
      }
      return rows;
    }

    // 方案持久化内容：网格 + 当前色线选择；用量、阻断为实时计算，不存档
    toJSON() {
      return {
        cols: this.cols,
        rows: this.rows,
        colors: this.colors.slice(),
        cells: this.cells.slice(),
        activeColor: this.activeColor,
        block: this.block
      };
    }
  }

  global.PatternCanvas = PatternCanvas;
  global.PatternCanvasDefaults = { colors: DEFAULT_COLORS, stock: DEFAULT_STOCK };
})(window);
