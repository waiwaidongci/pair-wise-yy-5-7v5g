/*
 * 方案读写（独立业务源码二）
 * 负责多套方案与库房库存的本地持久化、方案增删切换、导出 JSON。
 * 只存普通数据（可序列化为 JSON），不依赖页面渲染，也不依赖画布数据模块；
 * 织机对接时，方案读写可以单独换成接口实现而不影响画布数据。
 */
(function (global) {
  "use strict";

  const STORE_KEY = "zfl31Schemes.v2";
  const LEGACY_KEY = "zfl31Pattern";

  function genId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function stamp() { return new Date().toISOString(); }

  class SchemeStore {
    constructor() {
      this.data = this._load();
    }

    _load() {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { data = null; }
      if (data && Array.isArray(data.schemes) && data.schemes.length) return data;

      // 兼容旧版：只有一版被覆盖式保存的 zfl31Pattern
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch (e) { legacy = null; }
      if (legacy && Array.isArray(legacy.cells)) {
        return {
          currentId: "legacy",
          stock: {},
          schemes: [{
            id: "legacy",
            name: "初始方案",
            createdAt: stamp(),
            updatedAt: stamp(),
            cols: legacy.cols,
            rows: legacy.rows,
            colors: null, // 空表示沿用画布默认色线
            cells: legacy.cells
          }]
        };
      }
      return this._blankState();
    }

    _blankState() {
      return { currentId: null, stock: {}, schemes: [] };
    }

    _persist() {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    }

    list() { return this.data.schemes; }
    currentId() { return this.data.currentId; }
    get(id) { return this.data.schemes.find(s => s.id === id) || null; }
    current() { return this.get(this.data.currentId) || this.data.schemes[0] || null; }

    // 确保色板上每种色线都有库存条目（缺省登记为默认库存，避免旧数据导致全部"无限"）
    ensureStock(colors, defaultStock) {
      let changed = false;
      colors.forEach(c => {
        if (!Object.prototype.hasOwnProperty.call(this.data.stock, c)) {
          this.data.stock[c] = defaultStock;
          changed = true;
        }
      });
      if (changed) this._persist();
    }
    getStock() { return this.data.stock; }
    setStock(color, value) {
      this.data.stock[color] = value === null || value === "" ? null : Math.max(0, Math.floor(Number(value)) || 0);
      this._persist();
    }

    create(name, content) {
      const scheme = {
        id: genId(),
        name: name || ("方案 " + (this.data.schemes.length + 1)),
        createdAt: stamp(),
        updatedAt: stamp(),
        cols: content.cols,
        rows: content.rows,
        colors: Array.isArray(content.colors) ? content.colors.slice() : null,
        cells: content.cells.slice(),
        activeColor: content.activeColor || 0,
        block: content.block || "dot"
      };
      this.data.schemes.push(scheme);
      this.data.currentId = scheme.id;
      this._persist();
      return scheme;
    }

    // 把当前画布内容写回指定方案（网格、色线、当前选色一起存档）
    commit(id, content) {
      const scheme = this.get(id);
      if (!scheme) return null;
      scheme.cols = content.cols;
      scheme.rows = content.rows;
      scheme.colors = Array.isArray(content.colors) ? content.colors.slice() : null;
      scheme.cells = content.cells.slice();
      scheme.activeColor = content.activeColor || 0;
      scheme.block = content.block || "dot";
      scheme.updatedAt = stamp();
      this._persist();
      return scheme;
    }

    select(id) {
      if (this.get(id)) {
        this.data.currentId = id;
        this._persist();
        return true;
      }
      return false;
    }

    remove(id) {
      const i = this.data.schemes.findIndex(s => s.id === id);
      if (i < 0) return false;
      this.data.schemes.splice(i, 1);
      if (this.data.currentId === id) {
        this.data.currentId = this.data.schemes.length ? this.data.schemes[Math.max(0, i - 1)].id : null;
      }
      this._persist();
      return true;
    }

    // 缺线原因文案，页面提示与导出 JSON 共用同一说法
    describeShortage(u) {
      return "色线" + (u.index + 1) + "（" + u.color + "）缺线：用量 " + u.used +
        " 格，库存 " + u.stock + " 格，缺口 " + u.short + " 格";
    }

    // 由画布实时数据组装导出内容；usage 为画布模块算出的用量明细
    buildExport(scheme, canvas, usage, riskRows) {
      const shortUsage = usage.filter(u => u.missing);
      const shortCellCount = usage.reduce((n, u) => n + u.short, 0);
      return {
        version: 2,
        schemeId: scheme.id,
        schemeName: scheme.name,
        exportedAt: stamp(),
        cols: canvas.cols,
        rows: canvas.rows,
        colors: canvas.colors.slice(),
        cells: canvas.cells.slice(),
        totalCells: canvas.cells.length,
        stock: usage.map(u => ({ color: u.color, stock: u.stock })),
        usage: usage.map(u => ({
          color: u.color,
          used: u.used,
          stock: u.stock,
          shortCells: u.short,
          missing: u.missing
        })),
        shortageCellCount: shortCellCount,
        blocked: shortUsage.length > 0,
        blockingReasons: shortUsage.map(u => this.describeShortage(u)),
        threadBreakRiskRows: riskRows
      };
    }

    download(scheme, canvas, usage, riskRows) {
      const payload = this.buildExport(scheme, canvas, usage, riskRows);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "brocade-pattern-" + scheme.name.replace(/[\\/:*?"<>|\s]+/g, "_") + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      return payload;
    }
  }

  global.SchemeStore = SchemeStore;
})(window);
