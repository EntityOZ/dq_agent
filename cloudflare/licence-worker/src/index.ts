/**
 * Meridian Licence Worker — Cloudflare Worker
 *
 * Public endpoints:
 *   POST /api/licence/validate            — validate key, return full manifest
 *   GET  /api/licence/heartbeat           — health check
 *   POST /api/licence/field-mappings/sync — receive field mapping updates from customer
 *
 * Auth:
 *   POST /api/admin/login                 — email + password → JWT
 *
 * Admin endpoints (require Authorization: Bearer <jwt>):
 *   GET    /api/admin/analytics
 *   GET    /api/admin/tenants
 *   POST   /api/admin/tenants
 *   GET    /api/admin/tenants/:id
 *   PUT    /api/admin/tenants/:id
 *   PATCH  /api/admin/tenants/:id
 *   DELETE /api/admin/tenants/:id
 *   POST   /api/admin/tenants/:id/regenerate-key
 *   POST   /api/admin/tenants/:id/offline-token
 *   GET    /api/admin/tenants/:id/field-mappings
 *   PUT    /api/admin/tenants/:id/field-mappings
 *   GET    /api/admin/rules
 *   POST   /api/admin/rules
 *   POST   /api/admin/rules/import
 *   GET    /api/admin/rules/:id
 *   PUT    /api/admin/rules/:id
 *   PATCH  /api/admin/rules/:id
 *   DELETE /api/admin/rules/:id
 */

interface Env {
  LICENCE_KV: KVNamespace;
  DB: D1Database;
  /** Admin login email — set via wrangler secret put ADMIN_EMAIL */
  ADMIN_EMAIL: string;
  /** SHA-256 hex of the admin password — set via wrangler secret put ADMIN_PASSWORD_HASH */
  ADMIN_PASSWORD_HASH: string;
  /** HMAC-SHA-256 signing secret for admin JWTs — set via wrangler secret put JWT_SECRET */
  JWT_SECRET: string;
  /** RSA-PKCS8 private key PEM for offline JWT signing (set as Worker secret) */
  OFFLINE_JWT_PRIVATE_KEY?: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TenantFeatures {
  ask_meridian: boolean;
  export_reports: boolean;
  run_sync: boolean;
  field_mapping_self_service: boolean;
  max_users: number;
}

interface LlmConfig {
  tier: 1 | 2 | 3;
  model: string;
  notes: string;
}

interface TenantRow {
  id: string;
  company_name: string;
  contact_email: string;
  licence_key_hash: string | null;
  licence_key_suffix: string | null;
  tier: string;
  status: string;
  expiry_date: string;
  enabled_modules: string;
  enabled_menu_items: string;
  features: string;
  llm_config: string;
  machine_fingerprint: string | null;
  last_ping: string | null;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  module: string;
  category: string;
  severity: string;
  enabled: number;
  conditions: string;
  thresholds: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

interface FieldMappingRow {
  id: string;
  tenant_id: string;
  module: string;
  standard_field: string;
  standard_label: string | null;
  customer_field: string | null;
  customer_label: string | null;
  data_type: string;
  is_mapped: number;
  notes: string | null;
  updated_at: string;
}

interface TenantUserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateLicenceKey(): string {
  const seg = () => {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  };
  return `MRDX-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`;
}

async function hashKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function cors(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Credentials", "true");
  return new Response(response.body, { status: response.status, headers });
}

function json<T>(data: T, status = 200): Response {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

// ─── JWT (HMAC-SHA256) ────────────────────────────────────────────────────────

function b64url(data: string): string {
  return btoa(data).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${signingInput}.${sigB64}`;
}

async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(b64urlDecode(sigB64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(signingInput)
  );
  if (!valid) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────

async function requireAdmin(
  request: Request,
  env: Env
): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
  return null;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseTenant(row: TenantRow) {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_email: row.contact_email,
    licence_key_masked: row.licence_key_suffix ? `MRDX-****-****-${row.licence_key_suffix}` : null,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    enabled_modules: JSON.parse(row.enabled_modules || "[]") as string[],
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]") as string[],
    features: JSON.parse(row.features || "{}") as TenantFeatures,
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
    machine_fingerprint: row.machine_fingerprint,
    last_ping: row.last_ping,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseRule(row: RuleRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    module: row.module,
    category: row.category,
    severity: row.severity,
    enabled: row.enabled === 1,
    conditions: JSON.parse(row.conditions || "[]"),
    thresholds: JSON.parse(row.thresholds || "{}"),
    tags: JSON.parse(row.tags || "[]") as string[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseFieldMapping(row: FieldMappingRow) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    module: row.module,
    standard_field: row.standard_field,
    standard_label: row.standard_label,
    customer_field: row.customer_field,
    customer_label: row.customer_label,
    data_type: row.data_type,
    is_mapped: row.is_mapped === 1,
    notes: row.notes,
    updated_at: row.updated_at,
  };
}

function daysRemaining(expiryDate: string): number {
  const diff = new Date(expiryDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MENU_ITEMS = [
  "dashboard", "findings", "versions", "analytics", "import", "sync",
  "reports", "stewardship", "contracts", "ask_meridian", "export",
  "user_management", "settings", "licence",
];

const DEFAULT_FEATURES: TenantFeatures = {
  ask_meridian: true,
  export_reports: true,
  run_sync: true,
  field_mapping_self_service: false,
  max_users: 20,
};

const TIER_MODULES: Record<string, string[]> = {
  starter: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
  ],
  professional: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
  ],
  enterprise: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management",
    "wm_interface", "cross_system_integration",
  ],
};

// ─── Auth Handler ─────────────────────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }

  if (body.email !== env.ADMIN_EMAIL) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  const passwordHash = await hashKey(body.password);
  if (passwordHash !== env.ADMIN_PASSWORD_HASH) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: body.email,
      role: "admin",
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60, // 8 hours
    },
    env.JWT_SECRET
  );

  return json({ token, expiresIn: 8 * 60 * 60 });
}

// ─── Offline Token Generation ─────────────────────────────────────────────────

async function handleGenerateOfflineToken(
  tenantId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  if (!env.OFFLINE_JWT_PRIVATE_KEY) {
    return json(
      { error: "not_configured", message: "OFFLINE_JWT_PRIVATE_KEY secret is not set" },
      503
    );
  }

  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!row) return json({ error: "not_found" }, 404);

  const body = (await request.json().catch(() => ({}))) as { expiryDays?: number };
  const expiryDays = Math.min(Math.max(Number(body.expiryDays) || 365, 1), 1095);

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + expiryDays * 86400;
  const expiresAt = new Date(exp * 1000).toISOString();

  const rulesResult = await env.DB.prepare(
    "SELECT * FROM rules WHERE enabled = 1 ORDER BY module, category"
  ).all<RuleRow>();
  const rules = (rulesResult.results || []).map(parseRule);

  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ?"
  )
    .bind(tenantId)
    .all<FieldMappingRow>();
  const fieldMappings = (mappingsResult.results || []).map(parseFieldMapping);

  const payload = {
    iss: "meridian-hq",
    sub: tenantId,
    iat: nowSec,
    exp,
    tenant_id: tenantId,
    enabled_modules: JSON.parse(row.enabled_modules || "[]") as string[],
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]") as string[],
    features: JSON.parse(row.features || "{}") as TenantFeatures,
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
    rules,
    field_mappings: fieldMappings,
  };

  const keyPem = env.OFFLINE_JWT_PRIVATE_KEY.trim();
  const pemBody = keyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const headerB64 = encode({ alg: "RS256", typ: "JWT" });
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return json({ token: `${signingInput}.${sig}`, expiresAt, expiryDays });
}

// ─── Licence Validation ───────────────────────────────────────────────────────

async function handleValidate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { licenceKey?: string; machineFingerprint?: string };
  const { licenceKey, machineFingerprint } = body;

  if (!licenceKey) {
    return json({ valid: false, reason: "missing_key" }, 400);
  }

  const keyHash = await hashKey(licenceKey);
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?")
    .bind(keyHash)
    .first<TenantRow>();

  if (!row) {
    // Fallback to legacy KV
    const kv = (await env.LICENCE_KV.get(`licence:${licenceKey}`, "json")) as {
      modules: string[];
      features: string[];
      expiresAt: string;
      tenantId: string;
      active: boolean;
    } | null;
    if (!kv || !kv.active) return json({ valid: false, reason: "invalid_key" }, 403);
    if (new Date(kv.expiresAt) < new Date()) return json({ valid: false, reason: "expired" }, 403);
    await env.LICENCE_KV.put(
      `ping:${licenceKey}`,
      JSON.stringify({ lastSeen: nowIso(), machineFingerprint }),
      { expirationTtl: 90 * 24 * 60 * 60 }
    );
    return json({
      valid: true,
      tenant_id: kv.tenantId,
      company_name: "Unknown",
      tier: "starter",
      status: "active",
      expiry_date: kv.expiresAt,
      enabled_modules: kv.modules,
      enabled_menu_items: DEFAULT_MENU_ITEMS,
      features: DEFAULT_FEATURES,
      rules: [],
      field_mappings: [],
      llm_config: { tier: 1, model: "", notes: "Legacy licence" },
    });
  }

  if (row.status === "suspended") {
    return json({ valid: false, reason: "suspended" }, 403);
  }

  const expiry = new Date(row.expiry_date);
  const expired = expiry < new Date();
  const gracePeriodEnd = new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1000);
  const inGrace = expired && new Date() < gracePeriodEnd;

  if (expired && !inGrace) {
    return json({ valid: false, reason: "expired" }, 403);
  }
  if (expired && inGrace) {
    return json(
      { valid: false, reason: "expired_grace", grace_period_ends: gracePeriodEnd.toISOString(), tenant_id: row.id },
      402
    );
  }

  await env.DB.prepare(
    "UPDATE tenants SET last_ping = ?, machine_fingerprint = ?, updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), machineFingerprint || null, nowIso(), row.id)
    .run();

  const enabledModules = JSON.parse(row.enabled_modules || "[]") as string[];
  let rules: ReturnType<typeof parseRule>[] = [];
  if (enabledModules.length > 0) {
    const placeholders = enabledModules.map(() => "?").join(",");
    const rulesResult = await env.DB.prepare(
      `SELECT * FROM rules WHERE enabled = 1 AND module IN (${placeholders}) ORDER BY module, id`
    )
      .bind(...enabledModules)
      .all<RuleRow>();
    rules = (rulesResult.results || []).map(parseRule);
  }

  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field"
  )
    .bind(row.id)
    .all<FieldMappingRow>();

  return json({
    valid: true,
    tenant_id: row.id,
    company_name: row.company_name,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    days_remaining: daysRemaining(row.expiry_date),
    enabled_modules: enabledModules,
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]") as string[],
    features: JSON.parse(row.features || "{}") as TenantFeatures,
    rules,
    field_mappings: (mappingsResult.results || []).map(parseFieldMapping),
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
  });
}

function handleHeartbeat(): Response {
  return json({ status: "ok", ts: nowIso() });
}

async function handleFieldMappingSync(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    licence_key: string;
    mappings: Array<{
      module: string;
      standard_field: string;
      customer_field: string;
      customer_label?: string;
      is_mapped?: boolean;
      notes?: string;
    }>;
  };

  const { licence_key, mappings } = body;
  if (!licence_key || !Array.isArray(mappings)) {
    return json({ error: "bad_request", message: "licence_key and mappings are required" }, 400);
  }

  const keyHash = await hashKey(licence_key);
  const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE licence_key_hash = ?")
    .bind(keyHash)
    .first<{ id: string }>();
  if (!tenant) return json({ error: "unauthorized", message: "Invalid licence key" }, 401);

  const features = await env.DB.prepare("SELECT features FROM tenants WHERE id = ?")
    .bind(tenant.id)
    .first<{ features: string }>();
  const featureObj = JSON.parse(features?.features || "{}") as TenantFeatures;
  if (!featureObj.field_mapping_self_service) {
    return json({ error: "forbidden", message: "Field mapping self-service is not enabled" }, 403);
  }

  const ts = nowIso();
  let upserted = 0;
  for (const m of mappings) {
    await env.DB.prepare(`
      INSERT INTO field_mappings (id, tenant_id, module, standard_field, customer_field, customer_label, is_mapped, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, module, standard_field) DO UPDATE SET
        customer_field = excluded.customer_field,
        customer_label = excluded.customer_label,
        is_mapped = excluded.is_mapped,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `)
      .bind(
        generateId(), tenant.id, m.module, m.standard_field,
        m.customer_field, m.customer_label || null, m.is_mapped ? 1 : 0,
        m.notes || null, ts
      )
      .run();
    upserted++;
  }

  return json({ synced: upserted, tenant_id: tenant.id });
}

// ─── Admin: Analytics ────────────────────────────────────────────────────────

async function handleAdminAnalytics(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const allTenantsResult = await env.DB.prepare(
    "SELECT status, tier, expiry_date FROM tenants"
  ).all<{ status: string; tier: string; expiry_date: string }>();
  const rows = allTenantsResult.results || [];
  const total = rows.length;

  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const byTier = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {});

  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const expiringResult = await env.DB.prepare(
    "SELECT id, company_name, expiry_date, tier, status FROM tenants WHERE status = 'active' AND expiry_date <= ? ORDER BY expiry_date ASC LIMIT 10"
  )
    .bind(thirtyDaysLater)
    .all<{ id: string; company_name: string; expiry_date: string; tier: string; status: string }>();

  const recentPingsResult = await env.DB.prepare(
    "SELECT id, company_name, last_ping, status FROM tenants WHERE last_ping IS NOT NULL ORDER BY last_ping DESC LIMIT 10"
  ).all<{ id: string; company_name: string; last_ping: string; status: string }>();

  return json({
    total,
    by_status: byStatus,
    by_tier: byTier,
    expiring_soon: expiringResult.results || [],
    recent_activity: recentPingsResult.results || [],
  });
}

// ─── Admin: Tenants ───────────────────────────────────────────────────────────

async function handleListTenants(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tier = url.searchParams.get("tier");
  const search = url.searchParams.get("q");

  let query = "SELECT * FROM tenants";
  const params: string[] = [];
  const conditions: string[] = [];

  if (status) { conditions.push("status = ?"); params.push(status); }
  if (tier) { conditions.push("tier = ?"); params.push(tier); }
  if (search) {
    conditions.push("(LOWER(company_name) LIKE ? OR LOWER(contact_email) LIKE ?)");
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC";

  const result = await env.DB.prepare(query).bind(...params).all<TenantRow>();
  return json({ tenants: (result.results || []).map(parseTenant) });
}

async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    company_name: string;
    contact_email: string;
    tier?: string;
    expiry_date: string;
    enabled_modules?: string[];
    enabled_menu_items?: string[];
    features?: Partial<TenantFeatures>;
    llm_config?: Partial<LlmConfig>;
    status?: string;
    admin_user?: {
      email: string;
      password: string;
      role?: string;
    };
  };

  if (!body.company_name || !body.contact_email || !body.expiry_date) {
    return json({ error: "bad_request", message: "company_name, contact_email, and expiry_date are required" }, 400);
  }

  const tier = body.tier || "starter";
  const licenceKey = generateLicenceKey();
  const keyHash = await hashKey(licenceKey);
  const keySuffix = licenceKey.slice(-4);
  const id = generateId();
  const ts = nowIso();

  const enabledModules = body.enabled_modules || TIER_MODULES[tier] || TIER_MODULES.starter;
  const enabledMenuItems = body.enabled_menu_items || DEFAULT_MENU_ITEMS;
  const features: TenantFeatures = { ...DEFAULT_FEATURES, ...(body.features || {}) };
  const llmConfig: LlmConfig = { tier: 1, model: "", notes: "", ...(body.llm_config || {}) };

  await env.DB.prepare(`
    INSERT INTO tenants (id, company_name, contact_email, licence_key_hash, licence_key_suffix, tier, status, expiry_date, enabled_modules, enabled_menu_items, features, llm_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id, body.company_name, body.contact_email, keyHash, keySuffix,
      tier, body.status || "trial", body.expiry_date,
      JSON.stringify(enabledModules), JSON.stringify(enabledMenuItems),
      JSON.stringify(features), JSON.stringify(llmConfig), ts, ts
    )
    .run();

  // Create admin user if provided
  if (body.admin_user?.email && body.admin_user?.password) {
    const userId = generateId();
    const passwordHash = await hashKey(body.admin_user.password);
    await env.DB.prepare(`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        userId, id, body.admin_user.email, passwordHash,
        body.admin_user.role || "admin", ts, ts
      )
      .run();
  }

  return json({ id, licence_key: licenceKey, company_name: body.company_name, tier, status: body.status || "trial" }, 201);
}

async function handleGetTenant(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseTenant(row));
}

async function handleUpdateTenant(
  tenantId: string,
  request: Request,
  env: Env,
  partial = false
): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as Partial<{
    company_name: string;
    contact_email: string;
    tier: string;
    status: string;
    expiry_date: string;
    enabled_modules: string[];
    enabled_menu_items: string[];
    features: Partial<TenantFeatures>;
    llm_config: Partial<LlmConfig>;
  }>;

  const existing = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  if (!existing) return json({ error: "not_found" }, 404);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.company_name !== undefined) { fields.push("company_name = ?"); values.push(body.company_name); }
  if (body.contact_email !== undefined) { fields.push("contact_email = ?"); values.push(body.contact_email); }
  if (body.tier !== undefined) { fields.push("tier = ?"); values.push(body.tier); }
  if (body.status !== undefined) { fields.push("status = ?"); values.push(body.status); }
  if (body.expiry_date !== undefined) { fields.push("expiry_date = ?"); values.push(body.expiry_date); }
  if (body.enabled_modules !== undefined) { fields.push("enabled_modules = ?"); values.push(JSON.stringify(body.enabled_modules)); }
  if (body.enabled_menu_items !== undefined) { fields.push("enabled_menu_items = ?"); values.push(JSON.stringify(body.enabled_menu_items)); }
  if (body.features !== undefined) {
    const merged = partial ? { ...JSON.parse(existing.features || "{}"), ...body.features } : body.features;
    fields.push("features = ?"); values.push(JSON.stringify(merged));
  }
  if (body.llm_config !== undefined) {
    const merged = partial ? { ...JSON.parse(existing.llm_config || "{}"), ...body.llm_config } : body.llm_config;
    fields.push("llm_config = ?"); values.push(JSON.stringify(merged));
  }

  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);

  fields.push("updated_at = ?"); values.push(nowIso()); values.push(tenantId);

  await env.DB.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  return json(parseTenant(updated!));
}

async function handleDeleteTenant(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  await env.DB.prepare("DELETE FROM field_mappings WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId).run();
  return json({ deleted: true, id: tenantId });
}

async function handleRegenerateKey(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  const newKey = generateLicenceKey();
  const newHash = await hashKey(newKey);
  const newSuffix = newKey.slice(-4);

  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = ?, licence_key_suffix = ?, updated_at = ? WHERE id = ?"
  )
    .bind(newHash, newSuffix, nowIso(), tenantId)
    .run();

  return json({ licence_key: newKey, tenant_id: tenantId });
}

async function handleGetTenantFieldMappings(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const module = url.searchParams.get("module");
  const query = module
    ? "SELECT * FROM field_mappings WHERE tenant_id = ? AND module = ? ORDER BY standard_field"
    : "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field";
  const params = module ? [tenantId, module] : [tenantId];

  const result = await env.DB.prepare(query).bind(...params).all<FieldMappingRow>();
  return json({ field_mappings: (result.results || []).map(parseFieldMapping) });
}

async function handleUpsertTenantFieldMappings(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    mappings: Array<{
      module: string;
      standard_field: string;
      standard_label?: string;
      customer_field?: string;
      customer_label?: string;
      data_type?: string;
      is_mapped?: boolean;
      notes?: string;
    }>;
  };

  const ts = nowIso();
  let upserted = 0;
  for (const m of body.mappings || []) {
    await env.DB.prepare(`
      INSERT INTO field_mappings (id, tenant_id, module, standard_field, standard_label, customer_field, customer_label, data_type, is_mapped, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, module, standard_field) DO UPDATE SET
        standard_label = excluded.standard_label,
        customer_field = excluded.customer_field,
        customer_label = excluded.customer_label,
        data_type = excluded.data_type,
        is_mapped = excluded.is_mapped,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `)
      .bind(
        generateId(), tenantId, m.module, m.standard_field, m.standard_label || null,
        m.customer_field || null, m.customer_label || null, m.data_type || "string",
        m.is_mapped ? 1 : 0, m.notes || null, ts
      )
      .run();
    upserted++;
  }
  return json({ upserted });
}

// ─── Admin: Rules ─────────────────────────────────────────────────────────────

async function handleListRules(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const module = url.searchParams.get("module");
  const severity = url.searchParams.get("severity");
  const enabled = url.searchParams.get("enabled");
  const search = url.searchParams.get("q");

  let query = "SELECT * FROM rules";
  const params: (string | number)[] = [];
  const conditions: string[] = [];

  if (category) { conditions.push("category = ?"); params.push(category); }
  if (module) { conditions.push("module = ?"); params.push(module); }
  if (severity) { conditions.push("severity = ?"); params.push(severity); }
  if (enabled !== null && enabled !== "") { conditions.push("enabled = ?"); params.push(enabled === "true" ? 1 : 0); }
  if (search) { conditions.push("LOWER(name) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }

  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY category, module, id";

  const result = await env.DB.prepare(query).bind(...params).all<RuleRow>();
  return json({ rules: (result.results || []).map(parseRule), total: result.results?.length || 0 });
}

async function handleCreateRule(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    name: string;
    description?: string;
    module: string;
    category: string;
    severity?: string;
    enabled?: boolean;
    conditions?: unknown[];
    thresholds?: Record<string, unknown>;
    tags?: string[];
  };

  if (!body.name || !body.module || !body.category) {
    return json({ error: "bad_request", message: "name, module, and category are required" }, 400);
  }

  const id = generateId();
  const ts = nowIso();
  await env.DB.prepare(`
    INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id, body.name, body.description || null, body.module, body.category,
      body.severity || "medium", body.enabled !== false ? 1 : 0,
      JSON.stringify(body.conditions || []), JSON.stringify(body.thresholds || {}),
      JSON.stringify(body.tags || []), ts, ts
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RuleRow>();
  return json(parseRule(row!), 201);
}

async function handleGetRule(ruleId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first<RuleRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseRule(row));
}

async function handleUpdateRule(
  ruleId: string,
  request: Request,
  env: Env,
  partial = false
): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
    module: string;
    category: string;
    severity: string;
    enabled: boolean;
    conditions: unknown[];
    thresholds: Record<string, unknown>;
    tags: string[];
  }>;

  const existing = await env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<RuleRow>();
  if (!existing) return json({ error: "not_found" }, 404);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) { fields.push("name = ?"); values.push(body.name); }
  if (body.description !== undefined) { fields.push("description = ?"); values.push(body.description); }
  if (body.module !== undefined) { fields.push("module = ?"); values.push(body.module); }
  if (body.category !== undefined) { fields.push("category = ?"); values.push(body.category); }
  if (body.severity !== undefined) { fields.push("severity = ?"); values.push(body.severity); }
  if (body.enabled !== undefined) { fields.push("enabled = ?"); values.push(body.enabled ? 1 : 0); }
  if (body.conditions !== undefined) { fields.push("conditions = ?"); values.push(JSON.stringify(body.conditions)); }
  if (body.thresholds !== undefined) { fields.push("thresholds = ?"); values.push(JSON.stringify(body.thresholds)); }
  if (body.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(body.tags)); }

  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);
  fields.push("updated_at = ?"); values.push(nowIso()); values.push(ruleId);

  await env.DB.prepare(`UPDATE rules SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<RuleRow>();
  return json(parseRule(updated!));
}

async function handleDeleteRule(ruleId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();
  return json({ deleted: true, id: ruleId });
}

async function handleBulkImportRules(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const body = (await request.json()) as {
    rules: Array<{
      id?: string;
      name: string;
      description?: string;
      module: string;
      category: string;
      severity?: string;
      enabled?: boolean;
      conditions?: unknown[];
      thresholds?: Record<string, unknown>;
      tags?: string[];
    }>;
  };

  const ts = nowIso();
  let imported = 0;
  for (const r of body.rules || []) {
    const id = r.id || generateId();
    await env.DB.prepare(`
      INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        module = excluded.module, category = excluded.category,
        severity = excluded.severity, enabled = excluded.enabled,
        conditions = excluded.conditions, thresholds = excluded.thresholds,
        tags = excluded.tags, updated_at = excluded.updated_at
    `)
      .bind(
        id, r.name, r.description || null, r.module, r.category,
        r.severity || "medium", r.enabled !== false ? 1 : 0,
        JSON.stringify(r.conditions || []), JSON.stringify(r.thresholds || {}),
        JSON.stringify(r.tags || []), ts, ts
      )
      .run();
    imported++;
  }

  return json({ imported });
}

// ─── Tenant User Auth ─────────────────────────────────────────────────────────

async function handleTenantUserLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }

  const passwordHash = await hashKey(body.password);
  const user = await env.DB.prepare(
    "SELECT id, tenant_id, email, role FROM tenant_users WHERE email = ? AND password_hash = ?"
  )
    .bind(body.email, passwordHash)
    .first<{ id: string; tenant_id: string; email: string; role: string }>();

  if (!user) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }

  // Get tenant info
  const tenant = await env.DB.prepare("SELECT company_name, status FROM tenants WHERE id = ?")
    .bind(user.tenant_id)
    .first<{ company_name: string; status: string }>();

  if (!tenant) {
    return json({ error: "unauthorized", message: "Tenant not found" }, 401);
  }

  if (tenant.status === "suspended") {
    return json({ error: "forbidden", message: "Tenant account is suspended" }, 403);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60, // 8 hours
    },
    env.JWT_SECRET
  );

  return json({
    token,
    expiresIn: 8 * 60 * 60,
    tenant_id: user.tenant_id,
    company_name: tenant.company_name,
  });
}

// ─── Installer Script Delivery ────────────────────────────────────────────────
//
// GET /install?key=MRDX-...
//
// Validates the licence key, logs the download with IP + timestamp, then
// returns the installer bash script as plain text. No valid key = no script.
// This endpoint is served from get.meridian.vantax.co.za (custom domain).

const INSTALLER_SCRIPT = `#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Enterprise Installer
#
# Usage:  sudo bash standalone-install.sh
#
# Traffic architecture after install:
#   Browser -> Nginx (443) -> Next.js :3000 -> FastAPI :8000
#
# The browser NEVER talks to port 8000 directly.
# Next.js proxies /api/* to FastAPI on the Docker network.
# No CORS issues. No IP hardcoding. Works on any domain or IP.
#
# Requirements: Ubuntu 20.04+ or Debian 11+, internet access
# =========================================================
set -euo pipefail

MERIDIAN_DIR="/opt/meridian"
NGINX_CONF="/etc/nginx/sites-available/meridian"
SYSTEMD_UNIT="/etc/systemd/system/meridian.service"
LICENCE_SERVER="https://meridian-licence-worker.reshigan-085.workers.dev/api/licence"
OLLAMA_MODEL="qwen2.5:3b"

GREEN='\\033[0;32m'; RED='\\033[0;31m'; YELLOW='\\033[1;33m'
CYAN='\\033[0;36m'; BOLD='\\033[1m'; NC='\\033[0m'

info()  { echo -e "\${GREEN}✓\${NC} $*"; }
warn()  { echo -e "\${YELLOW}⚠\${NC}  $*"; }
error() { echo -e "\${RED}✗\${NC} $*" >&2; exit 1; }
step()  { echo -e "\\n\${CYAN}\${BOLD}━━━ $* ━━━\${NC}\\n"; }

[ "$EUID" -ne 0 ] && error "Please run as root:  sudo bash $0"

clear
echo -e "\${CYAN}"
cat << "EOF"
╔══════════════════════════════════════════════╗
║                                              ║
║        MERIDIAN PLATFORM INSTALLER           ║
║        SAP Data Quality & MDM Platform       ║
║                                              ║
║        © 2026 Vantax. All rights reserved.   ║
║                                              ║
╚══════════════════════════════════════════════╝
EOF
echo -e "\${NC}"

step "1/10  System Check"
OS_ID=$(grep -oP '(?<=^ID=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "unknown")
OS_VER=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "0")
info "OS: $OS_ID $OS_VER"
[[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]] && warn "Tested on Ubuntu/Debian. Proceeding anyway."
apt-get install -y -q curl openssl 2>/dev/null || true

step "2/10  Docker"
if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "installed")
    info "Docker $DOCKER_VER already installed"
else
    warn "Docker not found — installing via get.docker.com..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker && systemctl start docker
    info "Docker installed and started"
fi
if ! docker compose version &>/dev/null; then apt-get install -y -q docker-compose-plugin; fi
info "Docker Compose ready"

step "3/10  Nginx"
if ! command -v nginx &>/dev/null; then
    apt-get update -q && apt-get install -y -q nginx && systemctl enable nginx
    info "Nginx installed"
else
    info "Nginx already installed"
fi

step "4/10  Configuration"

if [ -f "$MERIDIAN_DIR/.env" ]; then
    warn "Existing installation found at $MERIDIAN_DIR"
    if [ -t 0 ]; then
        read -p "Reinstall and regenerate all secrets? [y/N]: " REINSTALL
        [[ ! "$REINSTALL" =~ ^[Yy] ]] && {
            echo ""; info "To update images only:  cd $MERIDIAN_DIR && docker compose pull && docker compose up -d"; exit 0; }
    fi
fi
mkdir -p "$MERIDIAN_DIR"

echo ""
echo "  Enter the address where Meridian will be reached."
echo "  • Domain:  meridian.yourcompany.com  (SSL via Let's Encrypt)"
echo "  • IP:      10.0.0.100               (self-signed SSL)"
echo ""
if [ -t 0 ]; then read -p "  Domain or IP: " SERVER_ADDRESS
else SERVER_ADDRESS="\${SERVER_ADDRESS:-localhost}"; fi
SERVER_ADDRESS=$(echo "$SERVER_ADDRESS" | tr -d '[:space:]')
[ -z "$SERVER_ADDRESS" ] && error "Server address is required."

if [[ "$SERVER_ADDRESS" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then IS_DOMAIN=false; else IS_DOMAIN=true; fi

echo ""
if [ -t 0 ]; then read -p "  Licence Key (MRDX-...): " LICENCE_KEY
else LICENCE_KEY="\${LICENCE_KEY:-}"; fi
LICENCE_KEY=$(echo "$LICENCE_KEY" | tr -d ' ' | tr '[:lower:]' '[:upper:]')
[[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]] && error "Invalid licence key format. Expected: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX"

echo ""
ADMIN_EMAIL="\${ADMIN_EMAIL:-}"; ADMIN_NAME="\${ADMIN_NAME:-}"; ADMIN_PASS="\${ADMIN_PASSWORD:-}"
if [ -z "$ADMIN_EMAIL" ] && [ -t 0 ]; then
    read -p "  Admin Email: " ADMIN_EMAIL
    while [ -z "$ADMIN_EMAIL" ]; do echo -e "  \${RED}Email required\${NC}"; read -p "  Admin Email: " ADMIN_EMAIL; done
    read -p "  Admin Name [$ADMIN_EMAIL]: " ADMIN_NAME; ADMIN_NAME="\${ADMIN_NAME:-$ADMIN_EMAIL}"
    while true; do
        read -sp "  Admin Password (min 8 chars): " ADMIN_PASS; echo ""
        [ \${#ADMIN_PASS} -ge 8 ] && break; echo -e "  \${RED}Password must be at least 8 characters\${NC}"
    done
elif [ -z "$ADMIN_EMAIL" ]; then
    warn "ADMIN_EMAIL not set — skipping admin creation."; ADMIN_EMAIL="SKIP"
fi

echo ""; info "Address:  $SERVER_ADDRESS"; info "Licence:  \${LICENCE_KEY:0:9}****"
[ "$ADMIN_EMAIL" != "SKIP" ] && info "Admin:    $ADMIN_EMAIL"

step "5/10  Licence Validation"
echo "Contacting licence server..."
VALIDATION=$(curl -s --max-time 15 -X POST "\${LICENCE_SERVER}/validate" \\
    -H "Content-Type: application/json" \\
    -d "{\\"licenceKey\\":\\"$LICENCE_KEY\\",\\"machineFingerprint\\":\\"$(hostname)\\"}" \\
    -w "\\n%{http_code}" 2>/dev/null || echo -e "\\n000")
HTTP_CODE=$(echo "$VALIDATION" | tail -n1); BODY=$(echo "$VALIDATION" | sed '$d')
if [ "$HTTP_CODE" != "200" ]; then
    REASON=$(echo "$BODY" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "server unreachable")
    error "Licence validation failed (HTTP $HTTP_CODE): $REASON"
fi
COMPANY=$(echo "$BODY" | grep -o '"company_name":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
TIER=$(echo "$BODY" | grep -o '"tier":"[^"]*"' | cut -d'"' -f4 || echo "starter")
EXPIRY=$(echo "$BODY" | grep -o '"expiry_date":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
info "Licence valid — $COMPANY ($TIER, expires $EXPIRY)"

step "6/10  Generating Configuration"
DB_PASS=$(openssl rand -hex 16); MINIO_PASS=$(openssl rand -hex 16); SECRET=$(openssl rand -hex 32)

cat > "$MERIDIAN_DIR/.env" << EOF
# Meridian Platform Configuration — Generated $(date)
# Company: \${COMPANY} | Licence: \${LICENCE_KEY:0:9}****-****
LICENCE_MODE=online
LICENCE_KEY=\${LICENCE_KEY}
LICENCE_SERVER_URL=\${LICENCE_SERVER}
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=\${OLLAMA_MODEL}
DB_PASSWORD=\${DB_PASS}
DATABASE_URL=postgresql+asyncpg://meridian:\${DB_PASS}@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:\${DB_PASS}@db:5432/meridian
REDIS_URL=redis://redis:6379/0
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=\${MINIO_PASS}
MINIO_SECRET_KEY=\${MINIO_PASS}
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports
SAP_CONNECTOR=mock
CREDENTIAL_MASTER_KEY=\${SECRET}
AUTH_MODE=local
CORS_ORIGINS=http://localhost:3000,http://frontend:3000
NEXT_PUBLIC_API_URL=
EOF
chmod 600 "$MERIDIAN_DIR/.env"; info "Configuration written to $MERIDIAN_DIR/.env"

step "7/10  Docker Compose"
cat > "$MERIDIAN_DIR/docker-compose.yml" << 'COMPOSE_EOF'
version: "3.9"
networks:
  meridian-net:
    driver: bridge
volumes:
  db_data:
  redis_data:
  minio_data:
  ollama_data:
services:
  db:
    image: postgres:16-alpine
    container_name: meridian-db
    environment:
      POSTGRES_USER: meridian
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: meridian
    volumes: [db_data:/var/lib/postgresql/data]
    networks: [meridian-net]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U meridian"]
      interval: 10s
      timeout: 5s
      retries: 5
  redis:
    image: redis:7-alpine
    container_name: meridian-redis
    volumes: [redis_data:/data]
    networks: [meridian-net]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
  minio:
    image: minio/minio:latest
    container_name: meridian-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: \${MINIO_PASSWORD}
    volumes: [minio_data:/data]
    networks: [meridian-net]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
  ollama:
    image: ollama/ollama:latest
    container_name: meridian-ollama
    volumes: [ollama_data:/root/.ollama]
    networks: [meridian-net]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "ollama", "list"]
      interval: 30s
      timeout: 10s
      retries: 5
  ollama-init:
    image: ollama/ollama:latest
    container_name: meridian-ollama-init
    volumes: [ollama_data:/root/.ollama]
    networks: [meridian-net]
    environment:
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      ollama:
        condition: service_healthy
    entrypoint: ["ollama", "pull", "qwen2.5:3b"]
    restart: "no"
  api:
    image: ghcr.io/luketempleman/meridian-api:latest
    platform: linux/amd64
    container_name: meridian-api
    env_file: .env
    ports: ["127.0.0.1:8000:8000"]
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks: [meridian-net]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
  worker:
    image: ghcr.io/luketempleman/meridian-worker:latest
    platform: linux/amd64
    container_name: meridian-worker
    command: ["celery", "-A", "workers.celery_app", "worker", "--loglevel=info", "--concurrency=4"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks: [meridian-net]
    restart: unless-stopped
  beat:
    image: ghcr.io/luketempleman/meridian-worker:latest
    platform: linux/amd64
    container_name: meridian-beat
    command: ["celery", "-A", "workers.celery_app", "beat", "--loglevel=info"]
    env_file: .env
    depends_on: [redis]
    networks: [meridian-net]
    restart: unless-stopped
  frontend:
    image: ghcr.io/luketempleman/meridian-frontend:latest
    platform: linux/amd64
    container_name: meridian-frontend
    env_file: .env
    environment:
      - INTERNAL_API_URL=http://api:8000
    ports: ["127.0.0.1:3000:3000"]
    depends_on:
      api:
        condition: service_healthy
    networks: [meridian-net]
    restart: unless-stopped
COMPOSE_EOF
info "docker-compose.yml written"

step "8/10  Nginx & SSL"
if [ "$IS_DOMAIN" = true ]; then
    if ! command -v certbot &>/dev/null; then
        apt-get install -y -q certbot python3-certbot-nginx 2>/dev/null || \\
        { snap install --classic certbot 2>/dev/null && ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null; } || true
    fi
    cat > "$NGINX_CONF" << NGINX_EOF
server {
    listen 80;
    server_name $SERVER_ADDRESS;
    client_max_body_size 200M;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \\$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \\$host;
        proxy_set_header   X-Real-IP \\$remote_addr;
        proxy_set_header   X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \\$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX_EOF
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/meridian
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    if command -v certbot &>/dev/null; then
        certbot --nginx -d "$SERVER_ADDRESS" --non-interactive --agree-tos \\
            --email "support@vantax.co.za" --redirect \\
            && info "SSL certificate issued" || warn "Certbot failed — running HTTP. Add SSL later: sudo certbot --nginx -d $SERVER_ADDRESS"
        PROTOCOL="https"
    else
        warn "Certbot unavailable — running HTTP"; PROTOCOL="http"
    fi
else
    mkdir -p /etc/nginx/ssl/meridian
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \\
        -keyout /etc/nginx/ssl/meridian/privkey.pem \\
        -out    /etc/nginx/ssl/meridian/fullchain.pem \\
        -subj   "/C=ZA/O=Meridian/CN=$SERVER_ADDRESS" 2>/dev/null
    cat > "$NGINX_CONF" << NGINX_EOF
server {
    listen 80;
    server_name $SERVER_ADDRESS;
    return 301 https://\\$host\\$request_uri;
}
server {
    listen 443 ssl;
    server_name $SERVER_ADDRESS;
    ssl_certificate     /etc/nginx/ssl/meridian/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/meridian/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    client_max_body_size 200M;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \\$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \\$host;
        proxy_set_header   X-Real-IP \\$remote_addr;
        proxy_set_header   X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
NGINX_EOF
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/meridian
    rm -f /etc/nginx/sites-enabled/default
    nginx -t || error "Nginx config test failed. Check $NGINX_CONF"
    systemctl reload nginx
    info "Self-signed SSL configured"; PROTOCOL="https"
fi
FINAL_URL="\${PROTOCOL}://\${SERVER_ADDRESS}"

step "9/10  System Service"
cat > "$SYSTEMD_UNIT" << SYSTEMD_EOF
[Unit]
Description=Meridian Platform (SAP Data Quality & MDM)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=\${MERIDIAN_DIR}
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=300
TimeoutStopSec=60
[Install]
WantedBy=multi-user.target
SYSTEMD_EOF
systemctl daemon-reload && systemctl enable meridian
info "Systemd service installed — starts automatically on reboot"

step "10/10  Starting Meridian"
cd "$MERIDIAN_DIR"
docker compose down --remove-orphans 2>/dev/null || true
echo "Pulling images..."; docker compose pull || error "Failed to pull images. Check GHCR package visibility."
info "Images downloaded"
echo "Starting database and Redis..."
docker compose up -d db redis
for i in {1..30}; do
    docker compose exec -T db pg_isready -U meridian &>/dev/null && { info "Database ready"; break; }
    [ $i -eq 30 ] && error "Database failed to start."
    sleep 2
done
echo "Running migrations..."
docker compose run --rm -T api alembic upgrade head || error "Migrations failed."
info "Migrations complete"
echo "Starting all services..."
docker compose up -d; info "All services started"

echo "Waiting for API..."
for i in {1..60}; do
    curl -sf http://localhost:8000/health &>/dev/null && { info "API is healthy"; break; }
    [ $i -eq 60 ] && warn "API health check timed out. Check: docker compose logs api"
    sleep 3
done
sleep 5

if [ "$ADMIN_EMAIL" != "SKIP" ] && [ -n "\${ADMIN_EMAIL:-}" ] && [ -n "\${ADMIN_PASS:-}" ]; then
    echo "Creating admin user..."
    ADMIN_RESULT=$(docker compose exec -T api \\
        python scripts/manage_users.py create \\
        --email "$ADMIN_EMAIL" --name "\${ADMIN_NAME:-$ADMIN_EMAIL}" \\
        --password "$ADMIN_PASS" --role admin 2>&1 </dev/null) || true
    echo "$ADMIN_RESULT" | grep -qi "created\\|already exists" \\
        && info "Admin user ready: $ADMIN_EMAIL" \\
        || warn "Admin issue: $ADMIN_RESULT"
fi

echo ""; echo "Waiting for AI model (\${OLLAMA_MODEL}) to download (~2 GB on first install)..."
for i in {1..120}; do
    STATE=$(docker inspect --format '{{.State.Status}}' meridian-ollama-init 2>/dev/null || echo "missing")
    EXIT_CODE=$(docker inspect --format '{{.State.ExitCode}}' meridian-ollama-init 2>/dev/null || echo "-1")
    if [ "$STATE" = "exited" ] && [ "$EXIT_CODE" = "0" ]; then info "AI model \${OLLAMA_MODEL} ready"; break; fi
    if [ "$STATE" = "exited" ] && [ "$EXIT_CODE" != "0" ]; then
        warn "Model pull failed. Retry: docker compose -f $MERIDIAN_DIR/docker-compose.yml exec ollama ollama pull \${OLLAMA_MODEL}"; break; fi
    (( i % 6 == 0 )) && echo "  Downloading... (~\$((i * 5))s elapsed)"
    sleep 5
done

API_OK=false; FRONTEND_OK=false
curl -sf http://localhost:8000/health &>/dev/null && API_OK=true
STATUS_CODE=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
[[ "$STATUS_CODE" =~ ^(200|307|308)$ ]] && FRONTEND_OK=true
echo ""
[ "$API_OK" = true ]      && info "API:      healthy" || warn "API:      not responding — check: docker compose logs api"
[ "$FRONTEND_OK" = true ] && info "Frontend: healthy" || warn "Frontend: not responding — check: docker compose logs frontend"

echo ""
echo -e "\${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${NC}"
echo -e "  \${BOLD}✓ Meridian is running!\${NC}"
echo ""
echo "  Dashboard:  \${CYAN}\${FINAL_URL}\${NC}"
[ "$ADMIN_EMAIL" != "SKIP" ] && echo "  Login:      $ADMIN_EMAIL"
echo "  Company:    $COMPANY | Tier: $TIER | Expires: $EXPIRY"
echo -e "\${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\${NC}"
echo ""
echo "  Status:   sudo systemctl status meridian"
echo "  Logs:     docker compose -f $MERIDIAN_DIR/docker-compose.yml logs -f"
echo "  Update:   cd $MERIDIAN_DIR && docker compose pull && docker compose up -d"
echo "  Config:   $MERIDIAN_DIR/.env  |  Nginx: $NGINX_CONF"
echo "  Support:  support@vantax.co.za"
echo ""
`;

async function handleServeInstaller(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const licenceKey = url.searchParams.get("key") || "";

  // Require a key — no key, no script
  if (!licenceKey) {
    return new Response(
      "# Meridian Installer\n# Licence key required.\n# Usage: curl -fsSL \"https://get.meridian.vantax.co.za?key=MRDX-...\" | sudo bash\n",
      { status: 401, headers: { "Content-Type": "text/plain" } }
    );
  }

  const normalised = licenceKey.trim().toUpperCase();

  // Validate key against D1
  const keyHash = await hashKey(normalised);
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?")
    .bind(keyHash)
    .first<TenantRow>();

  if (!row) {
    return new Response("# Meridian Installer\n# Invalid licence key.\n", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (row.status === "suspended") {
    return new Response("# Meridian Installer\n# Licence is suspended. Contact support@vantax.co.za\n", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const expiry = new Date(row.expiry_date);
  const gracePeriodEnd = new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (expiry < new Date() && new Date() >= gracePeriodEnd) {
    return new Response("# Meridian Installer\n# Licence has expired. Contact support@vantax.co.za\n", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Log the download
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const ua = request.headers.get("User-Agent") || "";
  await env.DB.prepare(
    "INSERT INTO download_log (id, tenant_id, company_name, licence_key_suffix, ip_address, user_agent, downloaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(generateId(), row.id, row.company_name, normalised.slice(-9), ip, ua, nowIso())
    .run();

  return new Response(INSTALLER_SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "inline; filename=meridian-install.sh",
      "Cache-Control": "no-store",
      "X-Meridian-Company": row.company_name,
      "X-Meridian-Tier": row.tier,
    },
  });
}

// ─── Admin: Download Log ──────────────────────────────────────────────────────

async function handleListDownloads(request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);

  const query = tenantId
    ? "SELECT * FROM download_log WHERE tenant_id = ? ORDER BY downloaded_at DESC LIMIT ?"
    : "SELECT * FROM download_log ORDER BY downloaded_at DESC LIMIT ?";
  const params = tenantId ? [tenantId, limit] : [limit];

  const result = await env.DB.prepare(query).bind(...params).all<{
    id: string;
    tenant_id: string;
    company_name: string;
    licence_key_suffix: string;
    ip_address: string;
    user_agent: string;
    downloaded_at: string;
  }>();

  return json({ downloads: result.results || [], total: result.results?.length || 0 });
}

// ─── Licence Key Management ───────────────────────────────────────────────────

async function handleGetLicenceKey(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT licence_key_hash FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ licence_key_hash: string | null }>();

  if (!row) return json({ error: "not_found" }, 404);
  if (!row.licence_key_hash) {
    return json({ error: "no_key", message: "This tenant has no active licence key" }, 404);
  }

  // For security, we can't retrieve the original key (it's hashed)
  // Return a message that key exists but can't be shown
  return json({
    message: "Licence key exists but cannot be retrieved (hashed)",
    has_key: true,
    tenant_id: tenantId
  });
}

async function handleDeleteLicenceKey(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();

  if (!row) return json({ error: "not_found" }, 404);

  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = NULL, licence_key_suffix = NULL, updated_at = ? WHERE id = ?"
  )
    .bind(ts, tenantId)
    .run();

  return json({ deleted: true, tenant_id: tenantId });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── Public: installer script delivery ────────────────────────────────
      if (method === "GET" && (path === "/install" || path === "/")) {
        return await handleServeInstaller(request, env);
      }

      // ── Admin: download log ───────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/downloads") {
        return await handleListDownloads(request, env);
      }

      // ── Public: auth ──────────────────────────────────────────────────────
      if (method === "POST" && path === "/api/admin/login") {
        return await handleLogin(request, env);
      }
      if (method === "POST" && path === "/api/tenant/login") {
        return await handleTenantUserLogin(request, env);
      }

      // ── Public: licence ───────────────────────────────────────────────────
      if (method === "POST" && path === "/api/licence/validate") {
        return await handleValidate(request, env);
      }
      if (method === "GET" && path === "/api/licence/heartbeat") {
        return handleHeartbeat();
      }
      if (method === "POST" && path === "/api/licence/field-mappings/sync") {
        return await handleFieldMappingSync(request, env);
      }

      // ── Admin: analytics ──────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/analytics") {
        return await handleAdminAnalytics(request, env);
      }

      // ── Admin: tenants ────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/tenants") {
        return await handleListTenants(request, env);
      }
      if (method === "POST" && path === "/api/admin/tenants") {
        return await handleCreateTenant(request, env);
      }

      const tenantMatch = path.match(/^\/api\/admin\/tenants\/([^/]+)(\/.*)?$/);
      if (tenantMatch) {
        const tenantId = tenantMatch[1];
        const sub = tenantMatch[2] || "";

        if (sub === "/regenerate-key" && method === "POST") return await handleRegenerateKey(tenantId, request, env);
        if (sub === "/offline-token" && method === "POST") return await handleGenerateOfflineToken(tenantId, request, env);
        if (sub === "/licence-key") {
          if (method === "GET") return await handleGetLicenceKey(tenantId, request, env);
          if (method === "DELETE") return await handleDeleteLicenceKey(tenantId, request, env);
        }
        if (sub === "/field-mappings") {
          if (method === "GET") return await handleGetTenantFieldMappings(tenantId, request, env);
          if (method === "PUT" || method === "POST") return await handleUpsertTenantFieldMappings(tenantId, request, env);
        }
        if (sub === "") {
          if (method === "GET") return await handleGetTenant(tenantId, request, env);
          if (method === "PUT") return await handleUpdateTenant(tenantId, request, env, false);
          if (method === "PATCH") return await handleUpdateTenant(tenantId, request, env, true);
          if (method === "DELETE") return await handleDeleteTenant(tenantId, request, env);
        }
      }

      // ── Admin: rules ──────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/rules") return await handleListRules(request, env);
      if (method === "POST" && path === "/api/admin/rules") return await handleCreateRule(request, env);
      if (method === "POST" && path === "/api/admin/rules/import") return await handleBulkImportRules(request, env);

      const ruleMatch = path.match(/^\/api\/admin\/rules\/([^/]+)$/);
      if (ruleMatch) {
        const ruleId = ruleMatch[1];
        if (method === "GET") return await handleGetRule(ruleId, request, env);
        if (method === "PUT") return await handleUpdateRule(ruleId, request, env, false);
        if (method === "PATCH") return await handleUpdateRule(ruleId, request, env, true);
        if (method === "DELETE") return await handleDeleteRule(ruleId, request, env);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return json({ error: "internal_error", message }, 500);
    }
  },
};
