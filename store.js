// 잔고·보유종목·거래내역·관심종목을 보관합니다.
//
// 저장 위치는 두 가지입니다.
//  - 게스트(로그인 안 함): 이 브라우저에만 저장 (localStorage)
//  - 로그인함: Supabase 계정에 저장 → PC·휴대폰 어디서 접속해도 같은 잔고
//
// 화면(app.js)에서 부르는 함수들은 전부 동기(바로 값이 나옴)이고,
// 저장만 뒤에서 조용히 일어납니다.
window.Store = (function () {
  "use strict";

  const KEY_PORTFOLIO = "mockTrading.portfolio.v1";
  const KEY_WATCHLIST = "mockTrading.watchlist.v1";
  const INITIAL_CASH = 10000000;
  const TX_LIMIT = 100;
  const MAX_ITEMS = 40;
  const SNAPSHOT_VERSION = 1;

  const DEFAULT_WATCHLIST = [
    { symbol: "KR:005930", code: "005930", market: "KR", currency: "KRW", yahooSymbol: "005930.KS", name: "삼성전자", sector: "코스피" },
    { symbol: "KR:000660", code: "000660", market: "KR", currency: "KRW", yahooSymbol: "000660.KS", name: "SK하이닉스", sector: "코스피" },
    { symbol: "KR:035420", code: "035420", market: "KR", currency: "KRW", yahooSymbol: "035420.KS", name: "NAVER", sector: "코스피" },
    { symbol: "KR:035720", code: "035720", market: "KR", currency: "KRW", yahooSymbol: "035720.KS", name: "카카오", sector: "코스피" },
    { symbol: "KR:005380", code: "005380", market: "KR", currency: "KRW", yahooSymbol: "005380.KS", name: "현대차", sector: "코스피" },
    { symbol: "KR:373220", code: "373220", market: "KR", currency: "KRW", yahooSymbol: "373220.KS", name: "LG에너지솔루션", sector: "코스피" },
    { symbol: "US:AAPL", code: "AAPL", market: "US", currency: "USD", yahooSymbol: "AAPL", name: "Apple", sector: "나스닥" },
    { symbol: "US:NVDA", code: "NVDA", market: "US", currency: "USD", yahooSymbol: "NVDA", name: "NVIDIA", sector: "나스닥" },
    { symbol: "US:TSLA", code: "TSLA", market: "US", currency: "USD", yahooSymbol: "TSLA", name: "Tesla", sector: "나스닥" },
    { symbol: "HK:0700", code: "0700", market: "HK", currency: "HKD", yahooSymbol: "0700.HK", name: "텐센트", sector: "홍콩" },
  ];

  // localStorage 를 못 쓰는 환경(시크릿 모드 등)에서도 앱이 죽지 않도록 방어
  let memoryFallback = {};
  let storageWorks = true;
  try {
    const probe = "__t" + Date.now();
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
  } catch {
    storageWorks = false;
  }

  function readRaw(key) {
    if (!storageWorks) return memoryFallback[key] || null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function writeRaw(key, value) {
    if (!storageWorks) {
      memoryFallback[key] = value;
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn("저장 실패:", err);
    }
  }
  function removeRaw(key) {
    if (!storageWorks) {
      delete memoryFallback[key];
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* 무시 */
    }
  }

  function emptyPortfolio() {
    return { cash: INITIAL_CASH, initialCash: INITIAL_CASH, holdings: {}, transactions: [] };
  }

  function normalizePortfolio(parsed) {
    if (!parsed || typeof parsed !== "object") return emptyPortfolio();
    return {
      cash: typeof parsed.cash === "number" ? parsed.cash : INITIAL_CASH,
      initialCash: typeof parsed.initialCash === "number" ? parsed.initialCash : INITIAL_CASH,
      holdings: parsed.holdings && typeof parsed.holdings === "object" ? parsed.holdings : {},
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    };
  }

  function normalizeWatchlist(parsed) {
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_WATCHLIST.slice();
    const cleaned = parsed.filter((it) => it && it.symbol && it.yahooSymbol && it.name);
    return cleaned.length ? cleaned : DEFAULT_WATCHLIST.slice();
  }

  function loadLocalPortfolio() {
    try {
      return normalizePortfolio(JSON.parse(readRaw(KEY_PORTFOLIO)));
    } catch {
      return emptyPortfolio();
    }
  }
  function loadLocalWatchlist() {
    try {
      return normalizeWatchlist(JSON.parse(readRaw(KEY_WATCHLIST)));
    } catch {
      return DEFAULT_WATCHLIST.slice();
    }
  }

  let portfolio = loadLocalPortfolio();
  let watchlist = loadLocalWatchlist();

  // ── 저장 위치 ──────────────────────────────────────────────
  let mode = "local"; // "local" | "cloud"
  let cloudSaver = null; // async (snapshot) => void
  let syncState = "idle"; // "idle" | "saving" | "saved" | "error"
  let syncListener = null;
  let saveTimer = null;
  let pendingSave = false;

  function setSync(next) {
    if (syncState === next) return;
    syncState = next;
    if (syncListener) {
      try {
        syncListener(next);
      } catch {
        /* 화면 갱신 실패는 무시 */
      }
    }
  }

  function snapshot() {
    return { v: SNAPSHOT_VERSION, portfolio, watchlist };
  }

  async function runCloudSave() {
    if (!cloudSaver) return;
    pendingSave = false;
    setSync("saving");
    try {
      await cloudSaver(snapshot());
      setSync(pendingSave ? "saving" : "saved");
    } catch (err) {
      console.warn("계정 저장 실패:", err);
      setSync("error");
    }
  }

  // 어떤 값이든 바뀌면 호출됩니다. 게스트면 브라우저에, 로그인 상태면 계정에 저장합니다.
  function persist() {
    if (mode === "local") {
      writeRaw(KEY_PORTFOLIO, JSON.stringify(portfolio));
      writeRaw(KEY_WATCHLIST, JSON.stringify(watchlist));
      return;
    }
    pendingSave = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runCloudSave, 700); // 연속 조작은 한 번으로 묶어서 저장
  }

  // 페이지를 떠나기 전에 밀린 저장을 밀어 넣습니다.
  function flush() {
    if (mode === "cloud" && pendingSave) {
      clearTimeout(saveTimer);
      return runCloudSave();
    }
    return Promise.resolve();
  }

  // ── 계정 연동 ──────────────────────────────────────────────
  // 게스트 상태에서 뭔가라도 했는지 (계정으로 옮길 값이 있는지) 판단
  function hasActivity() {
    if (portfolio.transactions.length > 0) return true;
    if (portfolio.cash !== INITIAL_CASH) return true;
    if (Object.keys(portfolio.holdings).length > 0) return true;
    if (watchlist.length !== DEFAULT_WATCHLIST.length) return true;
    const defaults = DEFAULT_WATCHLIST.map((s) => s.symbol).join(",");
    return watchlist.map((s) => s.symbol).join(",") !== defaults;
  }

  function getSnapshot() {
    return JSON.parse(JSON.stringify(snapshot()));
  }

  function applySnapshot(snap) {
    portfolio = normalizePortfolio(snap && snap.portfolio);
    watchlist = normalizeWatchlist(snap && snap.watchlist);
  }

  function startFresh() {
    portfolio = emptyPortfolio();
    watchlist = DEFAULT_WATCHLIST.slice();
  }

  // 로그인 성공 후 호출. saver 는 스냅샷을 계정에 저장하는 함수입니다.
  function useCloud(saver) {
    mode = "cloud";
    cloudSaver = saver;
    setSync("idle");
  }

  // 로그아웃 후 호출. 브라우저에 저장돼 있던 게스트 데이터로 되돌아갑니다.
  function useLocal() {
    mode = "local";
    cloudSaver = null;
    clearTimeout(saveTimer);
    pendingSave = false;
    setSync("idle");
    portfolio = loadLocalPortfolio();
    watchlist = loadLocalWatchlist();
  }

  // 게스트 기록을 계정으로 옮긴 뒤, 브라우저에 남은 사본을 비웁니다.
  function clearLocal() {
    removeRaw(KEY_PORTFOLIO);
    removeRaw(KEY_WATCHLIST);
  }

  // ── 관심종목 ────────────────────────────────────────────────
  function getWatchlist() {
    return watchlist;
  }
  function findBySymbol(symbol) {
    return watchlist.find((s) => s.symbol === symbol) || null;
  }
  function addItem(item) {
    if (watchlist.length >= MAX_ITEMS) throw new Error("WATCHLIST_FULL");
    if (findBySymbol(item.symbol)) throw new Error("ALREADY_EXISTS");
    watchlist.push(item);
    persist();
    return item;
  }
  function removeItem(symbol) {
    if (watchlist.length <= 1) throw new Error("LAST_ITEM");
    const held = portfolio.holdings[symbol];
    if (held && held.qty > 0) throw new Error("STILL_HOLDING");
    watchlist = watchlist.filter((s) => s.symbol !== symbol);
    persist();
  }

  // ── 매매 ───────────────────────────────────────────────────
  // priceKrw: 원화 환산 단가 (예수금 기준), priceNative: 현지 통화 단가 (표시용)
  function trade(symbol, side, qty, priceKrw, priceNative, currency, name) {
    const amount = qty * priceKrw;

    if (side === "buy") {
      if (amount > portfolio.cash) throw new Error("INSUFFICIENT_CASH");
      portfolio.cash -= amount;
      const h = portfolio.holdings[symbol];
      if (h && h.qty > 0) {
        const newQty = h.qty + qty;
        h.avgPrice = (h.qty * h.avgPrice + amount) / newQty;
        h.avgPriceNative = (h.qty * (h.avgPriceNative ?? h.avgPrice) + qty * priceNative) / newQty;
        h.qty = newQty;
        h.currency = currency;
      } else {
        portfolio.holdings[symbol] = { qty, avgPrice: priceKrw, avgPriceNative: priceNative, currency };
      }
    } else if (side === "sell") {
      const h = portfolio.holdings[symbol];
      if (!h || qty > h.qty) throw new Error("INSUFFICIENT_HOLDINGS");
      portfolio.cash += amount;
      h.qty -= qty;
      if (h.qty === 0) delete portfolio.holdings[symbol];
    } else {
      throw new Error("INVALID_SIDE");
    }

    portfolio.transactions.unshift({
      symbol,
      name: name || symbol,
      side,
      qty,
      price: priceKrw,
      priceNative,
      currency: currency || "KRW",
      amount,
      createdAt: new Date().toISOString(),
    });
    if (portfolio.transactions.length > TX_LIMIT) portfolio.transactions.length = TX_LIMIT;

    persist();
  }

  function getHoldingQty(symbol) {
    const h = portfolio.holdings[symbol];
    return h ? h.qty : 0;
  }

  // 현재 시세(priceKrw 포함)를 받아 평가금액·손익을 계산
  function computePortfolio(priceMap) {
    const holdings = Object.entries(portfolio.holdings)
      .filter(([, h]) => h.qty > 0)
      .map(([symbol, h]) => {
        const meta = findBySymbol(symbol);
        const quote = priceMap[symbol] || {};
        const priceKrw = quote.priceKrw != null ? quote.priceKrw : h.avgPrice;
        const value = h.qty * priceKrw;
        const cost = h.qty * h.avgPrice;
        return {
          symbol,
          name: meta ? meta.name : symbol,
          market: meta ? meta.market : null,
          currency: h.currency || "KRW",
          qty: h.qty,
          avgPrice: h.avgPrice,
          avgPriceNative: h.avgPriceNative ?? h.avgPrice,
          price: quote.price,
          priceKrw,
          value,
          pnl: value - cost,
          pnlPct: cost ? ((value - cost) / cost) * 100 : 0,
        };
      });

    const holdingsValue = holdings.reduce((sum, h) => sum + h.value, 0);
    const totalAssets = portfolio.cash + holdingsValue;
    const totalPnl = totalAssets - portfolio.initialCash;
    return {
      cash: portfolio.cash,
      initialCash: portfolio.initialCash,
      holdings,
      totalAssets,
      totalPnl,
      totalPnlPct: portfolio.initialCash ? (totalPnl / portfolio.initialCash) * 100 : 0,
    };
  }

  function getTransactions() {
    return portfolio.transactions;
  }

  function reset() {
    portfolio = emptyPortfolio();
    persist();
  }

  return {
    INITIAL_CASH,
    MAX_ITEMS,
    storageWorks,
    getWatchlist,
    findBySymbol,
    addItem,
    removeItem,
    trade,
    getHoldingQty,
    computePortfolio,
    getTransactions,
    reset,
    // 계정 연동용
    getSnapshot,
    applySnapshot,
    startFresh,
    hasActivity,
    useCloud,
    useLocal,
    clearLocal,
    flush,
    getMode: () => mode,
    getSyncState: () => syncState,
    onSync: (cb) => {
      syncListener = cb;
    },
  };
})();
