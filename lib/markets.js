// 지원 시장 정의.
// Yahoo Finance 심볼 규칙에 맞춰 시장별로 종목코드를 심볼로 변환합니다.
export const MARKETS = {
  KR: {
    id: "KR",
    label: "국내 (코스피/코스닥)",
    currency: "KRW",
    placeholder: "005930",
    hint: "숫자 6자리",
    // 코스피(.KS)를 먼저 찾고 없으면 코스닥(.KQ)
    candidates: (code) => [`${code}.KS`, `${code}.KQ`],
    normalize: (raw) => raw.replace(/\D/g, ""),
    validate: (code) => /^\d{6}$/.test(code),
  },
  US: {
    id: "US",
    label: "미국 (나스닥/뉴욕)",
    currency: "USD",
    placeholder: "AAPL",
    hint: "영문 티커",
    candidates: (code) => [code],
    normalize: (raw) => raw.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""),
    validate: (code) => /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(code),
  },
  HK: {
    id: "HK",
    label: "홍콩",
    currency: "HKD",
    placeholder: "0700",
    hint: "숫자 4~5자리 (텐센트 = 0700)",
    candidates: (code) => [`${code.padStart(4, "0")}.HK`],
    normalize: (raw) => raw.replace(/\D/g, ""),
    validate: (code) => /^\d{1,5}$/.test(code),
  },
  SS: {
    id: "SS",
    label: "중국 상해",
    currency: "CNY",
    placeholder: "600519",
    hint: "숫자 6자리 (귀주모태 = 600519)",
    candidates: (code) => [`${code}.SS`],
    normalize: (raw) => raw.replace(/\D/g, ""),
    validate: (code) => /^\d{6}$/.test(code),
  },
  SZ: {
    id: "SZ",
    label: "중국 심천",
    currency: "CNY",
    placeholder: "000858",
    hint: "숫자 6자리 (오량액 = 000858)",
    candidates: (code) => [`${code}.SZ`],
    normalize: (raw) => raw.replace(/\D/g, ""),
    validate: (code) => /^\d{6}$/.test(code),
  },
  JP: {
    id: "JP",
    label: "일본",
    currency: "JPY",
    placeholder: "7203",
    hint: "숫자 4자리 (도요타 = 7203)",
    candidates: (code) => [`${code}.T`],
    normalize: (raw) => raw.replace(/\D/g, ""),
    validate: (code) => /^\d{4}$/.test(code),
  },
};

export const MARKET_LIST = Object.values(MARKETS).map((m) => ({
  id: m.id,
  label: m.label,
  currency: m.currency,
  placeholder: m.placeholder,
  hint: m.hint,
}));

export function getMarket(id) {
  return MARKETS[id] || null;
}

// Yahoo 심볼(+거래소 코드)을 우리 시장 구분으로 되돌립니다. 검색 결과를 걸러낼 때 씁니다.
const SUFFIX_MARKET = { KS: "KR", KQ: "KR", HK: "HK", SS: "SS", SZ: "SZ", T: "JP" };
const US_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS", "NYS", "ARCA", "AMEX"]);

export function marketFromYahoo(yahooSymbol, exchange) {
  const symbol = String(yahooSymbol || "");
  const dot = symbol.lastIndexOf(".");
  if (dot > 0) {
    const suffix = symbol.slice(dot + 1).toUpperCase();
    const marketId = SUFFIX_MARKET[suffix];
    if (marketId) return { market: marketId, code: symbol.slice(0, dot) };
  }
  // 접미사가 없으면 미국 거래소일 때만 인정 (BRK-B 처럼 점 없는 티커 포함)
  if (US_EXCHANGES.has(String(exchange || "").toUpperCase()) || (!dot && /^[A-Z0-9.\-]{1,10}$/.test(symbol))) {
    return { market: "US", code: symbol };
  }
  return null;
}

// 통화별 표시 형식
const CURRENCY_FORMAT = {
  KRW: { symbol: "₩", decimals: 0 },
  USD: { symbol: "$", decimals: 2 },
  HKD: { symbol: "HK$", decimals: 2 },
  CNY: { symbol: "CN¥", decimals: 2 },
  JPY: { symbol: "¥", decimals: 0 },
};

export function currencyFormat(currency) {
  return CURRENCY_FORMAT[currency] || { symbol: "", decimals: 2 };
}
