import { searchHandler } from "../lib/handlers.js";

export default async function handler(req, res) {
  try {
    const data = await searchHandler(req.query || {});
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(data);
  } catch (err) {
    console.error("[search]", err);
    res.status(502).json({ error: "SEARCH_FAILED", message: err.message });
  }
}
