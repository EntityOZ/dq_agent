var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
function generateId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateId, "generateId");
function generateLicenceKey() {
  const seg = /* @__PURE__ */ __name(() => {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }, "seg");
  return `MRDX-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`;
}
__name(generateLicenceKey, "generateLicenceKey");
async function hashKey(key) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashKey, "hashKey");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function cors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Credentials", "true");
  return new Response(response.body, { status: response.status, headers });
}
__name(cors, "cors");
function json(data, status = 200) {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  );
}
__name(json, "json");
function b64url(data) {
  return btoa(data).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(b64url, "b64url");
function b64urlDecode(s) {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}
__name(b64urlDecode, "b64urlDecode");
async function signJwt(payload, secret) {
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
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${signingInput}.${sigB64}`;
}
__name(signJwt, "signJwt");
async function verifyJwt(token, secret) {
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
  let sigBytes;
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
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1e3)) {
    return null;
  }
  return payload;
}
__name(verifyJwt, "verifyJwt");
async function requireAdmin(request, env) {
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
__name(requireAdmin, "requireAdmin");
function parseTenant(row) {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_email: row.contact_email,
    licence_key_masked: row.licence_key_suffix ? `MRDX-****-****-${row.licence_key_suffix}` : null,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    enabled_modules: JSON.parse(row.enabled_modules || "[]"),
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]"),
    features: JSON.parse(row.features || "{}"),
    llm_config: JSON.parse(row.llm_config || "{}"),
    machine_fingerprint: row.machine_fingerprint,
    last_ping: row.last_ping,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(parseTenant, "parseTenant");
function parseRule(row) {
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
    tags: JSON.parse(row.tags || "[]"),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
__name(parseRule, "parseRule");
function parseFieldMapping(row) {
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
    updated_at: row.updated_at
  };
}
__name(parseFieldMapping, "parseFieldMapping");
function daysRemaining(expiryDate) {
  const diff = new Date(expiryDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1e3 * 60 * 60 * 24)));
}
__name(daysRemaining, "daysRemaining");
var DEFAULT_MENU_ITEMS = [
  "dashboard",
  "findings",
  "versions",
  "analytics",
  "import",
  "sync",
  "reports",
  "stewardship",
  "contracts",
  "ask_meridian",
  "export",
  "user_management",
  "settings",
  "licence"
];
var DEFAULT_FEATURES = {
  ask_meridian: true,
  export_reports: true,
  run_sync: true,
  field_mapping_self_service: false,
  max_users: 20
};
var TIER_MODULES = {
  starter: [
    "business_partner",
    "material_master",
    "fi_gl",
    "accounts_payable",
    "accounts_receivable",
    "asset_accounting",
    "mm_purchasing",
    "plant_maintenance",
    "production_planning",
    "sd_customer_master",
    "sd_sales_orders"
  ],
  professional: [
    "business_partner",
    "material_master",
    "fi_gl",
    "accounts_payable",
    "accounts_receivable",
    "asset_accounting",
    "mm_purchasing",
    "plant_maintenance",
    "production_planning",
    "sd_customer_master",
    "sd_sales_orders",
    "employee_central",
    "compensation",
    "benefits",
    "payroll_integration",
    "performance_goals",
    "succession_planning",
    "recruiting_onboarding",
    "learning_management",
    "time_attendance"
  ],
  enterprise: [
    "business_partner",
    "material_master",
    "fi_gl",
    "accounts_payable",
    "accounts_receivable",
    "asset_accounting",
    "mm_purchasing",
    "plant_maintenance",
    "production_planning",
    "sd_customer_master",
    "sd_sales_orders",
    "employee_central",
    "compensation",
    "benefits",
    "payroll_integration",
    "performance_goals",
    "succession_planning",
    "recruiting_onboarding",
    "learning_management",
    "time_attendance",
    "ewms_stock",
    "ewms_transfer_orders",
    "batch_management",
    "mdg_master_data",
    "grc_compliance",
    "fleet_management",
    "transport_management",
    "wm_interface",
    "cross_system_integration"
  ]
};
async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
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
  const nowSec = Math.floor(Date.now() / 1e3);
  const token = await signJwt(
    {
      sub: body.email,
      role: "admin",
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60
      // 8 hours
    },
    env.JWT_SECRET
  );
  return json({ token, expiresIn: 8 * 60 * 60 });
}
__name(handleLogin, "handleLogin");
async function handleGenerateOfflineToken(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  if (!env.OFFLINE_JWT_PRIVATE_KEY) {
    return json(
      { error: "not_configured", message: "OFFLINE_JWT_PRIVATE_KEY secret is not set" },
      503
    );
  }
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const body = await request.json().catch(() => ({}));
  const expiryDays = Math.min(Math.max(Number(body.expiryDays) || 365, 1), 1095);
  const nowSec = Math.floor(Date.now() / 1e3);
  const exp = nowSec + expiryDays * 86400;
  const expiresAt = new Date(exp * 1e3).toISOString();
  const rulesResult = await env.DB.prepare(
    "SELECT * FROM rules WHERE enabled = 1 ORDER BY module, category"
  ).all();
  const rules = (rulesResult.results || []).map(parseRule);
  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ?"
  ).bind(tenantId).all();
  const fieldMappings = (mappingsResult.results || []).map(parseFieldMapping);
  const payload = {
    iss: "meridian-hq",
    sub: tenantId,
    iat: nowSec,
    exp,
    tenant_id: tenantId,
    enabled_modules: JSON.parse(row.enabled_modules || "[]"),
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]"),
    features: JSON.parse(row.features || "{}"),
    llm_config: JSON.parse(row.llm_config || "{}"),
    rules,
    field_mappings: fieldMappings
  };
  const keyPem = env.OFFLINE_JWT_PRIVATE_KEY.trim();
  const pemBody = keyPem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encode = /* @__PURE__ */ __name((obj) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"), "encode");
  const headerB64 = encode({ alg: "RS256", typ: "JWT" });
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return json({ token: `${signingInput}.${sig}`, expiresAt, expiryDays });
}
__name(handleGenerateOfflineToken, "handleGenerateOfflineToken");
async function handleValidate(request, env) {
  const body = await request.json();
  const { licenceKey, machineFingerprint } = body;
  if (!licenceKey) {
    return json({ valid: false, reason: "missing_key" }, 400);
  }
  const keyHash = await hashKey(licenceKey);
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?").bind(keyHash).first();
  if (!row) {
    const kv = await env.LICENCE_KV.get(`licence:${licenceKey}`, "json");
    if (!kv || !kv.active) return json({ valid: false, reason: "invalid_key" }, 403);
    if (new Date(kv.expiresAt) < /* @__PURE__ */ new Date()) return json({ valid: false, reason: "expired" }, 403);
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
      llm_config: { tier: 1, model: "", notes: "Legacy licence" }
    });
  }
  if (row.status === "suspended") {
    return json({ valid: false, reason: "suspended" }, 403);
  }
  const expiry = new Date(row.expiry_date);
  const expired = expiry < /* @__PURE__ */ new Date();
  const gracePeriodEnd = new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1e3);
  const inGrace = expired && /* @__PURE__ */ new Date() < gracePeriodEnd;
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
  ).bind(nowIso(), machineFingerprint || null, nowIso(), row.id).run();
  const enabledModules = JSON.parse(row.enabled_modules || "[]");
  let rules = [];
  if (enabledModules.length > 0) {
    const placeholders = enabledModules.map(() => "?").join(",");
    const rulesResult = await env.DB.prepare(
      `SELECT * FROM rules WHERE enabled = 1 AND module IN (${placeholders}) ORDER BY module, id`
    ).bind(...enabledModules).all();
    rules = (rulesResult.results || []).map(parseRule);
  }
  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field"
  ).bind(row.id).all();
  return json({
    valid: true,
    tenant_id: row.id,
    company_name: row.company_name,
    tier: row.tier,
    status: row.status,
    expiry_date: row.expiry_date,
    days_remaining: daysRemaining(row.expiry_date),
    enabled_modules: enabledModules,
    enabled_menu_items: JSON.parse(row.enabled_menu_items || "[]"),
    features: JSON.parse(row.features || "{}"),
    rules,
    field_mappings: (mappingsResult.results || []).map(parseFieldMapping),
    llm_config: JSON.parse(row.llm_config || "{}")
  });
}
__name(handleValidate, "handleValidate");
function handleHeartbeat() {
  return json({ status: "ok", ts: nowIso() });
}
__name(handleHeartbeat, "handleHeartbeat");
async function handleFieldMappingSync(request, env) {
  const body = await request.json();
  const { licence_key, mappings } = body;
  if (!licence_key || !Array.isArray(mappings)) {
    return json({ error: "bad_request", message: "licence_key and mappings are required" }, 400);
  }
  const keyHash = await hashKey(licence_key);
  const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE licence_key_hash = ?").bind(keyHash).first();
  if (!tenant) return json({ error: "unauthorized", message: "Invalid licence key" }, 401);
  const features = await env.DB.prepare("SELECT features FROM tenants WHERE id = ?").bind(tenant.id).first();
  const featureObj = JSON.parse(features?.features || "{}");
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
    `).bind(
      generateId(),
      tenant.id,
      m.module,
      m.standard_field,
      m.customer_field,
      m.customer_label || null,
      m.is_mapped ? 1 : 0,
      m.notes || null,
      ts
    ).run();
    upserted++;
  }
  return json({ synced: upserted, tenant_id: tenant.id });
}
__name(handleFieldMappingSync, "handleFieldMappingSync");
async function handleAdminAnalytics(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const allTenantsResult = await env.DB.prepare(
    "SELECT status, tier, expiry_date FROM tenants"
  ).all();
  const rows = allTenantsResult.results || [];
  const total = rows.length;
  const byStatus = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const byTier = rows.reduce((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {});
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
  const expiringResult = await env.DB.prepare(
    "SELECT id, company_name, expiry_date, tier, status FROM tenants WHERE status = 'active' AND expiry_date <= ? ORDER BY expiry_date ASC LIMIT 10"
  ).bind(thirtyDaysLater).all();
  const recentPingsResult = await env.DB.prepare(
    "SELECT id, company_name, last_ping, status FROM tenants WHERE last_ping IS NOT NULL ORDER BY last_ping DESC LIMIT 10"
  ).all();
  return json({
    total,
    by_status: byStatus,
    by_tier: byTier,
    expiring_soon: expiringResult.results || [],
    recent_activity: recentPingsResult.results || []
  });
}
__name(handleAdminAnalytics, "handleAdminAnalytics");
async function handleListTenants(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tier = url.searchParams.get("tier");
  const search = url.searchParams.get("q");
  let query = "SELECT * FROM tenants";
  const params = [];
  const conditions = [];
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (tier) {
    conditions.push("tier = ?");
    params.push(tier);
  }
  if (search) {
    conditions.push("(LOWER(company_name) LIKE ? OR LOWER(contact_email) LIKE ?)");
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC";
  const result = await env.DB.prepare(query).bind(...params).all();
  return json({ tenants: (result.results || []).map(parseTenant) });
}
__name(handleListTenants, "handleListTenants");
async function handleCreateTenant(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
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
  const features = { ...DEFAULT_FEATURES, ...body.features || {} };
  const llmConfig = { tier: 1, model: "", notes: "", ...body.llm_config || {} };
  await env.DB.prepare(`
    INSERT INTO tenants (id, company_name, contact_email, licence_key_hash, licence_key_suffix, tier, status, expiry_date, enabled_modules, enabled_menu_items, features, llm_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.company_name,
    body.contact_email,
    keyHash,
    keySuffix,
    tier,
    body.status || "trial",
    body.expiry_date,
    JSON.stringify(enabledModules),
    JSON.stringify(enabledMenuItems),
    JSON.stringify(features),
    JSON.stringify(llmConfig),
    ts,
    ts
  ).run();
  if (body.admin_user?.email && body.admin_user?.password) {
    const userId = generateId();
    const passwordHash = await hashKey(body.admin_user.password);
    await env.DB.prepare(`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      id,
      body.admin_user.email,
      passwordHash,
      body.admin_user.role || "admin",
      ts,
      ts
    ).run();
  }
  return json({ id, licence_key: licenceKey, company_name: body.company_name, tier, status: body.status || "trial" }, 201);
}
__name(handleCreateTenant, "handleCreateTenant");
async function handleGetTenant(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseTenant(row));
}
__name(handleGetTenant, "handleGetTenant");
async function handleUpdateTenant(tenantId, request, env, partial = false) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!existing) return json({ error: "not_found" }, 404);
  const fields = [];
  const values = [];
  if (body.company_name !== void 0) {
    fields.push("company_name = ?");
    values.push(body.company_name);
  }
  if (body.contact_email !== void 0) {
    fields.push("contact_email = ?");
    values.push(body.contact_email);
  }
  if (body.tier !== void 0) {
    fields.push("tier = ?");
    values.push(body.tier);
  }
  if (body.status !== void 0) {
    fields.push("status = ?");
    values.push(body.status);
  }
  if (body.expiry_date !== void 0) {
    fields.push("expiry_date = ?");
    values.push(body.expiry_date);
  }
  if (body.enabled_modules !== void 0) {
    fields.push("enabled_modules = ?");
    values.push(JSON.stringify(body.enabled_modules));
  }
  if (body.enabled_menu_items !== void 0) {
    fields.push("enabled_menu_items = ?");
    values.push(JSON.stringify(body.enabled_menu_items));
  }
  if (body.features !== void 0) {
    const merged = partial ? { ...JSON.parse(existing.features || "{}"), ...body.features } : body.features;
    fields.push("features = ?");
    values.push(JSON.stringify(merged));
  }
  if (body.llm_config !== void 0) {
    const merged = partial ? { ...JSON.parse(existing.llm_config || "{}"), ...body.llm_config } : body.llm_config;
    fields.push("llm_config = ?");
    values.push(JSON.stringify(merged));
  }
  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);
  fields.push("updated_at = ?");
  values.push(nowIso());
  values.push(tenantId);
  await env.DB.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  const updated = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(tenantId).first();
  return json(parseTenant(updated));
}
__name(handleUpdateTenant, "handleUpdateTenant");
async function handleDeleteTenant(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM field_mappings WHERE tenant_id = ?").bind(tenantId).run();
  await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId).run();
  return json({ deleted: true, id: tenantId });
}
__name(handleDeleteTenant, "handleDeleteTenant");
async function handleRegenerateKey(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const newKey = generateLicenceKey();
  const newHash = await hashKey(newKey);
  const newSuffix = newKey.slice(-4);
  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = ?, licence_key_suffix = ?, updated_at = ? WHERE id = ?"
  ).bind(newHash, newSuffix, nowIso(), tenantId).run();
  return json({ licence_key: newKey, tenant_id: tenantId });
}
__name(handleRegenerateKey, "handleRegenerateKey");
async function handleGetTenantFieldMappings(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const url = new URL(request.url);
  const module = url.searchParams.get("module");
  const query = module ? "SELECT * FROM field_mappings WHERE tenant_id = ? AND module = ? ORDER BY standard_field" : "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field";
  const params = module ? [tenantId, module] : [tenantId];
  const result = await env.DB.prepare(query).bind(...params).all();
  return json({ field_mappings: (result.results || []).map(parseFieldMapping) });
}
__name(handleGetTenantFieldMappings, "handleGetTenantFieldMappings");
async function handleUpsertTenantFieldMappings(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
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
    `).bind(
      generateId(),
      tenantId,
      m.module,
      m.standard_field,
      m.standard_label || null,
      m.customer_field || null,
      m.customer_label || null,
      m.data_type || "string",
      m.is_mapped ? 1 : 0,
      m.notes || null,
      ts
    ).run();
    upserted++;
  }
  return json({ upserted });
}
__name(handleUpsertTenantFieldMappings, "handleUpsertTenantFieldMappings");
async function handleListRules(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const module = url.searchParams.get("module");
  const severity = url.searchParams.get("severity");
  const enabled = url.searchParams.get("enabled");
  const search = url.searchParams.get("q");
  let query = "SELECT * FROM rules";
  const params = [];
  const conditions = [];
  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (module) {
    conditions.push("module = ?");
    params.push(module);
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(severity);
  }
  if (enabled !== null && enabled !== "") {
    conditions.push("enabled = ?");
    params.push(enabled === "true" ? 1 : 0);
  }
  if (search) {
    conditions.push("LOWER(name) LIKE ?");
    params.push(`%${search.toLowerCase()}%`);
  }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY category, module, id";
  const result = await env.DB.prepare(query).bind(...params).all();
  return json({ rules: (result.results || []).map(parseRule), total: result.results?.length || 0 });
}
__name(handleListRules, "handleListRules");
async function handleCreateRule(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
  if (!body.name || !body.module || !body.category) {
    return json({ error: "bad_request", message: "name, module, and category are required" }, 400);
  }
  const id = generateId();
  const ts = nowIso();
  await env.DB.prepare(`
    INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name,
    body.description || null,
    body.module,
    body.category,
    body.severity || "medium",
    body.enabled !== false ? 1 : 0,
    JSON.stringify(body.conditions || []),
    JSON.stringify(body.thresholds || {}),
    JSON.stringify(body.tags || []),
    ts,
    ts
  ).run();
  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first();
  return json(parseRule(row), 201);
}
__name(handleCreateRule, "handleCreateRule");
async function handleGetRule(ruleId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseRule(row));
}
__name(handleGetRule, "handleGetRule");
async function handleUpdateRule(ruleId, request, env, partial = false) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first();
  if (!existing) return json({ error: "not_found" }, 404);
  const fields = [];
  const values = [];
  if (body.name !== void 0) {
    fields.push("name = ?");
    values.push(body.name);
  }
  if (body.description !== void 0) {
    fields.push("description = ?");
    values.push(body.description);
  }
  if (body.module !== void 0) {
    fields.push("module = ?");
    values.push(body.module);
  }
  if (body.category !== void 0) {
    fields.push("category = ?");
    values.push(body.category);
  }
  if (body.severity !== void 0) {
    fields.push("severity = ?");
    values.push(body.severity);
  }
  if (body.enabled !== void 0) {
    fields.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }
  if (body.conditions !== void 0) {
    fields.push("conditions = ?");
    values.push(JSON.stringify(body.conditions));
  }
  if (body.thresholds !== void 0) {
    fields.push("thresholds = ?");
    values.push(JSON.stringify(body.thresholds));
  }
  if (body.tags !== void 0) {
    fields.push("tags = ?");
    values.push(JSON.stringify(body.tags));
  }
  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);
  fields.push("updated_at = ?");
  values.push(nowIso());
  values.push(ruleId);
  await env.DB.prepare(`UPDATE rules SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  const updated = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first();
  return json(parseRule(updated));
}
__name(handleUpdateRule, "handleUpdateRule");
async function handleDeleteRule(ruleId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM rules WHERE id = ?").bind(ruleId).first();
  if (!row) return json({ error: "not_found" }, 404);
  await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();
  return json({ deleted: true, id: ruleId });
}
__name(handleDeleteRule, "handleDeleteRule");
async function handleBulkImportRules(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const body = await request.json();
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
    `).bind(
      id,
      r.name,
      r.description || null,
      r.module,
      r.category,
      r.severity || "medium",
      r.enabled !== false ? 1 : 0,
      JSON.stringify(r.conditions || []),
      JSON.stringify(r.thresholds || {}),
      JSON.stringify(r.tags || []),
      ts,
      ts
    ).run();
    imported++;
  }
  return json({ imported });
}
__name(handleBulkImportRules, "handleBulkImportRules");
async function handleTenantUserLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body.email || !body.password) {
    return json({ error: "bad_request", message: "email and password are required" }, 400);
  }
  const passwordHash = await hashKey(body.password);
  const user = await env.DB.prepare(
    "SELECT id, tenant_id, email, role FROM tenant_users WHERE email = ? AND password_hash = ?"
  ).bind(body.email, passwordHash).first();
  if (!user) {
    return json({ error: "unauthorized", message: "Invalid credentials" }, 401);
  }
  const tenant = await env.DB.prepare("SELECT company_name, status FROM tenants WHERE id = ?").bind(user.tenant_id).first();
  if (!tenant) {
    return json({ error: "unauthorized", message: "Tenant not found" }, 401);
  }
  if (tenant.status === "suspended") {
    return json({ error: "forbidden", message: "Tenant account is suspended" }, 403);
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  const token = await signJwt(
    {
      sub: user.email,
      tenant_id: user.tenant_id,
      role: user.role,
      iat: nowSec,
      exp: nowSec + 8 * 60 * 60
      // 8 hours
    },
    env.JWT_SECRET
  );
  return json({
    token,
    expiresIn: 8 * 60 * 60,
    tenant_id: user.tenant_id,
    company_name: tenant.company_name
  });
}
__name(handleTenantUserLogin, "handleTenantUserLogin");
async function handleGetLicenceKey(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT licence_key_hash FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!row.licence_key_hash) {
    return json({ error: "no_key", message: "This tenant has no active licence key" }, 404);
  }
  return json({
    message: "Licence key exists but cannot be retrieved (hashed)",
    has_key: true,
    tenant_id: tenantId
  });
}
__name(handleGetLicenceKey, "handleGetLicenceKey");
async function handleDeleteLicenceKey(tenantId, request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!row) return json({ error: "not_found" }, 404);
  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE tenants SET licence_key_hash = NULL, licence_key_suffix = NULL, updated_at = ? WHERE id = ?"
  ).bind(ts, tenantId).run();
  return json({ deleted: true, tenant_id: tenantId });
}
__name(handleDeleteLicenceKey, "handleDeleteLicenceKey");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (method === "POST" && path === "/api/admin/login") {
        return await handleLogin(request, env);
      }
      if (method === "POST" && path === "/api/tenant/login") {
        return await handleTenantUserLogin(request, env);
      }
      if (method === "POST" && path === "/api/licence/validate") {
        return await handleValidate(request, env);
      }
      if (method === "GET" && path === "/api/licence/heartbeat") {
        return handleHeartbeat();
      }
      if (method === "POST" && path === "/api/licence/field-mappings/sync") {
        return await handleFieldMappingSync(request, env);
      }
      if (method === "GET" && path === "/api/admin/analytics") {
        return await handleAdminAnalytics(request, env);
      }
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
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-IPbpcp/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-IPbpcp/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
