import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";

describe("Usage Metering API integration tests", () => {
  let apiKey: string;
  let userId: string;

  beforeAll(async () => {
    // Create a fresh account for this test run.
    const accountResponse = await request(app)
      .post("/accounts")
      .send({ name: `Test Account ${Date.now()}` });

    expect(accountResponse.status).toBe(201);
    apiKey = accountResponse.body.apiKey;

    // Create a user belonging to that account.
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
         AND period_start = DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')::date`,
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
         AND period_start = DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')::date`,
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
});
