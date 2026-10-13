import plansRouter from "./routes/plans.js";
import usageRouter from "./routes/usage.js";
import express from "express";
import { pool } from "./db/pool.js";
import accountsRouter from "./routes/accounts.js";
import usersRouter from "./routes/users.js";

const app = express();

app.use(express.json());
app.use(express.static("client"));

app.use("/usage", usageRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "usage-metering-service",
  });
});

app.get("/db/health", async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, current_user AS db_user",
    );

    res.status(200).json({
      status: "ok",
      database: result.rows[0].database,
      user: result.rows[0].db_user,
    });
  } catch (error) {
    next(error);
  }
});

app.use("/accounts", accountsRouter);
app.use("/users", usersRouter);
app.use("/plans", plansRouter);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Request failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  },
);

export default app;
