
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticateApiKey } from "../middleware/authenticateApiKey.js";

const router = Router();

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

router.post("/", authenticateApiKey, async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid user data",
        details: parsed.error.issues,
      });
      return;
    }

    const accountId = res.locals.accountId as string;

    const result = await pool.query(
      `INSERT INTO users (account_id, name, current_plan_id)
       SELECT $1, $2, id
       FROM plans
       WHERE scope = 'user'
         AND name = 'Basic'
         AND is_builtin = TRUE
       RETURNING id, account_id, name, current_plan_id, created_at`,
      [accountId, parsed.data.name],
    );

    if (result.rowCount !== 1) {
      throw new Error("Default Basic user plan was not found");
    }

    res.status(201).json({
      user: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

export default router;

