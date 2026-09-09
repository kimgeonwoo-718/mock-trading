(function () {
  "use strict";

  const app = document.getElementById("app");
  // 장이 열려 있을 때는 자주, 다 닫혀 있으면 느리게. 다른 탭을 보고 있으면 아예 쉽니다.
  const POLL_OPEN_MS = 5000;
  const POLL_CLOSED_MS = 60000;

  const MARKET_LABEL = { KR: "국내", US: "미국", HK: "홍콩", SS: "상해", SZ: "심천", JP: "일본" };
  const CURRENCY_FORMAT = {
    KRW: { symbol: "₩", decimals: 0 },
    USD: { symbol: "$", decimals: 2 },
    HKD: { symbol: "HK$", decimals: 2 },
    CNY: { symbol: "CN¥", decimals: 2 },
    JPY: { symbol: "¥", decimals: 0 },
  };

  let markets = [];
  let quotes = []; // 관심종목 + 시세 병합 결과
  let rates = { KRW: 1 };
  let portfolio = { cash: 0, initialCash: 0, holdings: [], totalAssets: 0, totalPnl: 0, totalPnlPct: 0 };
  let feedError = null;
  let lastFetchedAt = null;
  let authBusy = false; // 로그인/계정 데이터 불러오는 중
  let authNotice = ""; // "게스트 기록을 계정으로 옮겼어요" 같은 안내
  let authError = ""; // 계정 저장/불러오기 실패 안내

  let modal = { open: false, symbol: null, tab: "buy", qty: 1, error: "" };
  let addModal = {
    open: false, query: "", results: [], searching: false, searched: false,
    manual: false, market: "KR", code: "", name: "", busy: false, error: "",
  };
  // 주문창 차트
  let chart = { symbol: null, range: "1d", points: [], loading: false, error: false };
  // 수익률 랭킹
  let ranking = { rows: [], loading: false, error: "", myRow: null, loaded: false };
  let nickModal = { open: false, busy: false, error: "" };
  let rankSaveTimer = null;
  let manageMode = false;
  let watchExpanded = false; // 관심종목 전체 보기 여부
  const COLLAPSED_COUNT = 5; // 기본으로 보여줄 종목 수

  // ── 화면 모드 (자동 / 밝게 / 어둡게) ───────────────────────
  const THEME_KEY = "mockTrading.theme.v1";
  const THEME_OPTIONS = [
    { id: "system", label: "자동" },
    { id: "light", label: "밝게" },
    { id: "dark", label: "어둡게" },
  ];

  function readTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === "dark" || v === "light" ? v : "system";
    } catch {
      return "system";
    }
  }
  let themeMode = readTheme();

  function applyTheme(mode) {
    themeMode = mode;
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    try {
      if (mode === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* 저장 못 해도 이번 방문 동안에는 적용됩니다 */
    }
  }
  applyTheme(themeMode);

  // ── 표시 유틸 ──────────────────────────────────────────────
  function won(n) {
    const v = Math.round(n);
    return (v < 0 ? "-" : "") + "₩" + Math.abs(v).toLocaleString("ko-KR");
  }
  function money(n, currency) {
    if (n == null || !isFinite(n)) return "—";
    const f = CURRENCY_FORMAT[currency] || { symbol: "", decimals: 2 };
    const abs = Math.abs(n).toLocaleString("ko-KR", {
      minimumFractionDigits: f.decimals,
      maximumFractionDigits: f.decimals,
    });
    return (n < 0 ? "-" : "") + f.symbol + abs;
  }
  function pct(n) {
    return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ko-KR", { hour12: false });
  }

  // 시세가 언제 것인지 보여주는 라벨
  function freshness(q) {
    if (!q.timestamp) return { text: "", live: false, stale: false };
    const d = new Date(q.timestamp);
    if (isNaN(d.getTime())) return { text: "", live: false, stale: false };

    const live = q.marketState === "REGULAR";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const hhmm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

    if (live) return { text: "장중 " + hhmm, live: true, stale: false };
    if (sameDay) return { text: hhmm + " 종가", live: false, stale: false };
    return { text: d.getMonth() + 1 + "/" + d.getDate() + " 종가", live: false, stale: true };
  }

  async function fetchJSON(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "HTTP " + res.status);
    }
    return res.json();
  }

  // ── 데이터 갱신 ────────────────────────────────────────────
  const priceHistory = {}; // symbol -> [price]
  const HISTORY_LEN = 40;
  const historyLoaded = new Set();

  // 스파크라인용 실제 장중 흐름을 한 번 받아옵니다 (실패해도 앱은 그대로 동작)
  async function loadHistory() {
    const targets = Store.getWatchlist().filter((s) => !historyLoaded.has(s.symbol));
    if (!targets.length) return;
    const symbols = targets.map((s) => s.yahooSymbol).join(",");
    try {
      const data = await fetchJSON("/api/history?symbols=" + encodeURIComponent(symbols));
      targets.forEach((s) => {
        const series = (data.history || {})[s.yahooSymbol];
        if (Array.isArray(series) && series.length > 1) priceHistory[s.symbol] = series.slice(-HISTORY_LEN);
        historyLoaded.add(s.symbol);
      });
    } catch {
      targets.forEach((s) => historyLoaded.add(s.symbol));
    }
  }

  async function refreshQuotes() {
    const watchlist = Store.getWatchlist();
    if (!watchlist.length) {
      quotes = [];
      return;
    }
    const symbols = watchlist.map((s) => s.yahooSymbol).join(",");
    const currencies = [...new Set(watchlist.map((s) => s.currency))].join(",");

    try {
      const data = await fetchJSON(`/api/quotes?symbols=${encodeURIComponent(symbols)}&currencies=${encodeURIComponent(currencies)}`);
      const bySymbol = {};
      (data.quotes || []).forEach((q) => (bySymbol[q.yahooSymbol] = q));
      rates = data.rates || { KRW: 1 };
      lastFetchedAt = data.fetchedAt || new Date().toISOString();
      feedError = null;

      quotes = watchlist.map((s) => {
        const q = bySymbol[s.yahooSymbol];
        const price = q ? q.price : null;
        const rate = rates[s.currency];

        if (price != null) {
          const hist = priceHistory[s.symbol] || [];
          if (hist[hist.length - 1] !== price) hist.push(price);
          if (hist.length > HISTORY_LEN) hist.shift();
          priceHistory[s.symbol] = hist;
        }
        const hist = priceHistory[s.symbol] || (price != null ? [price] : []);

        return {
          ...s,
          price,
          changePercent: q && q.changePercent != null ? q.changePercent : null,
          previousClose: q ? q.previousClose : null,
          prevPrice: hist.length > 1 ? hist[hist.length - 2] : price,
          priceKrw: price != null && rate ? price * rate : null,
          history: hist,
          timestamp: q ? q.timestamp : null,
          marketState: q ? q.marketState : null,
        };
      });
    } catch (err) {
      feedError = err.message === "QUOTE_FETCH_FAILED" ? "시세 서버에서 값을 받지 못했어요" : err.message;
    }
  }

  function recomputePortfolio() {
    const priceMap = {};
    quotes.forEach((q) => (priceMap[q.symbol] = { price: q.price, priceKrw: q.priceKrw }));
    portfolio = Store.computePortfolio(priceMap);
    scheduleRankSync();
  }

  async function refreshAll() {
    await refreshQuotes();
    recomputePortfolio();
    render();
  }

  // ── 갱신 주기 ─────────────────────────────────────────────
  // 하나라도 장이 열려 있으면 빠르게, 전부 닫혀 있으면 느리게 확인합니다.
  function anyMarketOpen() {
    return quotes.some((q) => q.marketState === "REGULAR");
  }

  let pollTimer = null;
  function scheduleNextPoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollTick, anyMarketOpen() ? POLL_OPEN_MS : POLL_CLOSED_MS);
  }

  async function pollTick() {
    // 다른 탭을 보고 있거나 뭔가 입력 중이면 이번 차례는 건너뜁니다
    if (document.visibilityState === "hidden" || addModal.open || nickModal.open) return scheduleNextPoll();
    await refreshQuotes();
    recomputePortfolio();
    render();
    scheduleNextPoll();
  }

  // ── 렌더 ──────────────────────────────────────────────────
  function sparkline(hist) {
    const w = 132, h = 46, pad = 4;
    if (!hist || hist.length < 2) return '<svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"></svg>';
    const min = Math.min.apply(null, hist), max = Math.max.apply(null, hist);
    const span = max - min || 1;
    const stepX = (w - pad * 2) / (hist.length - 1);
    const pts = hist.map((v, i) => (pad + i * stepX).toFixed(1) + "," + (pad + (1 - (v - min) / span) * (h - pad * 2)).toFixed(1));
    const rising = hist[hist.length - 1] >= hist[0];
    const colorVar = rising ? "var(--up)" : "var(--down)";
    const line = pts.join(" ");
    const area = pad + "," + (h - pad) + " " + line + " " + (w - pad) + "," + (h - pad);
    return '<svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<polyline points="' + area + '" style="fill:' + colorVar + ';opacity:.15" stroke="none"/>' +
      '<polyline points="' + line + '" fill="none" style="stroke:' + colorVar + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // 로그인 영역: 설정 전에는 아무것도 보이지 않고, 로그인하면 이름과 저장 상태가 보입니다.
  function renderAuthArea() {
    if (!Auth.configured) return "";
    const user = Auth.getUser();

    if (!user) {
      return '<button class="btn btn-login" id="loginBtn"' + (authBusy ? " disabled" : "") + ">" +
        '<span class="g-mark" aria-hidden="true">G</span>' + (authBusy ? "여는 중…" : "구글로 로그인") + "</button>";
    }

    const sync = Store.getSyncState();
    const syncLabel = { saving: "저장 중…", saved: "저장됨", error: "저장 실패", idle: "" }[sync] || "";
    const avatar = Auth.avatarUrl();
    return '<div class="user-chip" title="' + escapeHtml(user.email || "") + '">' +
        (avatar ? '<img class="u-avatar" src="' + escapeHtml(avatar) + '" alt="">' : '<span class="u-avatar u-fallback">' + escapeHtml(Auth.displayName().slice(0, 1)) + "</span>") +
        '<span class="u-name">' + escapeHtml(Auth.displayName()) + "</span>" +
        (syncLabel ? '<span class="sync-tag ' + sync + '">' + syncLabel + "</span>" : "") +
      "</div>" +
      '<button class="btn btn-sm" id="logoutBtn">로그아웃</button>';
  }

  // ── 기간별 차트 ───────────────────────────────────────────
  const CHART_RANGES = [
    { id: "1d", label: "1일" },
    { id: "1w", label: "1주" },
    { id: "1m", label: "1개월" },
    { id: "1y", label: "1년" },
  ];

  async function loadChart(yahooSymbol, range) {
    chart.loading = true;
    chart.error = false;
    paintChart();
    try {
      const data = await fetchJSON(
        "/api/chart?symbol=" + encodeURIComponent(yahooSymbol) + "&range=" + encodeURIComponent(range)
      );
      chart.points = Array.isArray(data.points) ? data.points : [];
      chart.error = chart.points.length < 2;
    } catch {
      chart.points = [];
      chart.error = true;
    }
    chart.loading = false;
    paintChart();
  }

  // 차트 부분만 다시 그립니다 (주문창 전체를 새로 그리면 입력이 초기화되므로)
  function paintChart() {
    const box = document.getElementById("chartBox");
    if (box) box.innerHTML = chartInner();
    const chips = document.getElementById("chartChips");
    if (chips) {
      chips.querySelectorAll("[data-range]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-range") === chart.range);
      });
    }
  }

  function chartSvg(points, currency) {
    const w = 100, h = 100, pad = 2; // viewBox 기준 (실제 크기는 CSS가 정합니다)
    const vals = points.map((p) => p.c);
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const span = max - min || 1;
    const stepX = (w - pad * 2) / (points.length - 1);
    const y = (v) => pad + (1 - (v - min) / span) * (h - pad * 2);
    const pts = points.map((p, i) => (pad + i * stepX).toFixed(2) + "," + y(p.c).toFixed(2));
    const rising = vals[vals.length - 1] >= vals[0];
    const color = rising ? "var(--up)" : "var(--down)";
    const line = pts.join(" ");
    const area = pad + "," + (h - pad) + " " + line + " " + (w - pad).toFixed(2) + "," + (h - pad);

    return '<svg class="chart-svg" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + area + '" style="fill:' + color + ';opacity:.13" stroke="none"/>' +
      '<polyline points="' + line + '" fill="none" style="stroke:' + color + '" stroke-width="0.9" ' +
        'vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<div class="chart-axis"><span>' + money(max, currency) + "</span><span>" + money(min, currency) + "</span></div>";
  }

  function chartInner() {
    if (chart.loading) return '<div class="chart-msg">차트 불러오는 중…</div>';
    if (chart.error || chart.points.length < 2) return '<div class="chart-msg">이 기간의 차트를 가져오지 못했어요.</div>';

    const s = quotes.find((q) => q.symbol === modal.symbol);
    const currency = s ? s.currency : "KRW";
    const first = chart.points[0].c;
    const last = chart.points[chart.points.length - 1].c;
    const diffPct = first ? ((last - first) / first) * 100 : 0;
    const cls = diffPct > 0 ? "up" : diffPct < 0 ? "down" : "flat";
    const label = (CHART_RANGES.find((r) => r.id === chart.range) || {}).label || "";

    return '<div class="chart-top"><span class="chart-range-label">' + label + " 변동</span>" +
      '<span class="chart-diff num ' + cls + '">' + pct(diffPct) + "</span></div>" +
      '<div class="chart-plot">' + chartSvg(chart.points, currency) + "</div>";
  }

  function renderChartSection() {
    return '<div class="chart-wrap">' +
      '<div class="chart-chips" id="chartChips">' +
        CHART_RANGES.map((r) =>
          '<button class="chip' + (r.id === chart.range ? " active" : "") + '" data-range="' + r.id + '">' + r.label + "</button>"
        ).join("") +
      "</div>" +
      '<div class="chart-box" id="chartBox">' + chartInner() + "</div></div>";
  }

  function renderHeader() {
    let warn = "";
    if (feedError) {
      warn = '<div class="warn-banner">⚠ ' + escapeHtml(feedError) + " — 잠시 후 자동으로 다시 시도합니다.</div>";
    } else if (authError) {
      warn = '<div class="warn-banner">⚠ ' + escapeHtml(authError) + "</div>";
    } else if (!Store.storageWorks && Store.getMode() === "local") {
      warn = '<div class="warn-banner">⚠ 이 브라우저에서 저장 기능을 쓸 수 없어요 (시크릿 모드일 수 있어요). 새로고침하면 잔고가 초기화됩니다.</div>';
    } else if (authNotice) {
      warn = '<div class="warn-banner ok">' + escapeHtml(authNotice) + "</div>";
    }

    const guestLine = Auth.configured && !Auth.getUser()
      ? '<span class="guest-hint">로그인하면 PC·휴대폰 어디서든 같은 잔고로 이어서 할 수 있어요</span>'
      : "";

    return '' +
      '<header class="top">' +
        '<div class="brand"><h1>모의투자 데스크</h1><p class="sub">' +
          '<span class="badge-mode live">실제 시세 · 지연 15~20분</span>' +
          "가상의 1,000만 원으로 국내·해외 주식을 연습하는 모의투자입니다 (실제 주문은 전송되지 않습니다)" +
          guestLine +
        "</p></div>" +
        '<div class="top-actions">' +
          renderAuthArea() +
          '<div class="theme-switch" role="group" aria-label="화면 모드">' +
            THEME_OPTIONS.map((o) =>
              '<button class="theme-opt' + (themeMode === o.id ? " active" : "") + '" data-theme-set="' + o.id + '"' +
              (themeMode === o.id ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">" + o.label + "</button>"
            ).join("") +
          "</div>" +
          '<button class="btn" id="resetBtn">초기화</button>' +
        "</div>" +
      "</header>" + warn;
  }

  function renderSummary() {
    const pl = portfolio.totalPnl;
    const plClass = pl > 0 ? "up" : pl < 0 ? "down" : "flat";
    return '<div class="summary-row">' +
      '<div class="stat"><div class="label">총자산</div><div class="value num">' + won(portfolio.totalAssets) + '</div><div class="sub">예수금 + 평가금액</div></div>' +
      '<div class="stat"><div class="label">예수금</div><div class="value num">' + won(portfolio.cash) + '</div><div class="sub">매수 가능 금액</div></div>' +
      '<div class="stat"><div class="label">평가손익</div><div class="value num ' + plClass + '">' + (pl >= 0 ? "+" : "") + won(pl) + '</div><div class="sub">초기자금 대비</div></div>' +
      '<div class="stat"><div class="label">수익률</div><div class="value num ' + plClass + '">' + pct(portfolio.totalPnlPct) + '</div><div class="sub">누적 수익률</div></div>' +
    "</div>";
  }

  function renderWatchlist() {
    // 기본은 5개만. 편집 중일 때는 전체를 보여줍니다.
    const showAll = watchExpanded || manageMode;
    const visible = showAll ? quotes : quotes.slice(0, COLLAPSED_COUNT);
    const canCollapse = quotes.length > COLLAPSED_COUNT && !manageMode;

    const rows = visible.map((s) => {
      // 전일 종가 대비 등락률 (Yahoo 제공값 우선)
      const chgPct = s.changePercent != null
        ? s.changePercent
        : (s.price != null && s.prevPrice ? ((s.price - s.prevPrice) / s.prevPrice) * 100 : 0);
      const chgClass = chgPct > 0 ? "up" : chgPct < 0 ? "down" : "flat";
      const fresh = freshness(s);
      const isForeign = s.currency !== "KRW";
      const krwLine = isForeign && s.priceKrw != null ? '<span class="krw-sub num">약 ' + won(s.priceKrw) + "</span>" : "";
      const actions = manageMode
        ? '<button class="pill-btn remove" data-action="remove" data-symbol="' + escapeHtml(s.symbol) + '">삭제</button>'
        : '<button class="pill-btn buy" data-action="buy" data-symbol="' + escapeHtml(s.symbol) + '">매수</button>' +
          '<button class="pill-btn sell" data-action="sell" data-symbol="' + escapeHtml(s.symbol) + '">매도</button>';

      return '<tr class="watch-row" data-symbol="' + escapeHtml(s.symbol) + '">' +
        '<td><div class="stock-name"><span class="name">' + escapeHtml(s.name) + "</span>" +
          '<span class="meta num"><span class="mkt-badge mkt-' + s.market + '">' + (MARKET_LABEL[s.market] || s.market) + "</span>" + escapeHtml(s.code) +
          (fresh.text ? '<span class="quote-time' + (fresh.live ? " live" : "") + (fresh.stale ? " stale" : "") + '">' + escapeHtml(fresh.text) + "</span>" : "") +
        "</span></div></td>" +
        "<td>" + sparkline(s.history) + "</td>" +
        '<td class="td-num"><div class="price-cell"><span class="price num">' + money(s.price, s.currency) + "</span>" + krwLine +
          '<span class="chg num ' + chgClass + '">' + pct(chgPct) + "</span></div></td>" +
        '<td class="td-num"><div class="row-actions">' + actions + "</div></td></tr>";
    }).join("");

    return '<section class="panel panel-watch">' +
      '<div class="panel-head"><h2>관심종목 <span class="count num">' + quotes.length + "</span></h2>" +
        '<div class="head-actions">' +
          '<span class="hint">' + (anyMarketOpen() ? POLL_OPEN_MS / 1000 + "초마다 갱신" : "장 마감 · " + POLL_CLOSED_MS / 1000 + "초마다 확인") + "</span>" +
          '<button class="btn btn-sm" id="addStockBtn">+ 종목 추가</button>' +
          '<button class="btn btn-sm' + (manageMode ? " active" : "") + '" id="manageBtn">' + (manageMode ? "완료" : "편집") + "</button>" +
        "</div></div>" +
      '<div class="panel-body"><table class="watch-table"><thead><tr><th>종목</th><th>추이</th>' +
        '<th class="th-num">현재가 / 등락률</th><th class="th-num">' + (manageMode ? "관리" : "주문") + "</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      (canCollapse
        ? '<div class="list-more">' +
            (showAll ? "" : '<div class="fade-mask" aria-hidden="true"></div>') +
            '<button class="btn more-btn" id="expandBtn">' +
              (showAll ? "접기" : "전체 보기 (" + quotes.length + "개)") +
            "</button></div>"
        : "") +
      "</section>";
  }

  function renderPortfolio() {
    const list = portfolio.holdings || [];
    let body;
    if (!list.length) {
      body = '<div class="empty-state">보유 중인 종목이 없습니다.<br>관심종목에서 매수를 시작해 보세요.</div>';
    } else {
      const rows = list.map((h) => {
        const plClass = h.pnl > 0 ? "up" : h.pnl < 0 ? "down" : "flat";
        const avgLabel = h.currency === "KRW" ? "평단 " + won(h.avgPrice) : "평단 " + money(h.avgPriceNative, h.currency);
        return '<tr class="hold-row" data-symbol="' + escapeHtml(h.symbol) + '">' +
          '<td><div class="stock-name"><span class="name">' + escapeHtml(h.name) + "</span>" +
            '<span class="meta num">' + h.qty.toLocaleString("ko-KR") + "주 · " + avgLabel + "</span></div></td>" +
          '<td class="td-num"><div class="price-cell"><span class="price num">' + won(h.value) + "</span>" +
            '<span class="chg num pl ' + plClass + '">' + (h.pnl >= 0 ? "+" : "") + won(h.pnl) + " (" + pct(h.pnlPct) + ")</span></div></td></tr>";
      }).join("");
      body = '<table><thead><tr><th>보유종목</th><th class="th-num">평가금액 / 손익</th></tr></thead><tbody>' + rows + "</tbody></table>";
    }
    return '<section class="panel panel-hold' + (list.length ? "" : " is-empty") + '">' +
      '<div class="panel-head"><h2>보유 종목</h2>' +
      '<span class="hint">' + (list.length ? "탭하면 매도·추가매수" : "해외 종목은 원화 환산 기준") + "</span></div>" +
      '<div class="panel-body">' + body + "</div></section>";
  }

  function renderTransactions() {
    const txs = Store.getTransactions();
    let list;
    if (!txs.length) {
      list = '<div class="empty-state">아직 거래 내역이 없습니다.</div>';
    } else {
      list = '<div class="txn-list">' + txs.map((tx) => {
        const unit = money(tx.priceNative != null ? tx.priceNative : tx.price, tx.currency || "KRW");
        return '<div class="txn-row">' +
          '<span class="txn-badge ' + (tx.side === "buy" ? "buy" : "sell") + '">' + (tx.side === "buy" ? "매수" : "매도") + "</span>" +
          '<div class="txn-mid"><span class="t-name">' + escapeHtml(tx.name || tx.symbol) + "</span>" +
            '<span class="t-time num">' + fmtTime(tx.createdAt) + "</span></div>" +
          '<div class="txn-end"><span class="t-amount num">' + won(tx.amount) + "</span>" +
            '<span class="t-qty num">' + tx.qty.toLocaleString("ko-KR") + "주 · " + unit + "</span></div></div>";
      }).join("") + "</div>";
    }
    return '<section class="panel panel-txn"><div class="panel-head"><h2>거래 내역</h2></div>' + list + "</section>";
  }

  // ── 수익률 랭킹 ───────────────────────────────────────────
  async function loadRankingRows() {
    if (!Auth.configured) return;
    ranking.loading = !ranking.loaded;
    try {
      ranking.rows = await Auth.loadRanking(30);
      ranking.error = "";
    } catch (err) {
      console.warn("랭킹 불러오기 실패:", err);
      ranking.error = "랭킹을 불러오지 못했어요.";
    }
    ranking.loading = false;
    ranking.loaded = true;
  }

  async function loadMyRank() {
    if (!Auth.configured || !Auth.getUser()) {
      ranking.myRow = null;
      return;
    }
    try {
      ranking.myRow = await Auth.loadMyRankRow();
    } catch (err) {
      console.warn("내 순위 확인 실패:", err);
      ranking.myRow = null;
    }
  }

  // 자산이 바뀌면 잠시 뒤 내 순위를 갱신합니다 (매매할 때마다 바로 쓰지 않도록)
  function scheduleRankSync() {
    if (!Auth.configured || !Auth.getUser() || !ranking.myRow) return;
    clearTimeout(rankSaveTimer);
    rankSaveTimer = setTimeout(async () => {
      try {
        await Auth.saveRanking(ranking.myRow.nickname, portfolio.totalAssets, portfolio.totalPnlPct);
        ranking.myRow.total_assets = portfolio.totalAssets;
        ranking.myRow.return_pct = portfolio.totalPnlPct;
        await loadRankingRows();
        if (!modal.open && !addModal.open && !nickModal.open) render();
      } catch (err) {
        console.warn("랭킹 저장 실패:", err);
      }
    }, 4000);
  }

  function renderRanking() {
    if (!Auth.configured) return "";
    const user = Auth.getUser();
    const rows = ranking.rows || [];

    let body;
    if (ranking.loading) {
      body = '<div class="empty-state">랭킹 불러오는 중…</div>';
    } else if (ranking.error) {
      body = '<div class="empty-state">' + escapeHtml(ranking.error) + "</div>";
    } else if (!rows.length) {
      body = '<div class="empty-state">아직 참가자가 없어요.<br>첫 번째로 이름을 올려보세요.</div>';
    } else {
      body = '<div class="rank-list">' + rows.map((r, i) => {
        const isMe = user && r.user_id === user.id;
        const p = Number(r.return_pct) || 0;
        const cls = p > 0 ? "up" : p < 0 ? "down" : "flat";
        const medal = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        return '<div class="rank-row' + (isMe ? " is-me" : "") + '">' +
          '<span class="rank-no num ' + medal + '">' + (i + 1) + "</span>" +
          '<span class="rank-mid"><span class="rank-name">' + escapeHtml(r.nickname) +
            (isMe ? '<span class="me-tag">나</span>' : "") + "</span>" +
            '<span class="rank-asset num">' + won(Number(r.total_assets) || 0) + "</span></span>" +
          '<span class="rank-pct num ' + cls + '">' + pct(p) + "</span></div>";
      }).join("") + "</div>";
    }

    let foot;
    if (!user) {
      foot = '<div class="rank-foot"><span class="rank-hint">로그인하면 내 수익률도 순위에 올릴 수 있어요</span></div>';
    } else if (!ranking.myRow) {
      foot = '<div class="rank-foot"><button class="btn more-btn" id="joinRankBtn">랭킹 참가하기</button></div>';
    } else {
      const myIndex = rows.findIndex((r) => r.user_id === user.id);
      const place = myIndex >= 0 ? myIndex + 1 + "위" : "30위 밖";
      foot = '<div class="rank-foot">' +
        '<span class="rank-hint">내 순위 <strong>' + place + "</strong> · " + escapeHtml(ranking.myRow.nickname) + "</span>" +
        '<span class="rank-actions"><button class="link-btn" id="editNickBtn">닉네임 변경</button>' +
        '<button class="link-btn danger" id="leaveRankBtn">참가 취소</button></span></div>';
    }

    return '<section class="panel panel-rank">' +
      '<div class="panel-head"><h2>수익률 랭킹</h2><span class="hint">상위 30명</span></div>' +
      '<div class="panel-body">' + body + "</div>" + foot + "</section>";
  }

  function renderNickModal() {
    if (!nickModal.open) return "";
    const current = ranking.myRow ? ranking.myRow.nickname : "";
    return '<div class="overlay" id="nickOverlay">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="닉네임 설정">' +
        '<div class="modal-head"><div class="m-title"><div class="m-name">랭킹 참가</div>' +
          '<div class="m-meta">순위표에 표시될 이름을 정해주세요</div></div>' +
          '<button class="modal-close" id="nickClose" aria-label="닫기">✕</button></div>' +
        '<div class="modal-body">' +
          '<label class="field"><span class="field-label">닉네임 <span class="field-hint">2~12자</span></span>' +
            '<input class="text-input" id="nickInput" type="text" maxlength="12" placeholder="예) 주식왕건우" value="' + escapeHtml(current) + '"' + (nickModal.busy ? " disabled" : "") + "></label>" +
          '<div class="rank-note">닉네임과 수익률, 총자산이 다른 사람에게도 보입니다. 실명이나 개인정보는 쓰지 마세요.</div>' +
          '<div class="err-msg">' + (nickModal.error ? escapeHtml(nickModal.error) : "") + "</div>" +
          '<button class="exec-btn accent" id="nickSubmit"' + (nickModal.busy ? " disabled" : "") + ">" +
            (nickModal.busy ? "저장 중…" : "참가하기") + "</button>" +
        "</div></div></div>";
  }

  function renderModal() {
    if (!modal.open) return "";
    const s = quotes.find((q) => q.symbol === modal.symbol);
    if (!s) return "";

    const isForeign = s.currency !== "KRW";
    const priceKrw = s.priceKrw;
    const held = Store.getHoldingQty(modal.symbol);
    const isBuy = modal.tab === "buy";
    const ready = priceKrw != null && priceKrw > 0;
    const maxQty = isBuy ? (ready ? Math.max(0, Math.floor(portfolio.cash / priceKrw)) : 0) : held;
    const qty = Math.max(1, modal.qty | 0);
    const amountKrw = ready ? qty * priceKrw : null;
    const canExec = ready && qty >= 1 && (isBuy ? amountKrw <= portfolio.cash : qty <= held) && maxQty > 0;

    const fresh = freshness(s);
    const priceLine = money(s.price, s.currency) + (isForeign && priceKrw != null ? " · 약 " + won(priceKrw) : "");
    const amountSub = isForeign ? '<span class="a-sub num">' + money(qty * s.price, s.currency) + "</span>" : "";

    return '<div class="overlay" id="overlay">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + escapeHtml(s.name) + ' 주문">' +
        '<div class="modal-head"><div class="m-title"><div class="m-name">' + escapeHtml(s.name) + "</div>" +
          '<div class="m-meta num"><span class="mkt-badge mkt-' + s.market + '">' + (MARKET_LABEL[s.market] || s.market) + "</span>" +
          escapeHtml(s.code) + " · " + priceLine +
          (fresh.text ? ' <span class="quote-time' + (fresh.live ? " live" : "") + (fresh.stale ? " stale" : "") + '">' + escapeHtml(fresh.text) + "</span>" : "") +
        "</div></div>" +
        '<button class="modal-close" id="modalClose" aria-label="닫기">✕</button></div>' +
        renderChartSection() +
        '<div class="tabbar">' +
          '<button class="tab ' + (isBuy ? "active buy" : "") + '" data-tab="buy">매수</button>' +
          '<button class="tab ' + (!isBuy ? "active sell" : "") + '" data-tab="sell">매도</button>' +
        "</div>" +
        '<div class="modal-body">' +
          (ready ? "" : '<div class="warn-banner">시세나 환율을 아직 못 가져와서 주문할 수 없어요. 잠시 후 다시 시도해 주세요.</div>') +
          '<div class="kv-row"><span>' + (isBuy ? "매수 가능 수량" : "매도 가능 수량") + '</span><span class="v num">' + maxQty.toLocaleString("ko-KR") + "주</span></div>" +
          '<div class="kv-row"><span>' + (isBuy ? "예수금" : "보유 수량") + '</span><span class="v num">' + (isBuy ? won(portfolio.cash) : held.toLocaleString("ko-KR") + "주") + "</span></div>" +
          '<div class="qty-row">' +
            '<button class="qty-btn" id="qtyMinus" aria-label="수량 감소">−</button>' +
            '<input class="qty-input num" id="qtyInput" type="number" inputmode="numeric" min="1" max="' + Math.max(1, maxQty) + '" value="' + qty + '">' +
            '<button class="qty-btn" id="qtyPlus" aria-label="수량 증가">+</button>' +
            '<button class="btn" id="qtyMax">최대</button>' +
          "</div>" +
          '<div class="amount-box"><span class="a-label">주문 금액</span>' +
            '<span class="a-value num">' + (amountKrw != null ? won(amountKrw) : "—") + amountSub + "</span></div>" +
          '<div class="exec-dock">' +
            '<div class="err-msg">' + (modal.error ? escapeHtml(modal.error) : "") + "</div>" +
            '<button class="exec-btn ' + (isBuy ? "buy" : "sell") + '" id="execBtn" ' + (canExec ? "" : "disabled") + ">" +
              (isBuy ? "매수 주문 실행" : "매도 주문 실행") + "</button>" +
          "</div>" +
        "</div></div></div>";
  }

  // 검색 결과 목록만 따로 그립니다 (입력 중에 전체를 다시 그리면 커서가 튀므로)
  function searchListInner() {
    if (addModal.searching) return '<div class="search-msg">찾는 중…</div>';
    if (!addModal.searched) {
      return '<div class="search-msg">종목 이름 일부만 입력해도 찾아줍니다. 예) 삼성, 카카오, apple, 텐센트</div>';
    }
    if (!addModal.results.length) {
      return '<div class="search-msg">검색 결과가 없어요. 아래에서 코드로 직접 추가해 보세요.</div>';
    }
    return addModal.results.map((r, i) => {
      const owned = Store.findBySymbol(r.symbol);
      return '<button class="sr-row" data-index="' + i + '"' + (owned ? " disabled" : "") + ">" +
        '<span class="sr-main"><span class="sr-name">' + escapeHtml(r.name) + "</span>" +
          '<span class="sr-meta num"><span class="mkt-badge mkt-' + r.market + '">' + (MARKET_LABEL[r.market] || r.market) + "</span>" +
          escapeHtml(r.code) + "</span></span>" +
        '<span class="sr-add">' + (owned ? "추가됨" : "추가") + "</span></button>";
    }).join("");
  }

  function paintSearch() {
    const box = document.getElementById("searchResults");
    if (!box) return;
    box.innerHTML = searchListInner();
    box.querySelectorAll(".sr-row").forEach((row) => {
      row.addEventListener("click", () => addFromSearch(parseInt(row.getAttribute("data-index"), 10)));
    });
    const err = document.getElementById("addError");
    if (err) err.textContent = addModal.error || "";
  }

  function renderAddModal() {
    if (!addModal.open) return "";
    const market = markets.find((m) => m.id === addModal.market) || markets[0] || { placeholder: "005930", hint: "" };
    const options = markets.map((m) => '<option value="' + m.id + '"' + (m.id === addModal.market ? " selected" : "") + ">" + escapeHtml(m.label) + "</option>").join("");

    const manualBlock = addModal.manual
      ? '<div class="manual-box">' +
          '<label class="field"><span class="field-label">시장</span>' +
            '<select class="text-input" id="addMarket"' + (addModal.busy ? " disabled" : "") + ">" + options + "</select></label>" +
          '<label class="field"><span class="field-label">종목코드 <span class="field-hint">' + escapeHtml(market.hint || "") + "</span></span>" +
            '<input class="text-input num" id="addCode" type="text" maxlength="10" placeholder="' + escapeHtml(market.placeholder || "") + '" value="' + escapeHtml(addModal.code) + '"' + (addModal.busy ? " disabled" : "") + "></label>" +
          '<button class="exec-btn accent" id="addSubmit"' + (addModal.busy ? " disabled" : "") + ">" + (addModal.busy ? "확인 중…" : "코드로 추가하기") + "</button>" +
        "</div>"
      : "";

    return '<div class="overlay" id="addOverlay">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="종목 추가">' +
        '<div class="modal-head"><div class="m-title"><div class="m-name">종목 추가</div>' +
          '<div class="m-meta">이름이나 코드로 검색하세요</div></div>' +
          '<button class="modal-close" id="addClose" aria-label="닫기">✕</button></div>' +
        '<div class="modal-body">' +
          '<input class="text-input search-input" id="searchInput" type="search" autocomplete="off" ' +
            'placeholder="삼성전자, 카카오, AAPL, 005930 …" value="' + escapeHtml(addModal.query) + '">' +
          '<div class="search-results" id="searchResults">' + searchListInner() + "</div>" +
          '<div class="err-msg" id="addError">' + (addModal.error ? escapeHtml(addModal.error) : "") + "</div>" +
          '<button class="link-btn" id="manualToggle">' + (addModal.manual ? "검색으로 추가하기" : "코드로 직접 추가하기") + "</button>" +
          manualBlock +
        "</div></div></div>";
  }

  function render() {
    app.innerHTML =
      renderHeader() +
      renderSummary() +
      '<main class="layout">' + renderWatchlist() +
        '<div class="side-stack">' + renderPortfolio() + renderRanking() + renderTransactions() + "</div></main>" +
      '<footer class="note">가상의 예수금 ₩10,000,000으로 시작하는 연습용 모의투자입니다 · 실제 매매·투자 판단의 근거로 사용하지 마세요<br>' +
        (Store.getMode() === "cloud"
          ? "잔고와 거래내역은 내 계정에 저장되며, 다른 사람에게는 보이지 않습니다"
          : "잔고와 거래내역은 이 브라우저에만 저장되며, 다른 사람에게는 보이지 않습니다") +
        '<div class="doc-links"><a href="/terms.html">이용약관</a> · <a href="/privacy.html">개인정보처리방침</a></div>' +
      "</footer>" +
      renderModal() + renderAddModal() + renderNickModal();
    bindEvents();
  }

  // ── 이벤트 ────────────────────────────────────────────────
  function openModal(symbol, tab) {
    modal = { open: true, symbol, tab: tab || "buy", qty: 1, error: "" };
    const s = quotes.find((q) => q.symbol === symbol);
    chart = { symbol, range: chart.range || "1d", points: [], loading: Boolean(s), error: !s };
    render();
    if (s) loadChart(s.yahooSymbol, chart.range);
  }
  function closeModal() {
    modal.open = false;
    render();
  }

  function bindEvents() {
    document.querySelectorAll("[data-theme-set]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTheme(btn.getAttribute("data-theme-set"));
        render();
      });
    });

    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.addEventListener("click", async () => {
      authBusy = true;
      authError = "";
      render();
      try {
        await Auth.signInWithGoogle(); // 구글 로그인 화면으로 이동합니다
      } catch (err) {
        authBusy = false;
        authError = "로그인 창을 열지 못했어요. 잠시 후 다시 시도해 주세요.";
        console.warn(err);
        render();
      }
    });

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
      await Store.flush(); // 저장 안 된 변경분을 먼저 밀어 넣고
      await Auth.signOut();
    });

    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.addEventListener("click", () => {
      if (!window.confirm("보유 종목과 거래 내역을 모두 초기화할까요?")) return;
      Store.reset();
      recomputePortfolio();
      render();
    });

    const addStockBtn = document.getElementById("addStockBtn");
    if (addStockBtn) addStockBtn.addEventListener("click", () => {
      addModal = {
        open: true, query: "", results: [], searching: false, searched: false,
        manual: false, market: addModal.market || "KR", code: "", name: "", busy: false, error: "",
      };
      render();
      const el = document.getElementById("searchInput");
      if (el) el.focus();
    });

    const expandBtn = document.getElementById("expandBtn");
    if (expandBtn) expandBtn.addEventListener("click", () => {
      watchExpanded = !watchExpanded;
      render();
      if (!watchExpanded) {
        // 접을 때는 관심종목 위쪽이 보이도록
        const panel = document.querySelector(".panel-watch");
        if (panel) panel.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });

    const manageBtn = document.getElementById("manageBtn");
    if (manageBtn) manageBtn.addEventListener("click", () => {
      manageMode = !manageMode;
      render();
    });

    document.querySelectorAll(".watch-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".pill-btn") || manageMode) return;
        openModal(row.getAttribute("data-symbol"), "buy");
      });
    });
    // 보유 종목을 탭하면 바로 주문창 (매도 탭으로 열림)
    document.querySelectorAll(".hold-row").forEach((row) => {
      row.addEventListener("click", () => openModal(row.getAttribute("data-symbol"), "sell"));
    });

    document.querySelectorAll(".pill-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.getAttribute("data-action");
        const symbol = btn.getAttribute("data-symbol");
        if (action === "remove") return removeStock(symbol);
        openModal(symbol, action);
      });
    });

    bindRankingEvents();
    bindTradeModalEvents();
    bindAddModalEvents();
    bindNickModalEvents();
  }

  function bindRankingEvents() {
    const joinBtn = document.getElementById("joinRankBtn");
    if (joinBtn) joinBtn.addEventListener("click", () => {
      nickModal = { open: true, busy: false, error: "" };
      render();
      const el = document.getElementById("nickInput");
      if (el) el.focus();
    });

    const editBtn = document.getElementById("editNickBtn");
    if (editBtn) editBtn.addEventListener("click", () => {
      nickModal = { open: true, busy: false, error: "" };
      render();
    });

    const leaveBtn = document.getElementById("leaveRankBtn");
    if (leaveBtn) leaveBtn.addEventListener("click", async () => {
      if (!window.confirm("랭킹에서 내 기록을 뺄까요? 언제든 다시 참가할 수 있어요.")) return;
      try {
        await Auth.leaveRanking();
        ranking.myRow = null;
        await loadRankingRows();
        render();
      } catch (err) {
        console.warn(err);
        window.alert("처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  function bindNickModalEvents() {
    const overlay = document.getElementById("nickOverlay");
    if (!overlay) return;
    const close = () => { nickModal.open = false; render(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.getElementById("nickClose").addEventListener("click", close);

    const input = document.getElementById("nickInput");
    const submit = async () => {
      if (nickModal.busy) return;
      const nickname = (input.value || "").trim();
      if (nickname.length < 2) {
        nickModal.error = "닉네임은 2자 이상으로 정해주세요.";
        return render();
      }
      nickModal.busy = true;
      nickModal.error = "";
      render();
      try {
        await Auth.saveRanking(nickname, portfolio.totalAssets, portfolio.totalPnlPct);
        ranking.myRow = { nickname, total_assets: portfolio.totalAssets, return_pct: portfolio.totalPnlPct };
        nickModal = { open: false, busy: false, error: "" };
        await loadRankingRows();
        render();
      } catch (err) {
        console.warn("랭킹 저장 실패:", err);
        const dup = String(err && (err.code || err.message)).includes("23505");
        nickModal.busy = false;
        nickModal.error = dup ? "이미 누가 쓰는 닉네임이에요. 다른 이름으로 해주세요." : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
        render();
      }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    document.getElementById("nickSubmit").addEventListener("click", submit);
  }

  function bindTradeModalEvents() {
    const overlay = document.getElementById("overlay");
    if (!overlay) return;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById("modalClose").addEventListener("click", closeModal);

    // 차트 기간 버튼 (차트 부분만 갱신)
    document.querySelectorAll("#chartChips [data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const range = btn.getAttribute("data-range");
        if (range === chart.range) return;
        chart.range = range;
        const s = quotes.find((q) => q.symbol === modal.symbol);
        paintChart();
        if (s) loadChart(s.yahooSymbol, range);
      });
    });

    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => {
        modal.tab = t.getAttribute("data-tab");
        modal.qty = 1;
        modal.error = "";
        render();
      });
    });

    const qtyInput = document.getElementById("qtyInput");
    document.getElementById("qtyMinus").addEventListener("click", () => {
      modal.qty = Math.max(1, (modal.qty | 0) - 1); modal.error = ""; render();
    });
    document.getElementById("qtyPlus").addEventListener("click", () => {
      modal.qty = (modal.qty | 0) + 1; modal.error = ""; render();
    });
    document.getElementById("qtyMax").addEventListener("click", () => {
      const s = quotes.find((q) => q.symbol === modal.symbol);
      const held = Store.getHoldingQty(modal.symbol);
      const unitKrw = s && s.priceKrw ? s.priceKrw : 1;
      modal.qty = modal.tab === "buy" ? Math.max(1, Math.floor(portfolio.cash / unitKrw)) : Math.max(1, held);
      modal.error = ""; render();
    });
    qtyInput.addEventListener("change", () => {
      const v = parseInt(qtyInput.value, 10);
      modal.qty = Number.isFinite(v) && v > 0 ? v : 1;
      modal.error = ""; render();
    });

    const execBtn = document.getElementById("execBtn");
    if (execBtn) execBtn.addEventListener("click", executeTrade);
  }

  function executeTrade() {
    const s = quotes.find((q) => q.symbol === modal.symbol);
    if (!s || s.priceKrw == null) {
      modal.error = "시세를 확인할 수 없어 주문할 수 없어요.";
      return render();
    }
    const qty = Math.max(1, modal.qty | 0);
    try {
      Store.trade(s.symbol, modal.tab, qty, s.priceKrw, s.price, s.currency, s.name);
      recomputePortfolio();
      closeModal();
    } catch (err) {
      const msgMap = {
        INSUFFICIENT_CASH: "예수금이 부족합니다.",
        INSUFFICIENT_HOLDINGS: "보유 수량보다 많이 매도할 수 없습니다.",
      };
      modal.error = msgMap[err.message] || "주문을 처리하지 못했어요.";
      render();
    }
  }

  let searchTimer = null;

  async function runSearch(query) {
    addModal.searching = true;
    addModal.error = "";
    paintSearch();
    try {
      const data = await fetchJSON("/api/search?q=" + encodeURIComponent(query));
      if (addModal.query.trim() !== query) return; // 그 사이 더 입력했으면 무시
      addModal.results = data.results || [];
    } catch {
      addModal.results = [];
      addModal.error = "검색 중 오류가 났어요. 잠시 후 다시 시도해 주세요.";
    }
    addModal.searching = false;
    addModal.searched = true;
    paintSearch();
  }

  function addFromSearch(index) {
    const item = addModal.results[index];
    if (!item) return;
    try {
      Store.addItem({
        symbol: item.symbol,
        code: item.code,
        market: item.market,
        currency: item.currency,
        yahooSymbol: item.yahooSymbol,
        name: item.name,
        sector: item.sector,
      });
      addModal.open = false;
      loadHistory().then(refreshAll);
      render();
    } catch (err) {
      addModal.error = addErrorMessage(err.message);
      paintSearch();
    }
  }

  function addErrorMessage(code) {
    return {
      SYMBOL_NOT_FOUND: "그 코드로 종목을 찾지 못했어요. 시장과 코드를 확인해 주세요.",
      ALREADY_EXISTS: "이미 목록에 있는 종목이에요.",
      WATCHLIST_FULL: "종목은 최대 40개까지 담을 수 있어요.",
      INVALID_CODE: "종목코드 형식이 맞지 않아요.",
      LOOKUP_FAILED: "종목을 확인하는 중 오류가 났어요. 잠시 후 다시 시도해 주세요.",
    }[code] || "종목을 추가하지 못했어요.";
  }

  function bindAddModalEvents() {
    const overlay = document.getElementById("addOverlay");
    if (!overlay) return;
    const close = () => { addModal.open = false; render(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.getElementById("addClose").addEventListener("click", close);

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        addModal.query = searchInput.value;
        clearTimeout(searchTimer);
        const q = addModal.query.trim();
        if (q.length < 1) {
          addModal.results = [];
          addModal.searched = false;
          addModal.searching = false;
          return paintSearch();
        }
        searchTimer = setTimeout(() => runSearch(q), 350);
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        clearTimeout(searchTimer);
        const q = addModal.query.trim();
        if (q) runSearch(q);
      });
    }

    const manualToggle = document.getElementById("manualToggle");
    if (manualToggle) manualToggle.addEventListener("click", () => {
      addModal.manual = !addModal.manual;
      addModal.error = "";
      render();
    });

    // 아래는 '코드로 직접 추가'를 폈을 때만 존재합니다
    const marketSelect = document.getElementById("addMarket");
    if (marketSelect) marketSelect.addEventListener("change", () => {
      addModal.market = marketSelect.value;
      addModal.code = "";
      addModal.error = "";
      render();
    });

    const codeInput = document.getElementById("addCode");
    if (codeInput) {
      codeInput.addEventListener("input", () => {
        addModal.code = addModal.market === "US"
          ? codeInput.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, "")
          : codeInput.value.replace(/\D/g, "");
        codeInput.value = addModal.code;
      });
      codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAddStock(); });
    }
    const submit = document.getElementById("addSubmit");
    if (submit) submit.addEventListener("click", submitAddStock);
  }

  async function submitAddStock() {
    if (addModal.busy) return;
    const code = (addModal.code || "").trim();
    if (!code) {
      addModal.error = "종목코드를 입력해 주세요.";
      return render();
    }
    addModal.busy = true;
    addModal.error = "";
    render();

    try {
      const data = await fetchJSON(`/api/lookup?market=${encodeURIComponent(addModal.market)}&code=${encodeURIComponent(code)}`);
      const item = data.item;
      Store.addItem({
        symbol: item.symbol,
        code: item.code,
        market: item.market,
        currency: item.currency,
        yahooSymbol: item.yahooSymbol,
        name: item.name,
        sector: item.sector,
      });
      addModal.open = false;
      addModal.busy = false;
      addModal.code = "";
      render();
      await loadHistory();
      await refreshAll();
    } catch (err) {
      addModal.busy = false;
      addModal.error = addErrorMessage(err.message);
      render();
    }
  }

  function removeStock(symbol) {
    const meta = Store.findBySymbol(symbol);
    if (!window.confirm(`'${meta ? meta.name : symbol}' 을(를) 목록에서 삭제할까요?`)) return;
    try {
      Store.removeItem(symbol);
      refreshAll();
    } catch (err) {
      const msgMap = {
        STILL_HOLDING: "보유 중인 종목이에요. 전량 매도한 뒤에 삭제할 수 있어요.",
        LAST_ITEM: "최소 한 종목은 남아 있어야 해요.",
      };
      window.alert(msgMap[err.message] || "삭제하지 못했어요.");
    }
  }

  // ── 로그인 / 계정 데이터 ───────────────────────────────────
  // 로그인 상태로 들어갈 때: 계정에 저장된 게 있으면 그걸 쓰고,
  // 없으면 게스트로 하던 기록을 계정으로 옮깁니다.
  async function enterAccount() {
    authBusy = true;
    authError = "";
    render();

    const guestSnapshot = Store.getSnapshot();
    const guestHadData = Store.hasActivity();

    try {
      const remote = await Auth.loadRemote();
      Store.useCloud(Auth.saveRemote);

      if (remote) {
        Store.applySnapshot(remote);
        authNotice = "";
      } else if (guestHadData) {
        Store.applySnapshot(guestSnapshot);
        await Auth.saveRemote(Store.getSnapshot());
        Store.clearLocal(); // 계정으로 옮겼으니 브라우저에 남은 사본은 정리
        authNotice = "게스트로 하던 잔고와 거래내역을 계정으로 옮겼어요.";
      } else {
        Store.startFresh();
        await Auth.saveRemote(Store.getSnapshot());
        authNotice = "";
      }
    } catch (err) {
      console.warn("계정 데이터 오류:", err);
      Store.useLocal();
      authError = "계정 데이터를 불러오지 못했어요. 이번에는 이 브라우저에만 저장됩니다.";
    }

    authBusy = false;
    historyLoaded.clear();
    await loadMyRank();
    await loadHistory();
    await refreshAll();
    loadRankingRows().then(() => render());
  }

  // 로그아웃할 때: 이 브라우저에 저장돼 있던 게스트 데이터로 돌아갑니다.
  async function leaveAccount() {
    Store.useLocal();
    authNotice = "";
    authError = "";
    ranking.myRow = null;
    historyLoaded.clear();
    await loadHistory();
    await refreshAll();
  }

  async function handleAuthChange(user) {
    if (user) await enterAccount();
    else await leaveAccount();
  }

  // ── 시작 ──────────────────────────────────────────────────
  async function boot() {
    try {
      const res = await fetchJSON("/api/markets");
      markets = res.markets || [];
    } catch {
      markets = [];
    }

    // 저장 상태(저장 중/저장됨/실패)가 바뀌면 헤더만 다시 그립니다.
    Store.onSync(() => {
      if (!modal.open && !addModal.open) render();
    });

    await loadHistory();
    await refreshAll();

    // 로그인 확인은 화면을 먼저 띄운 다음에 (첫 화면이 늦어지지 않도록)
    if (Auth.configured) {
      try {
        const user = await Auth.init(handleAuthChange);
        if (user) await enterAccount();
        else render();
      } catch (err) {
        console.warn("로그인 초기화 실패:", err);
      }

      // 랭킹은 로그인 안 해도 볼 수 있습니다
      await loadRankingRows();
      render();
      setInterval(() => {
        if (document.visibilityState !== "visible" || modal.open || addModal.open || nickModal.open) return;
        loadRankingRows().then(() => render());
      }, 120000);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        Store.flush(); // 탭을 떠나기 전에 저장 안 된 변경분을 밀어 넣고
      } else {
        pollTick(); // 돌아오면 기다리지 않고 바로 최신 시세로
      }
    });

    scheduleNextPoll();
  }

  boot().catch((err) => {
    app.innerHTML = '<p class="loading">시작하지 못했습니다: ' + escapeHtml(err.message) + "</p>";
  });
})();
