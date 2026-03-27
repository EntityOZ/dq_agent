import { env } from "cloudflare:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve(__dirname, "../schema.sql"), "utf-8");

// D1 exec() requires each statement to end with a semicolon
for (const stmt of schema.split(";").filter((s) => s.trim())) {
  const db = env.DB as D1Database;
  await db.exec(stmt + ";");
}
