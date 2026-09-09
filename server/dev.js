// 로컬 개발용 서버.
// Vercel에 올라가면 api/ 폴더의 함수들이 대신 실행되므로, 이 파일은 배포에 쓰이지 않습니다.
// (내 컴퓨터에서 npm run dev 로 켤 때만 사용)
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import {
  marketsHandler,
  quotesHandler,
  lookupHandler,
  historyHandler,
  searchHandler,
  chartHandler,
} from "../lib/handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// 로컬에서는 프로젝트 루트의 정적 파일을 그대로 서빙합니다 (Vercel과 동일한 구조)
const ROOT = path.join(__dirname, "..");
["/index.html", "/app.js", "/store.js", "/auth.js", "/config.js", "/styles.css", "/privacy.html", "/terms.html"].forEach((f) => {
  app.get(f, (req, res) => res.sendFile(path.join(ROOT, f)));
});
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));

app.get("/api/markets", (req, res) => {
  res.json(marketsHandler());
});

app.get("/api/quotes", async (req, res) => {
  try {
    res.json(await quotesHandler(req.query));
  } catch (err) {
    console.error("[quotes]", err.message);
    res.status(502).json({ error: "QUOTE_FETCH_FAILED", message: err.message });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    res.json(await historyHandler(req.query));
  } catch (err) {
    res.status(502).json({ error: "HISTORY_FETCH_FAILED", message: err.message });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    res.json(await searchHandler(req.query));
  } catch (err) {
    console.error("[search]", err.message);
    res.status(502).json({ error: "SEARCH_FAILED", message: err.message });
  }
});

app.get("/api/chart", async (req, res) => {
  try {
    const data = await chartHandler(req.query);
    if (data.error) return res.status(400).json(data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "CHART_FETCH_FAILED", message: err.message });
  }
});

app.get("/api/lookup", async (req, res) => {
  try {
    const data = await lookupHandler(req.query);
    if (data.error) return res.status(data.error === "SYMBOL_NOT_FOUND" ? 404 : 400).json(data);
    res.json(data);
  } catch (err) {
    console.error("[lookup]", err.message);
    res.status(502).json({ error: "LOOKUP_FAILED", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`모의투자 서버 실행 중: http://localhost:${PORT}`);
});
