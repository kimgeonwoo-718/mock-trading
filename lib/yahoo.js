// Yahoo Finance 조회 (서버 전용).
// 브라우저에서는 CORS 때문에 Yahoo를 직접 부를 수 없어서, 이 서버가 대신 불러다 줍니다.
import YahooFinance from "yahoo-finance2";
import { getMarket } from "./markets.js";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// 서버리스 인스턴스가 재사용될 때를 위한 짧은 캐시.
// 같은 종목을 여러 사람이 동시에 봐도 Yahoo 호출은 몇 초에 한 번만 나갑니다.
const CACHE_MS = 8000;
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
