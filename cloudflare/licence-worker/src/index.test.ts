import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "./index";

const ADMIN_SECRET = "test-admin-secret";

async function callWorker(
  path: string,
  options: RequestInit & { method?: string } = {}
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, options);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request,
    { ...env, LICENCE_ADMIN_SECRET: ADMIN_SECRET } as never,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Admin-Secret": ADMIN_SECRET,
    ...extra,
  };
}

async function provisionTestLicence(
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const body = {
    tenantId: "tenant-001",
    modules: ["business_partner", "material_master", "fi_gl"],
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
  const resp = await callWorker("/provision", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as { licenceKey: string };
  return data.licenceKey;
}

describe("POST /validate", () => {
  it("returns valid:true for a valid licence key", async () => {
    const licenceKey = await provisionTestLicence();

    const resp = await callWorker("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenceKey,
        machineFingerprint: "abc123",
      }),
    });

    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { valid: boolean; modules: string[] };
    expect(data.valid).toBe(true);
    expect(data.modules).toEqual([
      "business_partner",
      "material_master",
      "fi_gl",
    ]);
  });

  it("returns 403 for an invalid key", async () => {
    const resp = await callWorker("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenceKey: "nonexistent-key",
        machineFingerprint: "abc123",
      }),
    });

    expect(resp.status).toBe(403);
    const data = (await resp.json()) as { valid: boolean; reason: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe("invalid_key");
  });

  it("returns 403 with reason:expired for an expired key", async () => {
    const licenceKey = await provisionTestLicence({
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const resp = await callWorker("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenceKey,
        machineFingerprint: "abc123",
      }),
    });

    expect(resp.status).toBe(403);
    const data = (await resp.json()) as { valid: boolean; reason: string };
    expect(data.valid).toBe(false);
    expect(data.reason).toBe("expired");
  });
});

describe("POST /provision", () => {
  it("returns 401 without admin secret", async () => {
    const resp = await callWorker("/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-001",
        modules: ["business_partner"],
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    expect(resp.status).toBe(401);
  });

  it("provisions a new licence with valid admin secret", async () => {
    const expiresAt = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000
    ).toISOString();
    const resp = await callWorker("/provision", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        tenantId: "tenant-002",
        modules: ["business_partner", "fi_gl"],
        expiresAt,
      }),
    });

    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      licenceKey: string;
      tenantId: string;
      modules: string[];
      expiresAt: string;
    };
    expect(data.licenceKey).toHaveLength(32);
    expect(data.tenantId).toBe("tenant-002");
    expect(data.modules).toEqual(["business_partner", "fi_gl"]);
  });
});

describe("POST /revoke", () => {
  it("revokes a licence and subsequent validate returns invalid", async () => {
    const licenceKey = await provisionTestLicence();

    // Verify it's valid first
    let resp = await callWorker("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey, machineFingerprint: "abc" }),
    });
    expect(resp.status).toBe(200);

    // Revoke it
    resp = await callWorker("/revoke", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ licenceKey }),
    });
    expect(resp.status).toBe(200);
    const revokeData = (await resp.json()) as { revoked: boolean };
    expect(revokeData.revoked).toBe(true);

    // Validate again — should be invalid
    resp = await callWorker("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenceKey, machineFingerprint: "abc" }),
    });
    expect(resp.status).toBe(403);
    const data = (await resp.json()) as { valid: boolean; reason: string };
    expect(data.valid).toBe(false);
  });
});

describe("GET /status", () => {
  it("returns daysRemaining > 0 for a valid key", async () => {
    const licenceKey = await provisionTestLicence();

    const resp = await callWorker(`/status?key=${licenceKey}`);
    expect(resp.status).toBe(200);

    const data = (await resp.json()) as {
      valid: boolean;
      daysRemaining: number;
      modules: string[];
    };
    expect(data.valid).toBe(true);
    expect(data.daysRemaining).toBeGreaterThan(0);
    expect(data.modules).toContain("business_partner");
  });

  it("returns 400 without key parameter", async () => {
    const resp = await callWorker("/status");
    expect(resp.status).toBe(400);
  });

  it("returns 404 for nonexistent key", async () => {
    const resp = await callWorker("/status?key=doesnotexist");
    expect(resp.status).toBe(404);
  });
});

describe("GET /pings", () => {
  it("returns 401 without admin secret", async () => {
    const resp = await callWorker("/pings");
    expect(resp.status).toBe(401);
  });

  it("returns pings after a validate call", async () => {
    const licenceKey = await provisionTestLicence();

    // Trigger a validate to create a ping
    await callWorker("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenceKey,
        machineFingerprint: "fingerprint-xyz",
      }),
    });

    const resp = await callWorker(`/pings?licenceKey=${licenceKey}`, {
      headers: { "X-Admin-Secret": ADMIN_SECRET },
    });
    expect(resp.status).toBe(200);

    const data = (await resp.json()) as {
      pings: { licenceKey: string; machineFingerprint: string }[];
    };
    expect(data.pings).toHaveLength(1);
    expect(data.pings[0].machineFingerprint).toBe("fingerprint-xyz");
  });
});
