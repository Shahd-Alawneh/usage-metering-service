
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";

describe("Usage Metering API integration tests", () => {
  let apiKey: string;
  let userId: string;

  beforeAll(async () => {
    const accountResponse = await request(app)
      .post("/accounts")
      .send({ name: `Test Account ${Date.now()}` });

    expect(accountResponse.status).toBe(201);
    apiKey = accountResponse.body.apiKey;

    const userResponse = await request(app)
      .post("/users")
      .set("x-api-key", apiKey)
      .send({ name: "Integration Test User" });

    expect(userResponse.status).toBe(201);
    userId = userResponse.body.user.id;
  }, 15000);

  afterAll(async () => {
    await pool.end();
  });

  it("accepts valid usage and records it", async () => {
    const response = await request(app)
      .post("/usage")
      .set("x-api-key", apiKey)
      .send({
        userId,
        requestId: "integration-accepted-001",
        units: 10,
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("accepted");
    expect(response.body.replayed).toBe(false);
  });

  it("does not count the same request twice", async () => {
    const response = await request(app)
      .post("/usage")
      .set("x-api-key", apiKey)
      .send({
        userId,
        requestId: "integration-accepted-001",
        units: 10,
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("accepted");
    expect(response.body.replayed).toBe(true);

    const result = await pool.query(
      `SELECT units_consumed
       FROM usage_periods
       WHERE user_id = $1
         AND period_start = DATE_TRUNC(
           'month', NOW() AT TIME ZONE 'UTC'
         )::date`,
      [userId],
    );

    expect(Number(result.rows[0].units_consumed)).toBe(10);
  });

  it("rejects reusing a request ID with a different payload", async () => {
    const response = await request(app)
      .post("/usage")
      .set("x-api-key", apiKey)
      .send({
        userId,
        requestId: "integration-accepted-001",
        units: 11,
      });

    expect(response.status).toBe(409);
  });

  it("rejects usage above the user's per-request limit without counting it", async () => {
    const response = await request(app)
      .post("/usage")
      .set("x-api-key", apiKey)
      .send({
        userId,
        requestId: "integration-rejected-001",
        units: 25,
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("rejected");
    expect(response.body.rejectionScope).toBe("user");
    expect(response.body.rejectionRule).toBe("max_units_per_request");

    const result = await pool.query(
      `SELECT units_consumed
       FROM usage_periods
       WHERE user_id = $1
         AND period_start = DATE_TRUNC(
           'month', NOW() AT TIME ZONE 'UTC'
         )::date`,
      [userId],
    );

    expect(Number(result.rows[0].units_consumed)).toBe(10);
  });

  it("rejects requests without an API key", async () => {
    const response = await request(app)
      .post("/usage")
      .send({
        userId,
        requestId: "integration-no-key",
        units: 1,
      });

    expect(response.status).toBe(401);
  });

  it("returns paginated usage history for the account", async () => {
    const response = await request(app)
      .get("/usage?page=1&limit=10")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.requests)).toBe(true);
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.limit).toBe(10);
    expect(response.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("does not allow one account to consume usage for another account's user", async () => {
    const otherAccountResponse = await request(app)
      .post("/accounts")
      .send({ name: `Other Test Account ${Date.now()}` });

    expect(otherAccountResponse.status).toBe(201);
    const otherApiKey = otherAccountResponse.body.apiKey;

    const otherUserResponse = await request(app)
      .post("/users")
      .set("x-api-key", otherApiKey)
      .send({ name: "Other Account User" });

    expect(otherUserResponse.status).toBe(201);
    const otherUserId = otherUserResponse.body.user.id;

    const response = await request(app)
      .post("/usage")
      .set("x-api-key", apiKey)
      .send({
        userId: otherUserId,
        requestId: "cross-account-isolation-001",
        units: 1,
      });

    expect(response.status).toBe(404);
  });

  it("rejects usage exceeding the account's monthly allowance without counting it", async () => {
    const accountResponse = await request(app)
      .post("/accounts")
      .send({ name: `Monthly Limit Account ${Date.now()}` });

    expect(accountResponse.status).toBe(201);

    const limitedApiKey = accountResponse.body.apiKey;
    const limitedAccountId = accountResponse.body.account.id;

    const userResponse = await request(app)
      .post("/users")
      .set("x-api-key", limitedApiKey)
      .send({ name: "Monthly Limit User" });

    expect(userResponse.status).toBe(201);
    const limitedUserId = userResponse.body.user.id;

    // Create a custom plan instead of modifying the shared Starter plan.
    const planResponse = await request(app)
      .post("/plans")
      .set("x-api-key", limitedApiKey)
      .send({
        scope: "account",
        name: `Limited Test Plan ${Date.now()}`,
        monthlyAllowance: 15,
        maxUnitsPerRequest: 100,
      });

    expect(planResponse.status).toBe(201);
    const planId = planResponse.body.plan.id;

    // Assign the custom plan to this account.
    const assignPlanResponse = await request(app)
      .patch("/plans/account/current")
      .set("x-api-key", limitedApiKey)
      .send({ planId });

    expect(assignPlanResponse.status).toBe(200);

    // First request: 10 units should be accepted.
    const firstResponse = await request(app)
      .post("/usage")
      .set("x-api-key", limitedApiKey)
      .send({
        userId: limitedUserId,
        requestId: `monthly-limit-first-${Date.now()}`,
        units: 10,
      });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.status).toBe("accepted");

    // Second request: another 10 would exceed the allowance of 15.
    const secondResponse = await request(app)
      .post("/usage")
      .set("x-api-key", limitedApiKey)
      .send({
        userId: limitedUserId,
        requestId: `monthly-limit-second-${Date.now()}`,
        units: 10,
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.status).toBe("rejected");
    expect(secondResponse.body.rejectionScope).toBe("account");
    expect(secondResponse.body.rejectionRule).toBe("monthly_allowance");

    // The rejected request must not increase either usage total.
    const usageResult = await pool.query(
      `SELECT user_id, units_consumed
       FROM usage_periods
       WHERE account_id = $1
         AND period_start = DATE_TRUNC(
           'month', NOW() AT TIME ZONE 'UTC'
         )::date
         AND (user_id = $2 OR user_id IS NULL)
       ORDER BY user_id NULLS FIRST`,
      [limitedAccountId, limitedUserId],
    );

    expect(usageResult.rows).toHaveLength(2);

    const accountUsage = usageResult.rows.find(
      (row) => row.user_id === null,
    );

    const userUsage = usageResult.rows.find(
      (row) => row.user_id === limitedUserId,
    );

    expect(Number(accountUsage?.units_consumed)).toBe(10);
    expect(Number(userUsage?.units_consumed)).toBe(10);
  });

  
  it("applies custom plan updates without resetting existing usage", async () => {
    const accountResponse = await request(app)
      .post("/accounts")
      .send({ name: `Plan Update Account ${Date.now()}` });

    expect(accountResponse.status).toBe(201);

    const testApiKey = accountResponse.body.apiKey;
    const accountId = accountResponse.body.account.id;

    const userResponse = await request(app)
      .post("/users")
      .set("x-api-key", testApiKey)
      .send({ name: "Plan Update User" });

    expect(userResponse.status).toBe(201);
    const testUserId = userResponse.body.user.id;

    const planResponse = await request(app)
      .post("/plans")
      .set("x-api-key", testApiKey)
      .send({
        scope: "account",
        name: `Update Test Plan ${Date.now()}`,
        monthlyAllowance: 100,
        maxUnitsPerRequest: 100,
      });

    expect(planResponse.status).toBe(201);
    const planId = planResponse.body.plan.id;

    const assignResponse = await request(app)
      .patch("/plans/account/current")
      .set("x-api-key", testApiKey)
      .send({ planId });

    expect(assignResponse.status).toBe(200);

    const firstUsage = await request(app)
      .post("/usage")
      .set("x-api-key", testApiKey)
      .send({
        userId: testUserId,
        requestId: `plan-update-first-${Date.now()}`,
        units: 10,
      });

    expect(firstUsage.status).toBe(200);
    expect(firstUsage.body.status).toBe("accepted");

    // Lower the account allowance below the 10 units already consumed.
    const updateResponse = await request(app)
      .patch(`/plans/${planId}`)
      .set("x-api-key", testApiKey)
      .send({ monthlyAllowance: 5 });

    expect(updateResponse.status).toBe(200);
    expect(Number(updateResponse.body.plan.monthly_allowance)).toBe(5);

    // New usage must be rejected, and the previous 10 units must remain.
    const secondUsage = await request(app)
      .post("/usage")
      .set("x-api-key", testApiKey)
      .send({
        userId: testUserId,
        requestId: `plan-update-second-${Date.now()}`,
        units: 1,
      });

    expect(secondUsage.status).toBe(200);
    expect(secondUsage.body.status).toBe("rejected");
    expect(secondUsage.body.rejectionScope).toBe("account");
    expect(secondUsage.body.rejectionRule).toBe("monthly_allowance");

    const usageResult = await pool.query(
      `SELECT units_consumed
       FROM usage_periods
       WHERE account_id = $1
         AND user_id IS NULL
         AND period_start = DATE_TRUNC(
           'month', NOW() AT TIME ZONE 'UTC'
         )::date`,
      [accountId],
    );

    expect(Number(usageResult.rows[0].units_consumed)).toBe(10);
  });

  it("returns current account and user usage summaries", async () => {
    const response = await request(app)
      .get("/usage/summary")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.periodStart).toMatch(/^\d{4}-\d{2}-01$/);

    expect(response.body.account).toBeDefined();
    expect(response.body.account.plan.name).toBe("Starter");
    expect(response.body.account.consumed).toBe(10);
    expect(response.body.account.remaining).toBe(
      response.body.account.plan.monthlyAllowance - 10,
    );

    expect(Array.isArray(response.body.users)).toBe(true);

    const user = response.body.users.find(
      (item: { id: string }) => item.id === userId,
    );

    expect(user).toBeDefined();
    expect(user.plan.name).toBe("Basic");
    expect(user.consumed).toBe(10);
    expect(user.remaining).toBe(user.plan.monthlyAllowance - 10);
  });

});
