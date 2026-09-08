// 잔고·보유종목·거래내역·관심종목을 이 브라우저에 저장합니다.
// 방문자마다 각자의 데이터를 가지며, 서로 섞이지 않습니다.
// (서버는 시세만 대신 불러다 주고, 아무것도 저장하지 않습니다)
window.Store = (function () {
  "use strict";

  const KEY_PORTFOLIO = "mockTrading.portfolio.v1";
  const KEY_WATCHLIST = "mockTrading.watchlist.v1";
  const INITIAL_CASH = 10000000;
  const TX_LIMIT = 100;
  const MAX_ITEMS = 40;

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

  function emptyPortfolio() {
    return { cash: INITIAL_CASH, initialCash: INITIAL_CASH, holdings: {}, transactions: [] };
  }

  function loadPortfolio() {
    try {
      const parsed = JSON.parse(readRaw(KEY_PORTFOLIO));
      if (!parsed || typeof parsed !== "object") return emptyPortfolio();
      return {
        cash: typeof parsed.cash === "number" ? parsed.cash : INITIAL_CASH,
        initialCash: typeof parsed.initialCash === "number" ? parsed.initialCash : INITIAL_CASH,
        holdings: parsed.holdings && typeof parsed.holdings === "object" ? parsed.holdings : {},
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      };
    } catch {
      return emptyPortfolio();
    }
  }

  function loadWatchlist() {
    try {
      const parsed = JSON.parse(readRaw(KEY_WATCHLIST));
      if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_WATCHLIST.slice();
      return parsed.filter((it) => it && it.symbol && it.yahooSymbol && it.name);
    } catch {
      return DEFAULT_WATCHLIST.slice();
    }
  }

  let portfolio = loadPortfolio();
  let watchlist = loadWatchlist();

  function savePortfolio() {
    writeRaw(KEY_PORTFOLIO, JSON.stringify(portfolio));
  }
  function saveWatchlist() {
    writeRaw(KEY_WATCHLIST, JSON.stringify(watchlist));
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
    saveWatchlist();
    return item;
  }
  function removeItem(symbol) {
    if (watchlist.length <= 1) throw new Error("LAST_ITEM");
    const held = portfolio.holdings[symbol];
    if (held && held.qty > 0) throw new Error("STILL_HOLDING");
    watchlist = watchlist.filter((s) => s.symbol !== symbol);
    saveWatchlist();
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

    savePortfolio();
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
    savePortfolio();
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
  };
})();
