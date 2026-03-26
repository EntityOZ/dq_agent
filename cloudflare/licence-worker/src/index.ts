/**
 * Meridian Licence Worker — Cloudflare Worker
 *
 * Endpoints:
 *   POST /api/licence/validate       — validate key, return full manifest
 *   GET  /api/licence/heartbeat      — health check
 *   POST /api/licence/field-mappings/sync — receive field mapping updates from customer
 *
 * Admin endpoints (require X-Admin-Secret):
 *   GET    /api/admin/tenants               — list tenants
 *   POST   /api/admin/tenants               — create tenant + generate key
 *   GET    /api/admin/tenants/:id           — get tenant detail
 *   PUT    /api/admin/tenants/:id           — full update
 *   PATCH  /api/admin/tenants/:id           — partial update (status, expiry, modules…)
 *   DELETE /api/admin/tenants/:id           — delete tenant
 *   POST   /api/admin/tenants/:id/regenerate-key — regenerate licence key
 *   GET    /api/admin/tenants/:id/field-mappings — get field mappings for tenant
 *   GET    /api/admin/analytics             — HQ dashboard stats
 *
 *   GET    /api/admin/rules                 — list rules
 *   POST   /api/admin/rules                 — create rule
 *   GET    /api/admin/rules/:id             — get rule
 *   PUT    /api/admin/rules/:id             — update rule
 *   PATCH  /api/admin/rules/:id             — partial update (enable/disable)
 *   DELETE /api/admin/rules/:id             — delete rule
 *   POST   /api/admin/rules/import          — bulk import rules from JSON array
 */

interface Env {
  LICENCE_KV: KVNamespace;
  DB: D1Database;
  LICENCE_ADMIN_SECRET: string;
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

// ─── Utilities ───────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateLicenceKey(): string {
  // Format: MRDX-XXXX-XXXX-XXXX (uppercase hex segments)
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

function now(): string {
  return new Date().toISOString();
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret");
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

function requireAdmin(request: Request, env: Env): Response | null {
  const secret = request.headers.get("X-Admin-Secret");
  if (!secret || secret !== env.LICENCE_ADMIN_SECRET) {
    return json({ error: "unauthorized", message: "Invalid or missing admin secret" }, 401);
  }
  return null;
}

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
    "plant_maintenance", "production_planning", "sd_customer_master",
    "sd_sales_orders",
  ],
  professional: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master",
    "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
  ],
  enterprise: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master",
    "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management",
    "wm_interface", "cross_system_integration",
  ],
};

// ─── Licence Validation ───────────────────────────────────────────────────────

async function handleValidate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { licenceKey?: string; machineFingerprint?: string };
  const { licenceKey, machineFingerprint } = body;

  if (!licenceKey) {
    return json({ valid: false, reason: "missing_key" }, 400);
  }

  const keyHash = await hashKey(licenceKey);

  // Look up in D1
  const row = await env.DB.prepare(
    "SELECT * FROM tenants WHERE licence_key_hash = ?"
  )
    .bind(keyHash)
    .first<TenantRow>();

  if (!row) {
    // Fallback to legacy KV store
    const kv = await env.LICENCE_KV.get(`licence:${licenceKey}`, "json") as {
      modules: string[];
      features: string[];
      expiresAt: string;
      tenantId: string;
      active: boolean;
    } | null;
    if (!kv || !kv.active) {
      return json({ valid: false, reason: "invalid_key" }, 403);
    }
    if (new Date(kv.expiresAt) < new Date()) {
      return json({ valid: false, reason: "expired" }, 403);
    }
    // Log ping to KV
    await env.LICENCE_KV.put(
      `ping:${licenceKey}`,
      JSON.stringify({ lastSeen: now(), machineFingerprint }),
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
    // Within 7-day grace period — return 402 with grace info
    return json(
      {
        valid: false,
        reason: "expired_grace",
        grace_period_ends: gracePeriodEnd.toISOString(),
        tenant_id: row.id,
      },
      402
    );
  }

  // Update last ping
  await env.DB.prepare(
    "UPDATE tenants SET last_ping = ?, machine_fingerprint = ?, updated_at = ? WHERE id = ?"
  )
    .bind(now(), machineFingerprint || null, now(), row.id)
    .run();

  const enabledModules = JSON.parse(row.enabled_modules || "[]") as string[];

  // Fetch rules for enabled modules
  const placeholders = enabledModules.map(() => "?").join(",");
  let rules: ReturnType<typeof parseRule>[] = [];
  if (enabledModules.length > 0) {
    const rulesResult = await env.DB.prepare(
      `SELECT * FROM rules WHERE enabled = 1 AND module IN (${placeholders}) ORDER BY module, id`
    )
      .bind(...enabledModules)
      .all<RuleRow>();
    rules = (rulesResult.results || []).map(parseRule);
  }

  // Fetch field mappings for this tenant
  const mappingsResult = await env.DB.prepare(
    "SELECT * FROM field_mappings WHERE tenant_id = ? ORDER BY module, standard_field"
  )
    .bind(row.id)
    .all<FieldMappingRow>();
  const fieldMappings = (mappingsResult.results || []).map(parseFieldMapping);

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
    field_mappings: fieldMappings,
    llm_config: JSON.parse(row.llm_config || "{}") as LlmConfig,
  });
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function handleHeartbeat(): Response {
  return json({ status: "ok", ts: now() });
}

// ─── Field Mapping Sync (from customer backend) ───────────────────────────────

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

  if (!tenant) {
    return json({ error: "unauthorized", message: "Invalid licence key" }, 401);
  }

  // Check self-service is enabled for this tenant
  const features = await env.DB.prepare("SELECT features FROM tenants WHERE id = ?")
    .bind(tenant.id)
    .first<{ features: string }>();
  const featureObj = JSON.parse(features?.features || "{}") as TenantFeatures;
  if (!featureObj.field_mapping_self_service) {
    return json({ error: "forbidden", message: "Field mapping self-service is not enabled for this tenant" }, 403);
  }

  const ts = now();
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
        generateId(),
        tenant.id,
        m.module,
        m.standard_field,
        m.customer_field,
        m.customer_label || null,
        m.is_mapped ? 1 : 0,
        m.notes || null,
        ts
      )
      .run();
    upserted++;
  }

  return json({ synced: upserted, tenant_id: tenant.id });
}

// ─── Admin: Tenants ───────────────────────────────────────────────────────────

async function handleListTenants(request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const tier = url.searchParams.get("tier");
  const search = url.searchParams.get("q");

  let query = "SELECT * FROM tenants";
  const params: string[] = [];
  const conditions: string[] = [];

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
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY created_at DESC";

  const result = await env.DB.prepare(query).bind(...params).all<TenantRow>();
  return json({ tenants: (result.results || []).map(parseTenant) });
}

async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
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
  };

  if (!body.company_name || !body.contact_email || !body.expiry_date) {
    return json({ error: "bad_request", message: "company_name, contact_email, and expiry_date are required" }, 400);
  }

  const tier = body.tier || "starter";
  const licenceKey = generateLicenceKey();
  const keyHash = await hashKey(licenceKey);
  const keySuffix = licenceKey.slice(-4);
  const id = generateId();
  const ts = now();

  const enabledModules = body.enabled_modules || TIER_MODULES[tier] || TIER_MODULES.starter;
  const enabledMenuItems = body.enabled_menu_items || DEFAULT_MENU_ITEMS;
  const features: TenantFeatures = { ...DEFAULT_FEATURES, ...(body.features || {}) };
  const llmConfig: LlmConfig = { tier: 1, model: "", notes: "", ...(body.llm_config || {}) };

  await env.DB.prepare(`
    INSERT INTO tenants (id, company_name, contact_email, licence_key_hash, licence_key_suffix, tier, status, expiry_date, enabled_modules, enabled_menu_items, features, llm_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
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
    )
    .run();

  return json({ id, licence_key: licenceKey, company_name: body.company_name, tier, status: body.status || "trial" }, 201);
}

async function handleGetTenant(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();

  if (!row) return json({ error: "not_found" }, 404);
  return json(parseTenant(row));
}

async function handleUpdateTenant(tenantId: string, request: Request, env: Env, partial = false): Promise<Response> {
  const authErr = requireAdmin(request, env);
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
    const merged = partial
      ? { ...JSON.parse(existing.features || "{}"), ...body.features }
      : body.features;
    fields.push("features = ?");
    values.push(JSON.stringify(merged));
  }
  if (body.llm_config !== undefined) {
    const merged = partial
      ? { ...JSON.parse(existing.llm_config || "{}"), ...body.llm_config }
      : body.llm_config;
    fields.push("llm_config = ?");
    values.push(JSON.stringify(merged));
  }

  if (fields.length === 0) return json({ error: "bad_request", message: "No fields to update" }, 400);

  fields.push("updated_at = ?");
  values.push(now());
  values.push(tenantId);

  await env.DB.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
  return json(parseTenant(updated!));
}

async function handleDeleteTenant(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
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
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  const newKey = generateLicenceKey();
  const newHash = await hashKey(newKey);
  const newSuffix = newKey.slice(-4);

  await env.DB.prepare("UPDATE tenants SET licence_key_hash = ?, licence_key_suffix = ?, updated_at = ? WHERE id = ?")
    .bind(newHash, newSuffix, now(), tenantId)
    .run();

  return json({ licence_key: newKey, tenant_id: tenantId });
}

async function handleGetTenantFieldMappings(tenantId: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
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
  const authErr = requireAdmin(request, env);
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

  const ts = now();
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
      )
      .run();
    upserted++;
  }
  return json({ upserted });
}

// ─── Admin: Analytics ────────────────────────────────────────────────────────

async function handleAdminAnalytics(request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const allTenantsResult = await env.DB.prepare("SELECT status, tier, expiry_date FROM tenants").all<{
    status: string;
    tier: string;
    expiry_date: string;
  }>();
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

  const nowTs = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const expiringResult = await env.DB.prepare(
    "SELECT id, company_name, expiry_date, tier, status FROM tenants WHERE status = 'active' AND expiry_date <= ? ORDER BY expiry_date ASC LIMIT 10"
  )
    .bind(new Date(nowTs + thirtyDays).toISOString().split("T")[0])
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

// ─── Admin: Rules ─────────────────────────────────────────────────────────────

async function handleListRules(request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
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
  if (enabled !== null) { conditions.push("enabled = ?"); params.push(enabled === "true" ? 1 : 0); }
  if (search) { conditions.push("LOWER(name) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }

  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY category, module, id";

  const result = await env.DB.prepare(query).bind(...params).all<RuleRow>();
  return json({ rules: (result.results || []).map(parseRule), total: result.results?.length || 0 });
}

async function handleCreateRule(request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
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
  const ts = now();
  await env.DB.prepare(`
    INSERT INTO rules (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
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
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RuleRow>();
  return json(parseRule(row!), 201);
}

async function handleGetRule(ruleId: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first<RuleRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json(parseRule(row));
}

async function handleUpdateRule(ruleId: string, request: Request, env: Env, partial = false): Promise<Response> {
  const authErr = requireAdmin(request, env);
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

  const existing = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first<RuleRow>();
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
  fields.push("updated_at = ?"); values.push(now()); values.push(ruleId);

  await env.DB.prepare(`UPDATE rules SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  const updated = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(ruleId).first<RuleRow>();
  return json(parseRule(updated!));
}

async function handleDeleteRule(ruleId: string, request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const row = await env.DB.prepare("SELECT id FROM rules WHERE id = ?").bind(ruleId).first<{ id: string }>();
  if (!row) return json({ error: "not_found" }, 404);

  await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();
  return json({ deleted: true, id: ruleId });
}

async function handleBulkImportRules(request: Request, env: Env): Promise<Response> {
  const authErr = requireAdmin(request, env);
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

  const ts = now();
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
      // ── Public licence endpoints ──────────────────────────────────────────
      if (method === "POST" && path === "/api/licence/validate") {
        return await handleValidate(request, env);
      }
      if (method === "GET" && path === "/api/licence/heartbeat") {
        return handleHeartbeat();
      }
      if (method === "POST" && path === "/api/licence/field-mappings/sync") {
        return await handleFieldMappingSync(request, env);
      }

      // ── Legacy endpoints (backward compat) ────────────────────────────────
      if (method === "POST" && path === "/validate") {
        return await handleValidate(request, env);
      }
      if (method === "GET" && path === "/status") {
        const key = url.searchParams.get("key") || "";
        const keyHash = await hashKey(key);
        const row = await env.DB.prepare("SELECT * FROM tenants WHERE licence_key_hash = ?")
          .bind(keyHash).first<TenantRow>();
        if (!row) return json({ valid: false }, 404);
        const expired = new Date(row.expiry_date) < new Date();
        return json({
          valid: row.status === "active" && !expired,
          expiresAt: row.expiry_date,
          daysRemaining: daysRemaining(row.expiry_date),
          modules: JSON.parse(row.enabled_modules || "[]"),
          features: JSON.parse(row.features || "{}"),
        });
      }
      if (method === "POST" && path === "/provision") {
        const authErr = requireAdmin(request, env);
        if (authErr) return authErr;
        return await handleCreateTenant(request, env);
      }
      if (method === "POST" && path === "/revoke") {
        const authErr = requireAdmin(request, env);
        if (authErr) return authErr;
        const body = (await request.json()) as { licenceKey: string };
        const keyHash = await hashKey(body.licenceKey);
        await env.DB.prepare("UPDATE tenants SET status = 'suspended', updated_at = ? WHERE licence_key_hash = ?")
          .bind(now(), keyHash).run();
        return json({ revoked: true });
      }
      if (method === "GET" && path === "/pings") {
        const authErr = requireAdmin(request, env);
        if (authErr) return authErr;
        const result = await env.DB.prepare(
          "SELECT id, company_name, last_ping, machine_fingerprint FROM tenants WHERE last_ping IS NOT NULL ORDER BY last_ping DESC LIMIT 50"
        ).all<{ id: string; company_name: string; last_ping: string; machine_fingerprint: string }>();
        return json({
          pings: (result.results || []).map((r) => ({
            tenantId: r.id,
            companyName: r.company_name,
            lastSeen: r.last_ping,
            machineFingerprint: r.machine_fingerprint,
          })),
        });
      }

      // ── Admin: Analytics ──────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/analytics") {
        return await handleAdminAnalytics(request, env);
      }

      // ── Admin: Tenants ────────────────────────────────────────────────────
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

        if (sub === "/regenerate-key" && method === "POST") {
          return await handleRegenerateKey(tenantId, request, env);
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

      // ── Admin: Rules ──────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/admin/rules") {
        return await handleListRules(request, env);
      }
      if (method === "POST" && path === "/api/admin/rules") {
        return await handleCreateRule(request, env);
      }
      if (method === "POST" && path === "/api/admin/rules/import") {
        return await handleBulkImportRules(request, env);
      }

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
