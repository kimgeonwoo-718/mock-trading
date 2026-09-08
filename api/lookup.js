import { lookupHandler } from "../lib/handlers.js";

export default async function handler(req, res) {
  try {
    const data = await lookupHandler(req.query || {});
    if (data.error) {
      res.status(data.error === "SYMBOL_NOT_FOUND" ? 404 : 400).json(data);
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    console.error("[lookup]", err);
    res.status(502).json({ error: "LOOKUP_FAILED", message: err.message });
  }
}
