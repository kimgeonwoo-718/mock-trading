// Yahoo Finance 조회 (서버 전용).
// 브라우저에서는 CORS 때문에 Yahoo를 직접 부를 수 없어서, 이 서버가 대신 불러다 줍니다.
import YahooFinance from "yahoo-finance2";
import { getMarket, marketFromYahoo, MARKETS } from "./markets.js";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// 서버리스 인스턴스가 재사용될 때를 위한 짧은 캐시.
// 같은 종목을 여러 사람이 동시에 봐도 Yahoo 호출은 몇 초에 한 번만 나갑니다.
const CACHE_MS = 4000;
const cache = new Map(); // key -> { at, value }

function cached(key, ttl, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = loader();
  cache.set(key, { at: Date.now(), value });
  // 실패한 요청은 캐시에 남기지 않습니다
  value.catch(() => cache.delete(key));
  return value;
}

export async function fetchQuotes(yahooSymbols) {
  if (!yahooSymbols.length) return [];
  const key = "q:" + yahooSymbols.slice().sort().join(",");

  return cached(key, CACHE_MS, async () => {
    const results = await yahooFinance.quote(yahooSymbols);
    const list = Array.isArray(results) ? results : [results];
    return list
      .map((q) => {
        const price = q.regularMarketPrice;
        if (!Number.isFinite(price)) return null;
        return {
          yahooSymbol: q.symbol,
          price,
          currency: q.currency || null,
          // 전일 종가 대비 등락 (Yahoo가 계산해 주는 값을 그대로 사용)
          changePercent: Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : null,
          previousClose: Number.isFinite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null,
          marketState: q.marketState || null,
          timestamp: q.regularMarketTime
            ? new Date(q.regularMarketTime).toISOString()
            : new Date().toISOString(),
        };
      })
      .filter(Boolean);
  });
}

// 통화 -> 원화 환율
export async function fetchRates(currencies) {
  const needed = [...new Set(currencies)].filter((c) => c && c !== "KRW");
  if (!needed.length) return { KRW: 1 };
  const key = "fx:" + needed.slice().sort().join(",");

  return cached(key, 60000, async () => {
    const results = await yahooFinance.quote(needed.map((c) => `${c}KRW=X`));
    const list = Array.isArray(results) ? results : [results];
    const rates = { KRW: 1 };
    list.forEach((q) => {
      const currency = String(q.symbol || "").replace("KRW=X", "");
      const rate = q.regularMarketPrice;
      if (currency && Number.isFinite(rate) && rate > 0) rates[currency] = rate;
    });
    return rates;
  });
}

// 시장 + 종목코드로 종목이 실제로 있는지 확인
export async function lookupSymbol(code, marketId) {
  const market = getMarket(marketId);
  if (!market) return null;

  for (const yahooSymbol of market.candidates(code)) {
    try {
      const q = await yahooFinance.quote(yahooSymbol);
      const price = q && q.regularMarketPrice;
      if (!Number.isFinite(price)) continue;
      return {
        symbol: `${market.id}:${code}`,
        code,
        market: market.id,
        yahooSymbol,
        name: q.shortName || q.longName || code,
        currency: q.currency || market.currency,
        sector: q.fullExchangeName || market.label,
        price,
      };
    } catch {
      // 이 심볼로는 없음 — 다음 후보 시도
    }
  }
  return null;
}

// 종목 이름으로 검색 ("삼성" → 삼성전자 …). 지원하지 않는 시장은 걸러냅니다.
export async function searchSymbols(query) {
  const key = "s:" + query.toLowerCase();
  return cached(key, 5 * 60 * 1000, async () => {
    const res = await yahooFinance.search(query, { quotesCount: 20, newsCount: 0, enableFuzzyQuery: false });
    const quotes = (res && res.quotes) || [];
    const out = [];
    const seen = new Set();

    for (const q of quotes) {
      const type = String(q.quoteType || "").toUpperCase();
      if (type !== "EQUITY" && type !== "ETF") continue;
      const mapped = marketFromYahoo(q.symbol, q.exchange);
      if (!mapped) continue;
      const market = MARKETS[mapped.market];
      if (!market || !market.validate(mapped.code)) continue;
      const symbol = `${mapped.market}:${mapped.code}`;
      if (seen.has(symbol)) continue;
      seen.add(symbol);

      out.push({
        symbol,
        code: mapped.code,
        market: mapped.market,
        currency: market.currency,
        yahooSymbol: q.symbol,
        name: q.shortname || q.longname || mapped.code,
        sector: q.exchDisp || market.label,
      });
      if (out.length >= 12) break;
    }
    return out;
  });
}

// 기간별 차트 데이터
const RANGES = {
  "1d": { days: 4, interval: "5m", lastSessionOnly: true },
  "1w": { days: 9, interval: "60m", lastSessionOnly: false },
  "1m": { days: 33, interval: "1d", lastSessionOnly: false },
  "1y": { days: 370, interval: "1d", lastSessionOnly: false },
};

export async function fetchChart(yahooSymbol, range) {
  const cfg = RANGES[range] || RANGES["1d"];
  const key = `c:${yahooSymbol}:${range}`;
  const ttl = range === "1d" ? 60 * 1000 : 10 * 60 * 1000;

  return cached(key, ttl, async () => {
    const period1 = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000);
    const result = await yahooFinance.chart(yahooSymbol, { period1, interval: cfg.interval });
    let rows = (result && result.quotes ? result.quotes : [])
      .filter((q) => Number.isFinite(q.close) && q.date)
      .map((q) => ({ t: new Date(q.date).toISOString(), c: q.close }));

    // '1일'은 마지막 거래일 하루치만 남깁니다
    if (cfg.lastSessionOnly && rows.length) {
      const lastDay = rows[rows.length - 1].t.slice(0, 10);
      const sameDay = rows.filter((r) => r.t.slice(0, 10) === lastDay);
      if (sameDay.length > 2) rows = sameDay;
    }
    // 너무 많으면 솎아내기 (그래프 그리기엔 200개면 충분)
    const MAX = 200;
    if (rows.length > MAX) {
      const step = Math.ceil(rows.length / MAX);
      const thinned = rows.filter((_, i) => i % step === 0);
      if (thinned[thinned.length - 1] !== rows[rows.length - 1]) thinned.push(rows[rows.length - 1]);
      rows = thinned;
    }
    const meta = result && result.meta ? result.meta : {};
    return { points: rows, currency: meta.currency || null, previousClose: meta.chartPreviousClose ?? null };
  });
}

// 스파크라인용 최근 시세 흐름 (5분봉, 최근 2일치)
export async function fetchHistory(yahooSymbol) {
  const key = "h:" + yahooSymbol;
  return cached(key, 5 * 60 * 1000, async () => {
    const period1 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const result = await yahooFinance.chart(yahooSymbol, { period1, interval: "5m" });
    const closes = (result && result.quotes ? result.quotes : [])
      .map((q) => q.close)
      .filter((v) => Number.isFinite(v));
    // 마지막 40개만 사용
    return closes.slice(-40);
  });
}
