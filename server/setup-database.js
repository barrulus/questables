// Database setup script for local PostgreSQL

import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

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

    // Create default admin user if it doesn't exist
    console.log("Creating default admin user...");
    const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const defaultAdminEmail =
      process.env.DEFAULT_ADMIN_EMAIL || "admin@localhost";
    const defaultAdminPassword =
      process.env.DEFAULT_ADMIN_PASSWORD || "admin123";

    try {
      const hashResult = await client.query(
        "SELECT crypt($1, gen_salt('bf')) AS hash",
        [defaultAdminPassword]
      );

      const insertResult = await client.query(
        `INSERT INTO user_profiles (username, email, password_hash, roles)
         VALUES ($1, $2, $3, ARRAY['admin','dm','player']::TEXT[])
         ON CONFLICT (email) DO NOTHING`,
        [defaultAdminUsername, defaultAdminEmail, hashResult.rows[0].hash]
      );

      if (insertResult.rowCount > 0) {
        console.log(
          `✓ Default admin user created (${defaultAdminEmail} / ${defaultAdminPassword})`
        );
      } else {
        console.log("ℹ Default admin user already exists");
      }
      } catch (error) {
      console.log("ℹ Default admin user already exists:", error.code || error.message || error);
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
