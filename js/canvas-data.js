/**
 * 画布数据层：只管网格、色线、用量等纯数据计算。
 * 不依赖 DOM，也不读写存储，方便后续对接不同织机时复用。
 */
(function (global) {
  "use strict";

  // 色线表：索引即色线编号，0 为底色纬线
  const COLORS = [
    "#f7e7c4", "#a6322d", "#1f5f78", "#d6a437",
    "#355b38", "#713d7b", "#1e1b18", "#e98c52"
  ];
  // 库房默认库存（格），可在页面上按色线调整
  const DEFAULT_STOCKS = [260, 60, 40, 80, 100, 60, 255, 50];
  const BLOCKS = ["dot", "cross", "diamond"];

  function createCells(cols, rows) {
    return new Array(Math.max(0, cols * rows)).fill(0);
  }

  function indexOf(x, y, cols, rows) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return y * cols + x;
  }

  // 落笔时受影响的格位（单点 / 十字 / 小菱形）
  function targetIndices(i, cols, rows, block) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    let pts;
    if (block === "cross") {
      pts = [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    } else if (block === "diamond") {
      pts = [[x, y - 1], [x - 1, y], [x, y], [x + 1, y], [x, y + 1]];
    } else {
      pts = [[x, y]];
    }
    const out = [];
    pts.forEach(function (p) {
      const t = indexOf(p[0], p[1], cols, rows);
      if (t !== null && out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }

  // 原地填色，返回真正发生变化的格位（没有变化返回空数组）
  function paintAt(cells, cols, rows, i, colorIndex, block) {
    const targets = targetIndices(i, cols, rows, block);
    let changed = false;
    targets.forEach(function (t) {
      if (cells[t] !== colorIndex) {
        cells[t] = colorIndex;
        changed = true;
      }
    });
    return changed ? targets : [];
  }

  function usageByColor(cells) {
    const counts = COLORS.map(function () { return 0; });
    cells.forEach(function (v) {
      if (v >= 0 && v < COLORS.length) counts[v]++;
    });
    return counts;
  }

  // 方案存档用：用到哪些色线 + 各色用量
  function schemeSummary(cells) {
    const counts = usageByColor(cells);
    return {
      threads: counts
        .map(function (n, i) { return i; })
        .filter(function (i) { return counts[i] > 0; }),
      usage: counts.map(function (count, i) {
        return { colorIndex: i, color: COLORS[i], count: count };
      })
    };
  }

  function stockOf(stocks, i) {
    return Number.isFinite(stocks[i]) ? stocks[i] : DEFAULT_STOCKS[i];
  }

  /**
   * 库房盘点：用量超过库存的色线即“缺线”。
   * 缺线色线已经画进网格的格位全部计入 missingCells（单独计数）。
   */
  function shortage(cells, stocks) {
    const counts = usageByColor(cells);
    const items = [];
    let missingCells = 0;
    COLORS.forEach(function (color, i) {
      const stock = stockOf(stocks, i);
      const required = counts[i];
      const short = Math.max(0, required - stock);
      if (short > 0) {
        items.push({ colorIndex: i, color: color, required: required, stock: stock, short: short });
        missingCells += required;
      }
    });
    return { items: items, missingCells: missingCells };
  }

  // 换色过密、可能断线的纬行（返回 0 基行号）
  function riskRows(cells, cols, rows) {
    const risky = [];
    for (let y = 0; y < rows; y++) {
      let switches = 0;
      for (let x = 1; x < cols; x++) {
        if (cells[y * cols + x] !== cells[y * cols + x - 1]) switches++;
      }
      if (switches > cols * 0.62) risky.push(y);
    }
    return risky;
  }

  // 左上角 6×6 重复单元预览，返回色线索引数组
  function previewColors(cells, cols) {
    return Array.from({ length: 36 }, function (_, i) {
      const v = cells[(i % 6) + Math.floor(i / 6) * cols];
      return Number.isInteger(v) ? v : 0;
    });
  }

  // 导出 JSON：网格、色线、用量、库存、缺线计数与阻断原因都在里面
  function buildExport(scheme, stocks) {
    const cells = scheme.cells;
    const counts = usageByColor(cells);
    const miss = shortage(cells, stocks);
    const blocked = miss.items.length > 0;
    return {
      app: "手工织锦纹样排版台",
      exportedAt: new Date().toISOString(),
      blocked: blocked,
      blockReasons: miss.items.map(function (it) {
        return "色线" + it.colorIndex + "（" + it.color + "）需 " + it.required +
          " 格，库房仅存 " + it.stock + " 格，缺 " + it.short +
          " 格；已织入网格的 " + it.required + " 个格位无足量色线，阻断上机。";
      }),
      scheme: {
        id: scheme.id,
        name: scheme.name,
        cols: scheme.cols,
        rows: scheme.rows,
        threads: scheme.threads || schemeSummary(cells).threads,
        createdAt: scheme.createdAt,
        updatedAt: scheme.updatedAt
      },
      colors: COLORS.slice(),
      cells: cells.slice(),
      usage: counts.map(function (count, i) {
        return { colorIndex: i, color: COLORS[i], count: count };
      }),
      inventory: COLORS.map(function (color, i) {
        return { colorIndex: i, color: color, stock: stockOf(stocks, i) };
      }),
      missing: {
        total: miss.missingCells,
        colors: miss.items
      }
    };
  }

  global.BrocadeCanvas = {
    COLORS: COLORS,
    DEFAULT_STOCKS: DEFAULT_STOCKS,
    BLOCKS: BLOCKS,
    createCells: createCells,
    targetIndices: targetIndices,
    paintAt: paintAt,
    usageByColor: usageByColor,
    schemeSummary: schemeSummary,
    shortage: shortage,
    riskRows: riskRows,
    previewColors: previewColors,
    buildExport: buildExport
  };
})(window);
