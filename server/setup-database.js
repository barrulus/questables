// Database setup script for local PostgreSQL

import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { hashPassword } from "./auth-middleware.js";

// Load env from server and repo root, preferring .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
for (const f of [
  join(__dirname, ".env.local"),
  join(__dirname, ".env"),
  join(__dirname, "..", ".env.local"),
  join(__dirname, "..", ".env"),
]) {
  if (existsSync(f)) dotenv.config({ path: f, override: true });
}

// Database connection
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME || process.env.PGDATABASE,
  user: process.env.DATABASE_USER || process.env.PGUSER,
  password: process.env.DATABASE_PASSWORD,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function setupDatabase() {
  console.log("Setting up local PostgreSQL database...");

  try {
    // Test connection
    const client = await pool.connect();
    console.log("✓ Connected to PostgreSQL");

    // Enable PostGIS extension
    console.log("Installing PostGIS extension...");
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis;");
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    console.log("✓ PostGIS extension installed");

    // Read and execute schema file
    console.log("Creating database schema...");
    const schemaPath = join(__dirname, "..", "database", "schema.sql");
    const schema = readFileSync(schemaPath, "utf8");

    // Execute the schema as a single multi-statement script.
    // node-postgres can run multiple statements separated by semicolons.
    try {
      await client.query(schema);
    } catch (error) {
      console.warn("Warning executing schema.sql:", error.message);
      throw error; // rethrow so setup stops if the schema actually fails
    }

    console.log("✓ Database schema created");

    // Create or update default admin user using the same bcrypt helper
    // as the HTTP auth layer so login works consistently.
    console.log("Creating default admin user...");
    const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const defaultAdminEmail =
      process.env.DEFAULT_ADMIN_EMAIL || "admin@localhost";
    const defaultAdminPassword =
      process.env.DEFAULT_ADMIN_PASSWORD || "admin123";

    try {
      const passwordHash = await hashPassword(defaultAdminPassword);

      const upsertResult = await client.query(
        `INSERT INTO user_profiles (username, email, password_hash, roles, status)
         VALUES ($1, $2, $3, ARRAY['admin','dm','player']::TEXT[], 'active')
         ON CONFLICT (email) DO UPDATE
           SET username = EXCLUDED.username,
               password_hash = EXCLUDED.password_hash,
               roles = EXCLUDED.roles,
               status = 'active'
         RETURNING id`,
        [defaultAdminUsername, defaultAdminEmail, passwordHash]
      );

      const action = upsertResult.command === "INSERT" ? "created" : "updated";
      console.log(
        `✓ Default admin user ${action} (${defaultAdminEmail} / ${defaultAdminPassword})`
      );
    } catch (error) {
      console.log(
        "ℹ Default admin user setup error:",
        error.code || error.message || error
      );
    }

    client.release();
    console.log("\n🎉 Database setup complete!");
    console.log("You can now start the database server with: npm start");
  } catch (error) {
    console.error("❌ Database setup failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup
setupDatabase();
