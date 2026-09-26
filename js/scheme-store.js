/**
 * 方案读写层：多套方案的存档、切换、增删改，以及库房库存的持久化。
 * 只依赖 localStorage 与 BrocadeCanvas 提供的纯数据格式，不碰页面 DOM。
 */
(function (global) {
  "use strict";

  const SCHEME_KEY = "zfl31Schemes";
  const ACTIVE_KEY = "zfl31ActiveScheme";
  const STOCK_KEY = "zfl31Stocks";
  const LEGACY_KEY = "zfl31Pattern"; // 旧版单方案存档

  function uid() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function validScheme(s) {
    return s &&
      typeof s.id === "string" &&
      typeof s.name === "string" &&
      Number.isInteger(s.cols) && s.cols > 0 &&
      Number.isInteger(s.rows) && s.rows > 0 &&
      Array.isArray(s.cells) && s.cells.length === s.cols * s.rows;
  }

  function freshState() {
    const C = global.BrocadeCanvas;
    const cols = 18, rows = 14;
    const scheme = {
      id: uid(),
      name: "方案一",
      cols: cols,
      rows: rows,
      cells: C.createCells(cols, rows),
      threads: [0],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    return { schemes: [scheme], activeId: scheme.id };
  }

  // 兼容旧版 zfl31Pattern 单方案存档，迁移为“方案一”
  function migrateLegacy() {
    const old = readJSON(LEGACY_KEY);
    if (!old || !Array.isArray(old.cells) ||
        !Number.isInteger(old.cols) || !Number.isInteger(old.rows)) return null;
    const used = {};
    old.cells.forEach(function (v) { used[v] = true; });
    return {
      id: uid(),
      name: "方案一（旧版迁移）",
      cols: old.cols,
      rows: old.rows,
      cells: old.cells.slice(),
      threads: Object.keys(used).map(Number),
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
  }

  function boot() {
    const state = { schemes: [], activeId: null };

    const stored = readJSON(SCHEME_KEY);
    if (stored && Array.isArray(stored.schemes)) {
      state.schemes = stored.schemes.filter(validScheme);
      state.activeId = stored.activeId || null;
    }

    if (!state.schemes.length) {
      const migrated = migrateLegacy();
      if (migrated) {
        state.schemes = [migrated];
        state.activeId = migrated.id;
        persist(state);
        return state;
      }
      return freshState();
    }

    if (!state.schemes.some(function (s) { return s.id === state.activeId; })) {
      state.activeId = state.schemes[0].id;
    }
    persist(state);
    return state;
  }

  function persist(state) {
    writeJSON(SCHEME_KEY, { schemes: state.schemes, activeId: state.activeId });
    if (state.activeId !== null) localStorage.setItem(ACTIVE_KEY, state.activeId);
  }

  function loadStocks() {
    const C = global.BrocadeCanvas;
    const saved = readJSON(STOCK_KEY);
    return C.COLORS.map(function (_, i) {
      if (saved && Number.isFinite(Number(saved[i]))) return Number(saved[i]);
      return C.DEFAULT_STOCKS[i];
    });
  }

  function saveStocks(stocks) {
    writeJSON(STOCK_KEY, stocks);
  }

  function Store() {
    const state = boot();
    let stocks = loadStocks();

    this.list = function () { return state.schemes.map(function (s) {
      return { id: s.id, name: s.name, cols: s.cols, rows: s.rows, updatedAt: s.updatedAt };
    }); };

    this.activeId = function () { return state.activeId; };

    this.get = function (id) {
      const s = state.schemes.find(function (x) { return x.id === id; });
      return s ? s : null;
    };

    this.getActive = function () {
      return this.get(state.activeId);
    };

    this.create = function (name, cols, rows) {
      const C = global.BrocadeCanvas;
      const scheme = {
        id: uid(),
        name: name || ("方案" + (state.schemes.length + 1)),
        cols: cols,
        rows: rows,
        cells: C.createCells(cols, rows),
        threads: [0],
        createdAt: nowISO(),
        updatedAt: nowISO()
      };
      state.schemes.push(scheme);
      state.activeId = scheme.id;
      persist(state);
      return scheme;
    };

    this.select = function (id) {
      if (!state.schemes.some(function (s) { return s.id === id; })) return null;
      state.activeId = id;
      persist(state);
      return this.get(id);
    };

    this.rename = function (id, name) {
      const s = this.get(id);
      if (s && name) {
        s.name = name;
        s.updatedAt = nowISO();
        persist(state);
      }
      return s;
    };

    this.update = function (id, patch) {
      const s = this.get(id);
      if (!s) return null;
      if (Array.isArray(patch.cells)) s.cells = patch.cells.slice();
      if (Number.isInteger(patch.cols)) s.cols = patch.cols;
      if (Number.isInteger(patch.rows)) s.rows = patch.rows;
      if (Array.isArray(patch.threads)) s.threads = patch.threads.slice();
      s.updatedAt = nowISO();
      persist(state);
      return s;
    };

    this.remove = function (id) {
      if (state.schemes.length <= 1) return false;
      const idx = state.schemes.findIndex(function (s) { return s.id === id; });
      if (idx === -1) return false;
      state.schemes.splice(idx, 1);
      if (state.activeId === id) state.activeId = state.schemes[Math.max(0, idx - 1)].id;
      persist(state);
      return true;
    };

    this.getStocks = function () { return stocks.slice(); };

    this.setStock = function (colorIndex, value) {
      if (colorIndex < 0 || colorIndex >= stocks.length) return stocks.slice();
      stocks[colorIndex] = Math.max(0, Math.floor(Number(value) || 0));
      saveStocks(stocks);
      return stocks.slice();
    };
  }

  global.BrocadeStore = Store;
})(window);
