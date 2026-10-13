
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { pool } from "../db/pool.js";

export const authenticateApiKey: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey || apiKey.length > 200) {
      res.status(401).json({ error: "Missing or invalid API key" });
      return;
    }

    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const result = await pool.query(
      `SELECT id
       FROM accounts
       WHERE api_key_hash = $1`,
      [apiKeyHash],
    );

    if (result.rowCount !== 1) {
      res.status(401).json({ error: "Missing or invalid API key" });
      return;
    }

    res.locals.accountId = result.rows[0].id as string;
    next();
  } catch (error) {
    next(error);
  }
};

