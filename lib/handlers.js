// API 로직 본체. Vercel 서버리스 함수(api/)와 로컬 개발 서버(server/dev.js)가 같이 씁니다.
import { MARKET_LIST } from "./markets.js";
import { fetchQuotes, fetchRates, lookupSymbol, fetchHistory, searchSymbols, fetchChart } from "./yahoo.js";

export function marketsHandler() {
  return { markets: MARKET_LIST };
}

// query.symbols : "005930.KS,AAPL,0700.HK" 형태
// query.currencies : "USD,HKD" (없으면 환율 생략)
export async function quotesHandler(query) {
  const symbols = String(query.symbols || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (symbols.length === 0) return { quotes: [], rates: { KRW: 1 } };

  const currencies = String(query.currencies || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [quotes, rates] = await Promise.all([
    fetchQuotes(symbols),
    currencies.length ? fetchRates(currencies) : Promise.resolve({ KRW: 1 }),
  ]);

  return { quotes, rates, fetchedAt: new Date().toISOString() };
}

export async function lookupHandler(query) {
  const market = String(query.market || "KR").toUpperCase();
  const code = String(query.code || "").trim();
  if (!code) return { error: "INVALID_CODE" };

  const found = await lookupSymbol(code, market);
  if (!found) return { error: "SYMBOL_NOT_FOUND" };
  return { item: found };
}

// query.q : 검색어 (종목 이름 또는 티커)
export async function searchHandler(query) {
  const q = String(query.q || "").trim();
  if (q.length < 1) return { results: [] };
  const results = await searchSymbols(q.slice(0, 40));
  return { results };
}

// query.symbol : Yahoo 심볼, query.range : 1d | 1w | 1m | 1y
export async function chartHandler(query) {
  const symbol = String(query.symbol || "").trim();
  if (!symbol) return { error: "INVALID_SYMBOL" };
  const range = ["1d", "1w", "1m", "1y"].includes(query.range) ? query.range : "1d";
  const data = await fetchChart(symbol, range);
  return { range, ...data };
}

// query.symbols : 스파크라인을 그릴 종목들
export async function historyHandler(query) {
  const symbols = String(query.symbols || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  const entries = await Promise.all(
    symbols.map(async (sym) => {
      try {
        return [sym, await fetchHistory(sym)];
      } catch {
        return [sym, []]; // 실패해도 앱은 계속 돌아갑니다 (스파크라인만 비어 있음)
      }
    })
  );
  return { history: Object.fromEntries(entries) };
}
