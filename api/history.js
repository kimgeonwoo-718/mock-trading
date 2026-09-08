import { historyHandler } from "../lib/handlers.js";

export default async function handler(req, res) {
  try {
    const data = await historyHandler(req.query || {});
    res.setHeader("Cache-Control", "public, max-age=120");
    res.status(200).json(data);
  } catch (err) {
    console.error("[history]", err);
    res.status(502).json({ error: "HISTORY_FETCH_FAILED", message: err.message });
  }
}
