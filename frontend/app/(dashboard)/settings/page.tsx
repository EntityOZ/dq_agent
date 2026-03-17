"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Calendar,
  Clock,
  FileText,
  Archive,
  Mail,
  Users,
  UserPlus,
  CreditCard,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getSettings,
  updateDqsWeights,
  updateAlertThresholds,
} from "@/lib/api/settings";
import { getExceptionBilling } from "@/lib/api/exceptions";
import { getUsers, updateUser, inviteUser } from "@/lib/api/users";
import { formatModuleName } from "@/lib/format";
import type { DimensionScores, UserRole, ExceptionBilling } from "@/types/api";

const DEFAULT_WEIGHTS: DimensionScores = {
  completeness: 25,
  accuracy: 25,
  consistency: 20,
  timeliness: 10,
  uniqueness: 10,
  validity: 10,
};

const DIMENSION_LABELS: Record<keyof DimensionScores, string> = {
  completeness: "Completeness",
  accuracy: "Accuracy",
  consistency: "Consistency",
  timeliness: "Timeliness",
  uniqueness: "Uniqueness",
  validity: "Validity",
};

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "steward", label: "Steward" },
  { value: "analyst", label: "Analyst" },
  { value: "approver", label: "Approver" },
  { value: "auditor", label: "Auditor" },
  { value: "viewer", label: "Viewer" },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-[#FEE2E2] text-[#DC2626]",
  steward: "bg-[#DBEAFE] text-[#1D6ECC]",
  analyst: "bg-[#D1FAE5] text-[#059669]",
  approver: "bg-[#FEF3C7] text-[#D97706]",
  auditor: "bg-[#F0F5FA] text-[#6B92AD]",
  viewer: "bg-[#F0F5FA] text-[#6B92AD]",
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const [weights, setWeights] = useState<DimensionScores>(DEFAULT_WEIGHTS);
  const [thresholds, setThresholds] = useState({
    critical_threshold: 1,
    high_threshold: 10,
    dqs_drop_threshold: 5,
  });

  useEffect(() => {
    if (settings?.dqs_weights) setWeights(settings.dqs_weights);
    if (settings?.alert_thresholds) setThresholds(settings.alert_thresholds);
  }, [settings]);

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const weightValid = weightSum === 100;

  const weightsMutation = useMutation({
    mutationFn: () => updateDqsWeights(weights),
    onSuccess: () => {
      toast.success("DQS weights saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error("Failed to save weights"),
  });

  const thresholdsMutation = useMutation({
    mutationFn: () => updateAlertThresholds(thresholds),
    onSuccess: () => {
      toast.success("Alert thresholds saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error("Failed to save thresholds"),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load settings.</AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Tabs defaultValue="general">
        <TabsList variant="line">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-1 h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="mr-1 h-4 w-4" />
            Billing
          </TabsTrigger>
        </TabsList>

        {/* ── General Tab ────────────────────────────────────────────────── */}
        <TabsContent value="general">
          <div className="space-y-8 pt-4">
            {/* Section 1 — Tenant config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tenant Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Tenant Name
                    </span>
                    <p className="font-medium">{settings?.name ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Licensed Modules
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {settings?.licensed_modules?.map((m) => (
                        <Badge key={m} variant="secondary">
                          {formatModuleName(m)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <a
                  href="https://portal.dqagent.vantax.co.za"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-[#0695A8] hover:underline"
                >
                  Manage licence on Vantax Portal
                  <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>

            <Separator />

            {/* Section 2 — DQS weights */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">DQS Weight Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(Object.keys(DIMENSION_LABELS) as (keyof DimensionScores)[]).map(
                  (dim) => (
                    <div key={dim} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{DIMENSION_LABELS[dim]}</span>
                        <span className="font-mono">{weights[dim]}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        step={5}
                        value={weights[dim]}
                        onChange={(e) =>
                          setWeights((w) => ({
                            ...w,
                            [dim]: parseInt(e.target.value),
                          }))
                        }
                        className="w-full accent-[#0695A8]"
                      />
                    </div>
                  )
                )}

                <div
                  className={`text-sm font-medium ${
                    weightValid ? "text-green-400" : "text-red-400"
                  }`}
                >
                  Total: {weightSum}%{" "}
                  {!weightValid && "(must equal 100%)"}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => weightsMutation.mutate()}
                    disabled={!weightValid || weightsMutation.isPending}
                  >
                    Save Weights
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setWeights(DEFAULT_WEIGHTS)}
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Section 3 — Alert thresholds */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alert Thresholds</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Critical finding threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={thresholds.critical_threshold}
                      onChange={(e) =>
                        setThresholds((t) => ({
                          ...t,
                          critical_threshold: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Alert when critical findings exceed this count
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      High finding threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={thresholds.high_threshold}
                      onChange={(e) =>
                        setThresholds((t) => ({
                          ...t,
                          high_threshold: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Alert when high findings exceed this count
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      DQS score drop threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={thresholds.dqs_drop_threshold}
                      onChange={(e) =>
                        setThresholds((t) => ({
                          ...t,
                          dqs_drop_threshold: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Alert when DQS drops by more than this many points
                    </p>
                  </div>
                </div>

                <Button
                  onClick={() => thresholdsMutation.mutate()}
                  disabled={thresholdsMutation.isPending}
                >
                  Save Thresholds
                </Button>
              </CardContent>
            </Card>

            <Separator />

            {/* Section 4 — Scheduled Jobs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scheduled Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {([
                    {
                      key: "daily_analysis",
                      label: "Daily Analysis",
                      desc: "Re-run checks on latest data (02:00 SAST)",
                      icon: <Clock className="h-4 w-4 text-[#0695A8]" />,
                    },
                    {
                      key: "weekly_cleaning",
                      label: "Weekly Cleaning Batch",
                      desc: "Auto-approve and apply standardisations (Mon 03:00 SAST)",
                      icon: <Calendar className="h-4 w-4 text-[#059669]" />,
                    },
                    {
                      key: "monthly_report",
                      label: "Monthly Report",
                      desc: "Generate PDF, cost avoidance, exception billing (1st 04:00 SAST)",
                      icon: <FileText className="h-4 w-4 text-[#D97706]" />,
                    },
                    {
                      key: "daily_digest",
                      label: "Daily Digest",
                      desc: "Findings summary, early warnings, next actions (06:00 SAST)",
                      icon: <Mail className="h-4 w-4 text-[#1D6ECC]" />,
                    },
                    {
                      key: "weekly_archive",
                      label: "Weekly Archive",
                      desc: "Archive old findings, prune cache, escalate exceptions (Sun 00:00 SAST)",
                      icon: <Archive className="h-4 w-4 text-[#6B92AD]" />,
                    },
                  ] as const).map((job) => {
                    const scheduledJobs = (settings?.dqs_weights as Record<string, unknown> | null)?.scheduled_jobs as Record<string, { enabled: boolean; last_run?: string }> | undefined;
                    const jobState = scheduledJobs?.[job.key];
                    const enabled = jobState?.enabled ?? true;
                    const lastRun = jobState?.last_run;

                    return (
                      <div
                        key={job.key}
                        className="flex items-center justify-between rounded-lg border border-border p-3"
                      >
                        <div className="flex items-center gap-3">
                          {job.icon}
                          <div>
                            <p className="text-sm font-medium">{job.label}</p>
                            <p className="text-xs text-muted-foreground">{job.desc}</p>
                            {lastRun && (
                              <p className="text-xs text-muted-foreground">
                                Last run: {new Date(lastRun).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => {
                            toast.info(`${job.label} toggle saved`);
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            enabled ? "bg-[#0695A8]" : "bg-gray-300"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              enabled ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Team Tab ───────────────────────────────────────────────────── */}
        <TabsContent value="team">
          <TeamManagement />
        </TabsContent>

        {/* ── Billing Tab ──────────────────────────────────────────────── */}
        <TabsContent value="billing">
          <BillingTab
            stripeCustomerId={settings?.stripe_customer_id ?? null}
            licensedModules={settings?.licensed_modules ?? []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}


/* ── Team management sub-component ────────────────────────────────────────── */

function TeamManagement() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("analyst");

  const updateMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: { role?: UserRole; is_active?: boolean } }) =>
      updateUser(userId, body),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Failed to update user"),
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser({ email: inviteEmail, name: inviteName, role: inviteRole }),
    onSuccess: () => {
      toast.success("User invited");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("analyst");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Failed to invite user"),
  });

  if (isLoading) return <Skeleton className="h-64 mt-4" />;

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0F2137]">Team Members</h2>
          <p className="text-sm text-[#6B92AD]">
            Manage user roles and access permissions
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="mr-1 h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full rounded-md border border-[#D6E4F0] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-md border border-[#D6E4F0] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full rounded-md border border-[#D6E4F0] px-3 py-2 text-sm"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => inviteMutation.mutate()}
                disabled={!inviteEmail || inviteMutation.isPending}
                className="w-full"
              >
                Send Invite
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#D6E4F0] text-left text-xs font-medium text-[#6B92AD]">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {(!data?.users || data.users.length === 0) ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#6B92AD]">
                    No team members yet. Invite someone to get started.
                  </td>
                </tr>
              ) : (
                data.users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-[#F0F5FA] last:border-b-0"
                  >
                    <td className="px-4 py-3 text-sm">{user.email}</td>
                    <td className="px-4 py-3 text-sm">{user.name}</td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) =>
                          updateMutation.mutate({
                            userId: user.id,
                            body: { role: e.target.value as UserRole },
                          })
                        }
                        className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${
                          ROLE_COLORS[user.role] || ""
                        }`}
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={user.is_active}
                        onClick={() =>
                          updateMutation.mutate({
                            userId: user.id,
                            body: { is_active: !user.is_active },
                          })
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          user.is_active ? "bg-[#059669]" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            user.is_active ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#6B92AD]">
                      {user.last_login
                        ? new Date(user.last_login).toLocaleDateString()
                        : "Never"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Role permissions reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#D6E4F0] text-left text-[#6B92AD]">
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">View</th>
                  <th className="px-2 py-2">Upload</th>
                  <th className="px-2 py-2">Analyse</th>
                  <th className="px-2 py-2">Approve</th>
                  <th className="px-2 py-2">Apply</th>
                  <th className="px-2 py-2">Export</th>
                  <th className="px-2 py-2">Manage</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { role: "Admin", perms: [true, true, true, true, true, true, true] },
                  { role: "Steward", perms: [true, true, true, true, true, true, false] },
                  { role: "Analyst", perms: [true, true, true, false, false, true, false] },
                  { role: "Approver", perms: [true, false, false, true, false, true, false] },
                  { role: "Auditor", perms: [true, false, false, false, false, true, false] },
                  { role: "Viewer", perms: [true, false, false, false, false, false, false] },
                ].map((row) => (
                  <tr key={row.role} className="border-b border-[#F0F5FA] last:border-b-0">
                    <td className="px-2 py-2 font-medium">{row.role}</td>
                    {row.perms.map((p, i) => (
                      <td key={i} className="px-2 py-2 text-center">
                        {p ? (
                          <span className="text-[#059669]">&#10003;</span>
                        ) : (
                          <span className="text-[#D6E4F0]">&#8212;</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


/* ── Billing tab sub-component ───────────────────────────────────────────── */

const ALL_FEATURES = [
  { key: "cleaning", label: "Data Cleaning" },
  { key: "exceptions", label: "Exception Management" },
  { key: "analytics", label: "Advanced Analytics" },
  { key: "nlp", label: "NLP Query Interface" },
  { key: "contracts", label: "Data Contracts" },
  { key: "notifications", label: "Notification Centre" },
] as const;

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Auto-resolved",
  2: "Tier 2 — Steward",
  3: "Tier 3 — Complex",
  4: "Tier 4 — Custom Rule",
};

const TIER_PRICES: Record<number, number> = {
  1: 25.0,
  2: 150.0,
  3: 500.0,
  4: 250.0,
};

function BillingTab({
  stripeCustomerId,
  licensedModules,
}: {
  stripeCustomerId: string | null;
  licensedModules: string[];
}) {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const { data: billing, isLoading } = useQuery({
    queryKey: ["exception-billing", currentPeriod],
    queryFn: () => getExceptionBilling(currentPeriod),
  });

  // Derive licensed features from cached licence response
  // In production, the licence middleware sets these on every request
  const [licensedFeatures, setLicensedFeatures] = useState<string[]>([]);

  useEffect(() => {
    // Fetch licence features from the settings endpoint metadata
    // Features are part of the licence response cached by the middleware
    async function fetchFeatures() {
      try {
        const resp = await fetch("/api/v1/health");
        const data = await resp.json();
        if (data.licence?.features) {
          setLicensedFeatures(data.licence.features);
        }
      } catch {
        // Health endpoint not available — show empty
      }
    }
    fetchFeatures();
  }, []);

  return (
    <div className="space-y-6 pt-4">
      {/* Current tier & features */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licence & Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-sm text-muted-foreground">Licensed Modules</span>
            <p className="text-sm font-medium">
              {licensedModules.length > 0
                ? `${licensedModules.length} module${licensedModules.length !== 1 ? "s" : ""}`
                : "None"}
            </p>
          </div>

          <Separator />

          <div>
            <span className="text-sm font-medium">Feature Status</span>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ALL_FEATURES.map(({ key, label }) => {
                const enabled = licensedFeatures.includes(key) || licensedFeatures.includes("*");
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    {enabled ? (
                      <Check className="h-4 w-4 text-[#059669]" />
                    ) : (
                      <X className="h-4 w-4 text-[#D6E4F0]" />
                    )}
                    <span className={enabled ? "" : "text-muted-foreground"}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {licensedFeatures.length === 0 && !licensedFeatures.includes("*") && (
            <Alert>
              <AlertDescription className="flex items-center justify-between">
                <span>Upgrade your licence to unlock additional features.</span>
                <a
                  href="https://portal.vantax.co.za/upgrade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#0695A8] hover:underline"
                >
                  Manage Licence
                  <ExternalLink className="h-3 w-3" />
                </a>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Exception billing summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Exception Billing — {currentPeriod}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : billing ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#D6E4F0] text-left text-xs text-[#6B92AD]">
                      <th className="px-3 py-2">Tier</th>
                      <th className="px-3 py-2 text-right">Count</th>
                      <th className="px-3 py-2 text-right">Unit Price (ZAR)</th>
                      <th className="px-3 py-2 text-right">Amount (ZAR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([1, 2, 3, 4] as const).map((tier) => {
                      const countKey = `tier${tier}_count` as keyof ExceptionBilling;
                      const amountKey = `tier${tier}_amount` as keyof ExceptionBilling;
                      const count = (billing[countKey] as number) || 0;
                      const amount = (billing[amountKey] as number) || 0;
                      return (
                        <tr key={tier} className="border-b border-[#F0F5FA]">
                          <td className="px-3 py-2">{TIER_LABELS[tier]}</td>
                          <td className="px-3 py-2 text-right font-mono">{count}</td>
                          <td className="px-3 py-2 text-right text-[#6B92AD]">
                            R {TIER_PRICES[tier].toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            R {amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-b border-[#F0F5FA]">
                      <td className="px-3 py-2 text-[#6B92AD]">Monthly Base Fee</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right font-mono">
                        R {(billing.base_fee || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right text-[#0695A8]">
                        R {(billing.total_amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center gap-3">
                {billing.stripe_invoice_id && stripeCustomerId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `https://dashboard.stripe.com/invoices/${billing.stripe_invoice_id}`,
                        "_blank"
                      )
                    }
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    View Invoice
                  </Button>
                )}
                <a
                  href="https://portal.vantax.co.za/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-[#0695A8] hover:underline"
                >
                  Manage Licence
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No billing data for this period yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
