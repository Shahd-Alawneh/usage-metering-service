
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";

const router = Router();

const createAccountSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = createAccountSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid account data",
        details: parsed.error.issues,
      });
      return;
    }

    const apiKey = `ums_${randomBytes(32).toString("hex")}`;
    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const result = await pool.query(
      `INSERT INTO accounts (name, api_key_hash, current_plan_id)
       SELECT $1, $2, id
       FROM plans
       WHERE scope = 'account'
         AND name = 'Starter'
         AND is_builtin = TRUE
       RETURNING id, name, current_plan_id, created_at`,
      [parsed.data.name, apiKeyHash],
    );

    if (result.rowCount !== 1) {
      throw new Error("Default Starter account plan was not found");
    }

    res.status(201).json({
      account: result.rows[0],
      apiKey,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

