
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticateApiKey } from "../middleware/authenticateApiKey.js";

const router = Router();

const usageSchema = z.object({
  userId: z.string().uuid(),
  requestId: z.string().trim().min(1).max(200),
  units: z.number().int().positive().safe(),
});

router.get("/summary", authenticateApiKey, async (_req, res, next) => {
  try {
    const accountId = res.locals.accountId as string;

    const periodStart = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
      ),
    )
      .toISOString()
      .slice(0, 10);

    const accountResult = await pool.query(
      `SELECT
         a.id AS account_id,
         a.name AS account_name,
         p.id AS plan_id,
         p.name AS plan_name,
         p.monthly_allowance,
         p.max_units_per_request,
         COALESCE(up.units_consumed, 0) AS consumed
       FROM accounts a
       JOIN plans p ON p.id = a.current_plan_id
       LEFT JOIN usage_periods up
         ON up.account_id = a.id
        AND up.user_id IS NULL
        AND up.period_start = $2::date
       WHERE a.id = $1`,
      [accountId, periodStart],
    );

    if (accountResult.rowCount !== 1) {
      res.status(404).json({ error: "Account or current plan not found" });
      return;
    }

    const userResult = await pool.query(
      `SELECT
         u.id AS user_id,
         u.name AS user_name,
         p.id AS plan_id,
         p.name AS plan_name,
         p.monthly_allowance,
         p.max_units_per_request,
         COALESCE(up.units_consumed, 0) AS consumed
       FROM users u
       JOIN plans p ON p.id = u.current_plan_id
       LEFT JOIN usage_periods up
         ON up.account_id = u.account_id
        AND up.user_id = u.id
        AND up.period_start = $2::date
       WHERE u.account_id = $1
       ORDER BY u.name, u.id`,
      [accountId, periodStart],
    );

    const account = accountResult.rows[0];
    const accountAllowance = Number(account.monthly_allowance);
    const accountConsumed = Number(account.consumed);

    res.status(200).json({
      periodStart,
      account: {
        id: account.account_id,
        name: account.account_name,
        plan: {
          id: account.plan_id,
          name: account.plan_name,
          monthlyAllowance: accountAllowance,
          maxUnitsPerRequest: Number(account.max_units_per_request),
        },
        consumed: accountConsumed,
        remaining: Math.max(0, accountAllowance - accountConsumed),
      },
      users: userResult.rows.map((user) => {
        const allowance = Number(user.monthly_allowance);
        const consumed = Number(user.consumed);

        return {
          id: user.user_id,
          name: user.user_name,
          plan: {
            id: user.plan_id,
            name: user.plan_name,
            monthlyAllowance: allowance,
            maxUnitsPerRequest: Number(user.max_units_per_request),
          },
          consumed,
          remaining: Math.max(0, allowance - consumed),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", authenticateApiKey, async (req, res, next) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const userId = req.query.userId;
  const month = req.query.month;

  if (
    !Number.isSafeInteger(page) || page < 1 ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100
  ) {
    res.status(400).json({
      error: "page must be positive and limit must be between 1 and 100",
    });
    return;
  }

  if (userId !== undefined &&
      (typeof userId !== "string" || !z.string().uuid().safeParse(userId).success)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  if (month !== undefined &&
      (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    res.status(400).json({ error: "month must use YYYY-MM format" });
    return;
  }

  try {
    const accountId = res.locals.accountId as string;
    const conditions = ["account_id = $1"];
    const values: unknown[] = [accountId];

    if (typeof userId === "string") {
      values.push(userId);
      conditions.push(`user_id = $${values.length}`);
    }

    if (typeof month === "string") {
      values.push(`${month}-01`);
      conditions.push(`period_start = $${values.length}::date`);
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM usage_requests
       WHERE ${whereClause}`,
      values,
    );

    const total = countResult.rows[0].total as number;
    const offset = (page - 1) * limit;

    const rowsResult = await pool.query(
      `SELECT id, request_id, user_id, units, status,
              rejection_scope, rejection_rule,
              TO_CHAR(period_start, 'YYYY-MM-DD') AS period_start,
              created_at,
              account_plan_id, user_plan_id,
              account_monthly_allowance, account_max_units_per_request,
              user_monthly_allowance, user_max_units_per_request
       FROM usage_requests
       WHERE ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    res.status(200).json({
      requests: rowsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", authenticateApiKey, async (req, res, next) => {
  const parsed = usageSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid usage request",
      details: parsed.error.issues,
    });
    return;
  }

  const accountId = res.locals.accountId as string;
  const { userId, requestId, units } = parsed.data;

  const now = new Date();
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  )
    .toISOString()
    .slice(0, 10);

  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;

    // Serialize usage operations for this account.
    const accountResult = await client.query(
      `SELECT a.id, a.current_plan_id,
              p.monthly_allowance, p.max_units_per_request
       FROM accounts a
       JOIN plans p ON p.id = a.current_plan_id
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [accountId],
    );

    if (accountResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      inTransaction = false;
      res.status(409).json({
        error: "Account has no valid account plan",
      });
      return;
    }

    const account = accountResult.rows[0];

    // Check idempotency before processing the request again.
    const previousResult = await client.query(
      `SELECT user_id, units, status, rejection_scope,
              rejection_rule,
              TO_CHAR(period_start, 'YYYY-MM-DD') AS period_start
        FROM usage_requests
       WHERE account_id = $1 AND request_id = $2`,
      [accountId, requestId],
    );

    if (previousResult.rowCount === 1) {
      const previous = previousResult.rows[0];

      if (
        previous.user_id !== userId ||
        Number(previous.units) !== units
      ) {
        await client.query("ROLLBACK");
        inTransaction = false;
        res.status(409).json({
          error: "requestId was already used with a different payload",
        });
        return;
      }

      await client.query("COMMIT");
      inTransaction = false;

      res.status(200).json({
        requestId,
        status: previous.status,
        rejectionScope: previous.rejection_scope,
        rejectionRule: previous.rejection_rule,
        periodStart: previous.period_start,
        replayed: true,
      });
      return;
    }

    // Lock and validate that the user belongs to this account.
    const userResult = await client.query(
      `SELECT u.id, u.current_plan_id,
              p.monthly_allowance, p.max_units_per_request
       FROM users u
       JOIN plans p ON p.id = u.current_plan_id
       WHERE u.id = $1 AND u.account_id = $2
       FOR UPDATE OF u`,
      [userId, accountId],
    );

    if (userResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      inTransaction = false;
      res.status(404).json({
        error: "User not found in this account or has no valid user plan",
      });
      return;
    }

    const user = userResult.rows[0];

    // Read current monthly account and user usage.
    const usageResult = await client.query(
      `SELECT user_id, units_consumed
       FROM usage_periods
       WHERE account_id = $1
         AND period_start = $2
         AND (user_id IS NULL OR user_id = $3)`,
      [accountId, periodStart, userId],
    );

    let accountConsumed = 0;
    let userConsumed = 0;

    for (const row of usageResult.rows) {
      if (row.user_id === null) {
        accountConsumed = Number(row.units_consumed);
      } else {
        userConsumed = Number(row.units_consumed);
      }
    }

    // Determine one rejection reason, in priority order.
    let rejectionScope: "account" | "user" | null = null;
    let rejectionRule: string | null = null;

    if (units > Number(account.max_units_per_request)) {
      rejectionScope = "account";
      rejectionRule = "max_units_per_request";
    } else if (units > Number(user.max_units_per_request)) {
      rejectionScope = "user";
      rejectionRule = "max_units_per_request";
    } else if (
      accountConsumed + units > Number(account.monthly_allowance)
    ) {
      rejectionScope = "account";
      rejectionRule = "monthly_allowance";
    } else if (
      userConsumed + units > Number(user.monthly_allowance)
    ) {
      rejectionScope = "user";
      rejectionRule = "monthly_allowance";
    }

    const status = rejectionScope === null ? "accepted" : "rejected";

    // Only accepted requests change the usage totals.
    if (status === "accepted") {
      await client.query(
        `INSERT INTO usage_periods
           (account_id, user_id, period_start, units_consumed)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (account_id, period_start)
           WHERE user_id IS NULL
         DO UPDATE SET
           units_consumed = usage_periods.units_consumed + EXCLUDED.units_consumed,
           updated_at = NOW()`,
        [accountId, periodStart, units],
      );

      await client.query(
        `INSERT INTO usage_periods
           (account_id, user_id, period_start, units_consumed)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, user_id, period_start)
           WHERE user_id IS NOT NULL
         DO UPDATE SET
           units_consumed = usage_periods.units_consumed + EXCLUDED.units_consumed,
           updated_at = NOW()`,
        [accountId, userId, periodStart, units],
      );
    }

    // Store both accepted and rejected decisions.
    await client.query(
      `INSERT INTO usage_requests (
         account_id, user_id, request_id, units, status,
         rejection_scope, rejection_rule, period_start,
         account_plan_id, user_plan_id,
         account_monthly_allowance, account_max_units_per_request,
         user_monthly_allowance, user_max_units_per_request
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14
       )`,
      [
        accountId,
        userId,
        requestId,
        units,
        status,
        rejectionScope,
        rejectionRule,
        periodStart,
        account.current_plan_id,
        user.current_plan_id,
        account.monthly_allowance,
        account.max_units_per_request,
        user.monthly_allowance,
        user.max_units_per_request,
      ],
    );

    await client.query("COMMIT");
    inTransaction = false;

    res.status(200).json({
      requestId,
      status,
      units,
      rejectionScope,
      rejectionRule,
      periodStart,
      replayed: false,
    });
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    next(error);
  } finally {
    client.release();
  }
});

export default router;

