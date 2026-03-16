interface Env {
  LICENCE_KV: KVNamespace;
  LICENCE_SECRET: string;
  LICENCE_ADMIN_SECRET: string;
}

interface LicenceRecord {
  modules: string[];
  expiresAt: string;
  tenantId: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

interface PingRecord {
  lastSeen: string;
  machineFingerprint: string;
}

function generateKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function requireAdmin(request: Request, env: Env): Response | null {
  const secret = request.headers.get("X-Admin-Secret");
  if (!secret || secret !== env.LICENCE_ADMIN_SECRET) {
    return Response.json(
      { error: "unauthorized", message: "Invalid or missing admin secret" },
      { status: 401 }
    );
  }
  return null;
}

function daysRemaining(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

async function handleValidate(
  request: Request,
  env: Env
): Promise<Response> {
  const { licenceKey, machineFingerprint } = (await request.json()) as {
    licenceKey: string;
    machineFingerprint: string;
  };

  const record = (await env.LICENCE_KV.get(
    `licence:${licenceKey}`,
    "json"
  )) as LicenceRecord | null;

  if (!record || !record.active) {
    return Response.json(
      { valid: false, reason: "invalid_key" },
      { status: 403 }
    );
  }

  if (new Date(record.expiresAt) < new Date()) {
    return Response.json(
      { valid: false, reason: "expired" },
      { status: 403 }
    );
  }

  // Log the ping — timestamp and fingerprint only, no SAP data
  await env.LICENCE_KV.put(
    `ping:${licenceKey}`,
    JSON.stringify({
      lastSeen: new Date().toISOString(),
      machineFingerprint,
    } satisfies PingRecord),
    { expirationTtl: 90 * 24 * 60 * 60 }
  );

  return Response.json({
    valid: true,
    modules: record.modules,
    tenantId: record.tenantId,
    expiresAt: record.expiresAt,
  });
}

async function handleProvision(
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const { tenantId, modules, expiresAt, notes } = (await request.json()) as {
    tenantId: string;
    modules: string[];
    expiresAt: string;
    notes?: string;
  };

  if (!tenantId || !modules?.length || !expiresAt) {
    return Response.json(
      { error: "bad_request", message: "tenantId, modules, and expiresAt are required" },
      { status: 400 }
    );
  }

  const licenceKey = generateKey();
  const record: LicenceRecord = {
    tenantId,
    modules,
    expiresAt,
    active: true,
    notes: notes || undefined,
    createdAt: new Date().toISOString(),
  };

  await env.LICENCE_KV.put(`licence:${licenceKey}`, JSON.stringify(record));

  return Response.json({
    licenceKey,
    tenantId,
    modules,
    expiresAt,
  });
}

async function handleRevoke(
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const { licenceKey } = (await request.json()) as { licenceKey: string };

  if (!licenceKey) {
    return Response.json(
      { error: "bad_request", message: "licenceKey is required" },
      { status: 400 }
    );
  }

  const record = (await env.LICENCE_KV.get(
    `licence:${licenceKey}`,
    "json"
  )) as LicenceRecord | null;

  if (!record) {
    return Response.json(
      { error: "not_found", message: "Licence key not found" },
      { status: 404 }
    );
  }

  record.active = false;
  await env.LICENCE_KV.put(`licence:${licenceKey}`, JSON.stringify(record));

  return Response.json({ revoked: true, licenceKey });
}

async function handlePings(
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const filterKey = url.searchParams.get("licenceKey");

  const pings: { licenceKey: string; lastSeen: string; machineFingerprint: string }[] = [];

  if (filterKey) {
    const ping = (await env.LICENCE_KV.get(
      `ping:${filterKey}`,
      "json"
    )) as PingRecord | null;
    if (ping) {
      pings.push({
        licenceKey: filterKey,
        lastSeen: ping.lastSeen,
        machineFingerprint: ping.machineFingerprint,
      });
    }
  } else {
    const keys = await env.LICENCE_KV.list({ prefix: "ping:" });
    for (const key of keys.keys) {
      const ping = (await env.LICENCE_KV.get(
        key.name,
        "json"
      )) as PingRecord | null;
      if (ping) {
        pings.push({
          licenceKey: key.name.replace("ping:", ""),
          lastSeen: ping.lastSeen,
          machineFingerprint: ping.machineFingerprint,
        });
      }
    }
  }

  return Response.json({ pings });
}

async function handleStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!key) {
    return Response.json(
      { error: "bad_request", message: "key query parameter is required" },
      { status: 400 }
    );
  }

  const record = (await env.LICENCE_KV.get(
    `licence:${key}`,
    "json"
  )) as LicenceRecord | null;

  if (!record) {
    return Response.json({ valid: false }, { status: 404 });
  }

  const expired = new Date(record.expiresAt) < new Date();
  const valid = record.active && !expired;

  return Response.json({
    valid,
    expiresAt: record.expiresAt,
    daysRemaining: daysRemaining(record.expiresAt),
    modules: record.modules,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // POST /validate
      if (method === "POST" && path === "/validate") {
        return await handleValidate(request, env);
      }

      // POST /provision
      if (method === "POST" && path === "/provision") {
        return await handleProvision(request, env);
      }

      // POST /revoke
      if (method === "POST" && path === "/revoke") {
        return await handleRevoke(request, env);
      }

      // GET /pings
      if (method === "GET" && path === "/pings") {
        return await handlePings(request, env);
      }

      // GET /status
      if (method === "GET" && path === "/status") {
        return await handleStatus(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return Response.json({ error: "internal_error", message }, { status: 500 });
    }
  },
};
