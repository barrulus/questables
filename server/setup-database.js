// Database setup script for local PostgreSQL

import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { encryptField, hmacLookup } from "./crypto.js";
import { migrateUserPii } from "./migrations/encrypt-user-pii.js";

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

    // Run the PII migration BEFORE schema.sql. On an existing DB this reshapes
    // user_profiles (CITEXT->TEXT, drop UNIQUE, add lookup columns) so the
    // schema's CREATE UNIQUE INDEX statements have something to bind to. On a
    // fresh DB the migration is a no-op (no user_profiles yet) and schema.sql
    // creates the table in its already-correct final shape.
    console.log("Running PII migration (pre-schema)...");
    await migrateUserPii(client);
    console.log("✓ PII migration complete");

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

    // Execute SRD reference data schema if it exists
    const srdSchemaPath = join(__dirname, "..", "database", "srd-schema.sql");
    if (existsSync(srdSchemaPath)) {
      console.log("Creating SRD reference data schema...");
      try {
        const srdSchema = readFileSync(srdSchemaPath, "utf8");
        await client.query(srdSchema);
        console.log("✓ SRD reference data schema created");
      } catch (error) {
        console.warn("Warning executing srd-schema.sql:", error.message);
        throw error;
      }
    }

    // Ensure a default admin user exists so an operator has someone to issue an
    // enrolment link to. Passkey-only auth means we leave password_hash null;
    // run `npm run enrol-admin <username>` to bind a passkey.
    console.log("Ensuring default admin user...");
    const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const defaultAdminEmail =
      process.env.DEFAULT_ADMIN_EMAIL || "admin@localhost";

    try {
      const emailLookup = hmacLookup(defaultAdminEmail);
      const existing = await client.query(
        `SELECT id FROM user_profiles WHERE email_lookup = $1 LIMIT 1`,
        [emailLookup]
      );

      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO user_profiles (username, username_lookup, email, email_lookup, password_hash, roles, status)
           VALUES ($1, $2, $3, $4, NULL, ARRAY['admin','dm','player']::TEXT[], 'active')`,
          [
            encryptField(defaultAdminUsername),
            hmacLookup(defaultAdminUsername),
            encryptField(defaultAdminEmail),
            emailLookup,
          ]
        );
        console.log(`✓ Default admin user created (${defaultAdminEmail})`);
        console.log(
          `  Run: npm run enrol-admin ${defaultAdminUsername}   # to issue an enrolment link`
        );
      } else {
        console.log(`✓ Default admin user already exists (${defaultAdminEmail})`);
      }
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
