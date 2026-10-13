import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticateApiKey } from "../middleware/authenticateApiKey.js";

const router = Router();

router.use(authenticateApiKey);

const createPlanSchema = z.object({
  scope: z.enum(["account", "user"]),
  name: z.string().trim().min(2).max(100),
  monthlyAllowance: z.number().int().nonnegative().safe(),
  maxUnitsPerRequest: z.number().int().positive().safe(),
});

const assignPlanSchema = z.object({
  planId: z.string().uuid(),
});

// List built-in plans and plans owned by this account.
router.get("/", async (_req, res, next) => {
  try {
    const accountId = res.locals.accountId as string;

    const result = await pool.query(
      `SELECT id, scope, name, monthly_allowance,
              max_units_per_request, is_builtin
       FROM plans
       WHERE is_builtin = TRUE OR owner_account_id = $1
       ORDER BY scope, name`,
      [accountId],
    );

    res.status(200).json({ plans: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create an account-specific custom plan.
router.post("/", async (req, res, next) => {
  const parsed = createPlanSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid plan data",
      details: parsed.error.issues,
    });
    return;
  }

  try {
    const accountId = res.locals.accountId as string;
    const { scope, name, monthlyAllowance, maxUnitsPerRequest } =
      parsed.data;

    const result = await pool.query(
      `INSERT INTO plans (
         owner_account_id, scope, name, monthly_allowance,
         max_units_per_request, is_builtin
       )
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, owner_account_id, scope, name,
                 monthly_allowance, max_units_per_request, is_builtin`,
      [accountId, scope, name, monthlyAllowance, maxUnitsPerRequest],
    );

    res.status(201).json({ plan: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Change the current account plan.
router.patch("/account/current", async (req, res, next) => {
  const parsed = assignPlanSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid plan assignment",
      details: parsed.error.issues,
    });
    return;
  }

  try {
    const accountId = res.locals.accountId as string;

    const result = await pool.query(
      `UPDATE accounts a
       SET current_plan_id = p.id
       FROM plans p
       WHERE a.id = $1
         AND p.id = $2
         AND p.scope = 'account'
         AND (p.is_builtin = TRUE OR p.owner_account_id = a.id)
       RETURNING a.id, a.name, a.current_plan_id`,
      [accountId, parsed.data.planId],
    );

    if (result.rowCount !== 1) {
      res.status(400).json({
        error: "Plan not found or not valid for this account",
      });
      return;
    }

    res.status(200).json({ account: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Change a user's current plan within this account.
router.patch("/users/:userId/current", async (req, res, next) => {
  const parsed = assignPlanSchema.safeParse(req.body);
  const userId = z.string().uuid().safeParse(req.params.userId);

  if (!parsed.success || !userId.success) {
    res.status(400).json({ error: "Invalid user or plan ID" });
    return;
  }

  try {
    const accountId = res.locals.accountId as string;

    const result = await pool.query(
      `UPDATE users u
       SET current_plan_id = p.id
       FROM plans p
       WHERE u.id = $1
         AND u.account_id = $2
         AND p.id = $3
         AND p.scope = 'user'
         AND (p.is_builtin = TRUE OR p.owner_account_id = u.account_id)
       RETURNING u.id, u.account_id, u.name, u.current_plan_id`,
      [userId.data, accountId, parsed.data.planId],
    );

    if (result.rowCount !== 1) {
      res.status(400).json({
        error: "User or plan not found, or plan not valid for this user",
      });
      return;
    }

    res.status(200).json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
