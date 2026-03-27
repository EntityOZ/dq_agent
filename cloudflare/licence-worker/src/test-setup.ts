import { beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

beforeAll(async () => {
  const schema = readFileSync(resolve(__dirname, "../schema.sql"), "utf-8");
  await (env.DB as D1Database).exec(schema);
});
