import { chartHandler } from "../lib/handlers.js";

export default async function handler(req, res) {
  try {
    const data = await chartHandler(req.query || {});
    if (data.error) return res.status(400).json(data);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json(data);
  } catch (err) {
    console.error("[chart]", err);
    res.status(502).json({ error: "CHART_FETCH_FAILED", message: err.message });
  }
}
