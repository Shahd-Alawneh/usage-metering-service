import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(741852963)");

    const files = (await readdir(migrationsDir))
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const tableCheck = await client.query(
        "SELECT to_regclass('public.schema_migrations') AS table_name",
      );

      const trackingTableExists = Boolean(
        tableCheck.rows[0].table_name,
      );

      if (trackingTableExists) {
        const result = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [file],
        );

        if (result.rowCount && result.rowCount > 0) {
          console.log(`Already applied: ${file}`);
          continue;
        }
      } else if (file !== files[0]) {
        throw new Error(
          "Migration tracking table is missing before the initial migration.",
        );
      }

      const sql = await readFile(resolve(migrationsDir, file), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`Applied migration: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(741852963)");
    } finally {
      client.release();
      await pool.end();
    }
  }
}

migrate().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
