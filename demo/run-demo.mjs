
const BASE_URL = process.env.API_URL || "http://localhost:3000";

async function request(path, method = "GET", body, apiKey) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
  }

  return data;
}

function check(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

async function main() {
  console.log("\n=== USAGE METERING DEMO ===\n");

  // 1. Create a fresh account
  const accountResponse = await request("/accounts", "POST", {
    name: "Demo Company"
  });

  const apiKey = accountResponse.apiKey;
  console.log("Account created successfully");

  // 2. Create two users
  const userA = await request("/users", "POST", {
    name: "User A"
  }, apiKey);

  const userB = await request("/users", "POST", {
    name: "User B"
  }, apiKey);

  const userAId = userA.user.id;
  const userBId = userB.user.id;

  console.log("Two users created successfully");

  // 3. Create custom plans
  const accountPlan = await request("/plans", "POST", {
    scope: "account",
    name: "Demo Account Plan",
    monthlyAllowance: 100,
    maxUnitsPerRequest: 100
  }, apiKey);

  const basicPlan = await request("/plans", "POST", {
    scope: "user",
    name: "Demo Basic",
    monthlyAllowance: 30,
    maxUnitsPerRequest: 20
  }, apiKey);

  const premiumPlan = await request("/plans", "POST", {
    scope: "user",
    name: "Demo Premium",
    monthlyAllowance: 100,
    maxUnitsPerRequest: 100
  }, apiKey);

  // 4. Assign plans
  await request("/plans/account/current", "PATCH", {
    planId: accountPlan.plan.id
  }, apiKey);

  await request(`/plans/users/${userAId}/current`, "PATCH", {
    planId: basicPlan.plan.id
  }, apiKey);

  await request(`/plans/users/${userBId}/current`, "PATCH", {
    planId: premiumPlan.plan.id
  }, apiKey);

  console.log("Different plans assigned successfully");

  // 5. Accepted request
  const accepted = await request("/usage", "POST", {
    userId: userAId,
    requestId: "demo-accepted",
    units: 10
  }, apiKey);

  check(accepted.status === "accepted",
    "User A: 10 units accepted");

  // 6. Rejected by user per-request limit
  const userRejected = await request("/usage", "POST", {
    userId: userAId,
    requestId: "demo-user-rejected",
    units: 25
  }, apiKey);

  check(
    userRejected.status === "rejected" &&
    userRejected.rejectionScope === "user" &&
    userRejected.rejectionRule === "max_units_per_request",
    "User A: rejected by user request limit"
  );

  // 7. Consume remaining shared account allowance
  const acceptedB = await request("/usage", "POST", {
    userId: userBId,
    requestId: "demo-user-b-accepted",
    units: 90
  }, apiKey);

  check(acceptedB.status === "accepted",
    "User B: 90 units accepted");

  // 8. Rejected by shared account allowance
  const accountRejected = await request("/usage", "POST", {
    userId: userAId,
    requestId: "demo-account-rejected",
    units: 5
  }, apiKey);

  check(
    accountRejected.status === "rejected" &&
    accountRejected.rejectionScope === "account" &&
    accountRejected.rejectionRule === "monthly_allowance",
    "Request rejected by shared account limit"
  );

  // 9. Update account plan
  await request(`/plans/${accountPlan.plan.id}`, "PATCH", {
    monthlyAllowance: 150
  }, apiKey);

  console.log("Account allowance updated from 100 to 150");

  // 10. Retry with a new request ID
  const afterUpdate = await request("/usage", "POST", {
    userId: userAId,
    requestId: "demo-after-update",
    units: 5
  }, apiKey);

  check(afterUpdate.status === "accepted",
    "Request accepted after plan update");

  // 11. Check final usage summary
  const summary = await request("/usage/summary", "GET", undefined, apiKey);

  check(summary.account.consumed === 105,
    "Account consumed exactly 105 units");

  check(summary.account.remaining === 45,
    "Account has 45 units remaining");

  console.log("\nFinal Usage Summary:");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n=== DEMO COMPLETED SUCCESSFULLY ===");
}

main().catch(error => {
  console.error("\nDEMO FAILED:", error.message);
  process.exitCode = 1;
});

