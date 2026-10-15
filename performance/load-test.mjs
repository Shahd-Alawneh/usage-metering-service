
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const BASE_URL = process.env.API_URL || "http://localhost:3000";
const TOTAL_REQUESTS = 100;
const CONCURRENCY = 10;

async function api(path, method = "GET", body, apiKey) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data;
}

function percentile(sorted, p) {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function main() {
  console.log("\n=== PERFORMANCE TEST ===\n");

  // Create a fresh account and user
  const account = await api("/accounts", "POST", {
    name: `Performance Account ${randomUUID()}`,
  });

  const apiKey = account.apiKey;

  const user = await api(
    "/users",
    "POST",
    { name: "Performance User" },
    apiKey
  );

  const userId = user.user.id;

  // Create an account plan with enough units
  const accountPlan = await api(
    "/plans",
    "POST",
    {
      scope: "account",
      name: "Performance Account Plan",
      monthlyAllowance: 10000,
      maxUnitsPerRequest: 100,
    },
    apiKey
  );

  // Create a user plan with enough units
  const userPlan = await api(
    "/plans",
    "POST",
    {
      scope: "user",
      name: "Performance User Plan",
      monthlyAllowance: 10000,
      maxUnitsPerRequest: 100,
    },
    apiKey
  );

  await api(
    "/plans/account/current",
    "PATCH",
    { planId: accountPlan.plan.id },
    apiKey
  );

  await api(
    `/plans/users/${userId}/current`,
    "PATCH",
    { planId: userPlan.plan.id },
    apiKey
  );

  console.log(`Total requests: ${TOTAL_REQUESTS}`);
  console.log(`Concurrent workers: ${CONCURRENCY}`);

  const latencies = [];
  let accepted = 0;
  let rejected = 0;
  let errors = 0;
  let nextRequest = 0;

  async function worker() {
    while (nextRequest < TOTAL_REQUESTS) {
      const requestNumber = nextRequest++;
      const start = performance.now();

      try {
        const result = await api(
          "/usage",
          "POST",
          {
            userId,
            requestId: `perf-${requestNumber}-${randomUUID()}`,
            units: 1,
          },
          apiKey
        );

        if (result.status === "accepted") {
          accepted++;
        } else if (result.status === "rejected") {
          rejected++;
        } else {
          errors++;
        }
      } catch (error) {
        errors++;
        console.error(`Request ${requestNumber} failed: ${error.message}`);
      } finally {
        latencies.push(performance.now() - start);
      }
    }
  }

  const startTime = performance.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker())
  );

  const totalSeconds = (performance.now() - startTime) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);

  const average =
    latencies.reduce((sum, value) => sum + value, 0) /
    latencies.length;

  const rps = TOTAL_REQUESTS / totalSeconds;

  const summary = await api(
    "/usage/summary",
    "GET",
    undefined,
    apiKey
  );

  console.log("\n=== RESULTS ===");
  console.log(`Accepted: ${accepted}`);
  console.log(`Rejected: ${rejected}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total time: ${totalSeconds.toFixed(2)} seconds`);
  console.log(`Requests per second: ${rps.toFixed(2)}`);
  console.log(`Average latency: ${average.toFixed(2)} ms`);
  console.log(`P50 latency: ${percentile(sorted, 50).toFixed(2)} ms`);
  console.log(`P95 latency: ${percentile(sorted, 95).toFixed(2)} ms`);
  console.log(`P99 latency: ${percentile(sorted, 99).toFixed(2)} ms`);
  console.log(`Account consumed: ${summary.account.consumed}`);

  if (
    accepted !== TOTAL_REQUESTS ||
    rejected !== 0 ||
    errors !== 0 ||
    summary.account.consumed !== TOTAL_REQUESTS
  ) {
    throw new Error("Performance test validation failed");
  }

  console.log("\n=== PERFORMANCE TEST PASSED ===");
}

main().catch((error) => {
  console.error("\nTEST FAILED:", error.message);
  process.exitCode = 1;
});

