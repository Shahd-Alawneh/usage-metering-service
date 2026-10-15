
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import { pool } from "../src/db/pool.js";

describe("Concurrent usage requests", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("never exceeds the account allowance", async () => {
    // Create an independent test account
    const accountResponse = await request(app)
      .post("/accounts")
      .send({ name: `Concurrency Test ${randomUUID()}` });

    expect(accountResponse.status).toBe(201);

    const apiKey = accountResponse.body.apiKey;

    // Create a user
    const userResponse = await request(app)
      .post("/users")
      .set("x-api-key", apiKey)
      .send({ name: "Concurrent Test User" });

    expect(userResponse.status).toBe(201);

    const userId = userResponse.body.user.id;

    // Create an account plan allowing only 10 units
    const accountPlanResponse = await request(app)
      .post("/plans")
      .set("x-api-key", apiKey)
      .send({
        scope: "account",
        name: "Concurrency Account Plan",
        monthlyAllowance: 10,
        maxUnitsPerRequest: 10,
      });

    expect(accountPlanResponse.status).toBe(201);

    // Create a user plan with a higher allowance
    const userPlanResponse = await request(app)
      .post("/plans")
      .set("x-api-key", apiKey)
      .send({
        scope: "user",
        name: "Concurrency User Plan",
        monthlyAllowance: 100,
        maxUnitsPerRequest: 10,
      });

    expect(userPlanResponse.status).toBe(201);

    // Assign the account plan
    const assignAccount = await request(app)
      .patch("/plans/account/current")
      .set("x-api-key", apiKey)
      .send({ planId: accountPlanResponse.body.plan.id });

    expect(assignAccount.status).toBe(200);

    // Assign the user plan
    const assignUser = await request(app)
      .patch(`/plans/users/${userId}/current`)
      .set("x-api-key", apiKey)
      .send({ planId: userPlanResponse.body.plan.id });

    expect(assignUser.status).toBe(200);

    // Send 20 requests concurrently
    const requests = Array.from({ length: 20 }, () =>
      request(app)
        .post("/usage")
        .set("x-api-key", apiKey)
        .send({
          userId,
          requestId: randomUUID(),
          units: 1,
        }),
    );

    const responses = await Promise.all(requests);

    // Every request should receive a valid response
    expect(responses.every((response) => response.status === 200))
      .toBe(true);

    const accepted = responses.filter(
      (response) => response.body.status === "accepted",
    );

    const rejected = responses.filter(
      (response) => response.body.status === "rejected",
    );

    // Only 10 requests may be accepted
    expect(accepted).toHaveLength(10);
    expect(rejected).toHaveLength(10);

    // Rejections must be caused by the account allowance
    expect(
      rejected.every(
        (response) =>
          response.body.rejectionScope === "account" &&
          response.body.rejectionRule === "monthly_allowance",
      ),
    ).toBe(true);

    // Check the final account balance
    const summaryResponse = await request(app)
      .get("/usage/summary")
      .set("x-api-key", apiKey);

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.account.consumed).toBe(10);
    expect(summaryResponse.body.account.remaining).toBe(0);

    console.log("Concurrency result: 10 accepted, 10 rejected");
    console.log("Account consumed: 10 / 10 units");
  }, 30000);
});

