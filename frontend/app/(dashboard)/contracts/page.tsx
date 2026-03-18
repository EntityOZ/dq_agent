"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Plus,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  getContracts,
  createContract,
  getContractCompliance,
} from "@/lib/api/contracts";
import type { Contract, ComplianceRecord } from "@/types/api";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const STATUS_COLOURS: Record<string, string> = {
  draft: "bg-[#F0F5FA] text-[#6B92AD] border border-[#D6E4F0]",
  pending_approval: "bg-[#FEF3C7] text-[#D97706] border border-[#FCD34D]",
  active: "bg-[#D1FAE5] text-[#059669] border border-[#6EE7B7]",
  expired: "bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5]",
};

const DIMENSIONS = [
  "completeness",
  "accuracy",
  "consistency",
  "timeliness",
  "uniqueness",
  "validity",
] as const;

/* ── Contract List ── */

function ContractTable({
  contracts,
  onSelect,
}: {
  contracts: Contract[];
  onSelect: (c: Contract) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#D6E4F0] text-left text-[#6B92AD]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Producer → Consumer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Compliance</th>
                <th className="px-4 py-3">Last Checked</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b border-[#D6E4F0]/50 hover:bg-[#F5F9FF]"
                  onClick={() => onSelect(c)}
                >
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-[#0F2137]">{c.producer}</span>
                    <ArrowRight className="mx-1 inline h-3 w-3 text-[#6B92AD]" />
                    <span className="text-[#0F2137]">{c.consumer}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_COLOURS[c.status] ?? ""}>
                      {c.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {c.latest_compliant === true && (
                      <CheckCircle2 className="h-5 w-5 text-[#059669]" />
                    )}
                    {c.latest_compliant === false && (
                      <XCircle className="h-5 w-5 text-[#DC2626]" />
                    )}
                    {c.latest_compliant == null && (
                      <span className="text-xs text-[#6B92AD]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6B92AD]">
                    {c.last_checked
                      ? new Date(c.last_checked).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm">
                      Detail
                    </Button>
                  </td>
                </tr>
              ))}
              {contracts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-[#6B92AD]"
                  >
                    No contracts yet. Create your first data contract.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Contract Detail Panel ── */

function ContractDetail({
  contract,
  onClose,
}: {
  contract: Contract;
  onClose: () => void;
}) {
  const { data: complianceData, isLoading } = useQuery({
    queryKey: ["contract-compliance", contract.id],
    queryFn: () => getContractCompliance(contract.id),
  });

  const history = complianceData?.compliance_history ?? [];
  const qualityThresholds = contract.quality_contract ?? {};

  // Build chart data from compliance history (oldest first)
  const chartData = [...history].reverse().map((h) => ({
    date: new Date(h.recorded_at).toLocaleDateString(),
    completeness: h.completeness_actual,
    accuracy: h.accuracy_actual,
    consistency: h.consistency_actual,
    timeliness: h.timeliness_actual,
    uniqueness: h.uniqueness_actual,
    validity: h.validity_actual,
    compliant: h.overall_compliant,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#0F2137]">{contract.name}</h2>
          <p className="text-sm text-[#6B92AD]">
            {contract.producer} → {contract.consumer}
          </p>
        </div>
        <Badge className={STATUS_COLOURS[contract.status] ?? ""}>
          {contract.status.replace("_", " ")}
        </Badge>
      </div>

      {contract.description && (
        <p className="text-sm text-[#4A6B84]">{contract.description}</p>
      )}

      {/* Quality thresholds vs actuals */}
      {Object.keys(qualityThresholds).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quality Thresholds vs Actuals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {DIMENSIONS.map((dim) => {
                const threshold = qualityThresholds[dim];
                if (threshold == null) return null;
                const latest = history[0];
                const actual =
                  latest?.[`${dim}_actual` as keyof ComplianceRecord] as
                    | number
                    | null;
                const passing =
                  actual != null ? actual >= threshold : null;
                return (
                  <div
                    key={dim}
                    className={`rounded-lg border p-3 ${
                      passing === true
                        ? "border-[#6EE7B7] bg-[#D1FAE5]/30"
                        : passing === false
                          ? "border-[#FCA5A5] bg-[#FEE2E2]/30"
                          : "border-[#D6E4F0] bg-[#F0F5FA]"
                    }`}
                  >
                    <p className="text-xs font-medium capitalize text-[#6B92AD]">
                      {dim}
                    </p>
                    <p className="text-xl font-bold text-[#0F2137]">
                      {actual != null ? `${Number(actual).toFixed(1)}%` : "—"}
                    </p>
                    <p className="text-xs text-[#6B92AD]">
                      Threshold: {threshold}%
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compliance history chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Compliance History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="completeness"
                  stroke="#0695A8"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#1D6ECC"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="consistency"
                  stroke="#0F2137"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                {qualityThresholds.completeness && (
                  <ReferenceLine
                    y={qualityThresholds.completeness}
                    stroke="#DC2626"
                    strokeDasharray="3 3"
                    label={{ value: "SLA", fontSize: 9 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-[#6B92AD]">
              No compliance data yet. Run an analysis to generate compliance
              checks.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Golden Record Violations */}
      {(() => {
        const goldenViolations = history.filter(
          (h: ComplianceRecord) =>
            (h.violations as Record<string, unknown>)?.type === "golden_record_field"
        );

        return goldenViolations.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Golden Record Violations</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Object Key</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {goldenViolations.map((v: ComplianceRecord) => {
                    const viol = v.violations as {
                      type: string;
                      object_key: string;
                      field_violations: { field: string; reason: string }[];
                    };
                    return viol.field_violations?.map(
                      (fv: { field: string; reason: string }, i: number) => (
                        <TableRow key={`${v.id}-${i}`}>
                          <TableCell>
                            <Link
                              href={`/golden-records?key=${viol.object_key}`}
                              className="underline text-[#0695A8]"
                            >
                              {viol.object_key}
                            </Link>
                          </TableCell>
                          <TableCell>{fv.field}</TableCell>
                          <TableCell>{fv.reason}</TableCell>
                          <TableCell>
                            {new Date(v.recorded_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      )
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-[#6B92AD]">
            No golden record violations.
          </p>
        );
      })()}

      {/* Schema contract */}
      {contract.schema_contract && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Schema Contract</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-[#F0F5FA] p-3 text-xs text-[#0F2137]">
              {JSON.stringify(contract.schema_contract, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Button variant="outline" onClick={onClose}>
        ← Back to list
      </Button>
    </div>
  );
}

/* ── New Contract Wizard ── */

function NewContractWizard({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    description: "",
    producer: "",
    consumer: "",
    quality_contract: {} as Record<string, number>,
    schema_contract: null as Record<string, unknown> | null,
    freshness_contract: null as Record<string, unknown> | null,
    volume_contract: null as Record<string, unknown> | null,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createContract({
        name: form.name,
        description: form.description || undefined,
        producer: form.producer,
        consumer: form.consumer,
        quality_contract:
          Object.keys(form.quality_contract).length > 0
            ? form.quality_contract
            : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      onClose();
    },
  });

  const updateQuality = (dim: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0 && num <= 100) {
      setForm((f) => ({
        ...f,
        quality_contract: { ...f.quality_contract, [dim]: num },
      }));
    } else if (value === "") {
      setForm((f) => {
        const qc = { ...f.quality_contract };
        delete qc[dim];
        return { ...f, quality_contract: qc };
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              s === step
                ? "bg-[#0695A8] text-white"
                : s < step
                  ? "bg-[#D1FAE5] text-[#059669]"
                  : "bg-[#F0F5FA] text-[#6B92AD]"
            }`}
          >
            {s}
          </div>
        ))}
        <span className="ml-2 text-sm text-[#6B92AD]">
          {step === 1 && "Basic info"}
          {step === 2 && "Quality thresholds"}
          {step === 3 && "Review & save"}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#6B92AD]">
              Contract Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-[#D6E4F0] px-3 py-2 text-sm outline-none focus:border-[#0695A8]"
              placeholder="e.g. Business Partner SLA"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#6B92AD]">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              className="w-full rounded-lg border border-[#D6E4F0] px-3 py-2 text-sm outline-none focus:border-[#0695A8]"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#6B92AD]">
                Producer *
              </label>
              <input
                type="text"
                value={form.producer}
                onChange={(e) =>
                  setForm((f) => ({ ...f, producer: e.target.value }))
                }
                className="w-full rounded-lg border border-[#D6E4F0] px-3 py-2 text-sm outline-none focus:border-[#0695A8]"
                placeholder="e.g. SAP ECC"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#6B92AD]">
                Consumer *
              </label>
              <input
                type="text"
                value={form.consumer}
                onChange={(e) =>
                  setForm((f) => ({ ...f, consumer: e.target.value }))
                }
                className="w-full rounded-lg border border-[#D6E4F0] px-3 py-2 text-sm outline-none focus:border-[#0695A8]"
                placeholder="e.g. S/4HANA Migration"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => setStep(2)}
              disabled={!form.name || !form.producer || !form.consumer}
              className="bg-[#0695A8] hover:bg-[#057A8A]"
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-[#6B92AD]">
            Set minimum DQS thresholds per dimension. Leave blank to skip a
            dimension.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {DIMENSIONS.map((dim) => (
              <div key={dim}>
                <label className="mb-1 block text-xs font-medium capitalize text-[#6B92AD]">
                  {dim} (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.quality_contract[dim] ?? ""}
                  onChange={(e) => updateQuality(dim, e.target.value)}
                  className="w-full rounded-lg border border-[#D6E4F0] px-3 py-2 text-sm outline-none focus:border-[#0695A8]"
                  placeholder="e.g. 95"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              className="bg-[#0695A8] hover:bg-[#057A8A]"
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4 space-y-2">
              <p>
                <span className="text-xs text-[#6B92AD]">Name:</span>{" "}
                <span className="font-medium">{form.name}</span>
              </p>
              <p>
                <span className="text-xs text-[#6B92AD]">Flow:</span>{" "}
                {form.producer} → {form.consumer}
              </p>
              {form.description && (
                <p>
                  <span className="text-xs text-[#6B92AD]">Description:</span>{" "}
                  {form.description}
                </p>
              )}
              {Object.keys(form.quality_contract).length > 0 && (
                <div>
                  <span className="text-xs text-[#6B92AD]">
                    Quality thresholds:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {Object.entries(form.quality_contract).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="capitalize">
                        {k}: {v}%
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="bg-[#0695A8] hover:bg-[#057A8A]"
            >
              {mutation.isPending ? "Saving..." : "Create Contract"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */

export default function ContractsPage() {
  const [selected, setSelected] = useState<Contract | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => getContracts(),
  });

  const contracts = data?.contracts ?? [];

  if (showWizard) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">New Contract</h1>
          <Button variant="outline" onClick={() => setShowWizard(false)}>
            Cancel
          </Button>
        </div>
        <NewContractWizard onClose={() => setShowWizard(false)} />
      </div>
    );
  }

  if (selected) {
    return (
      <ContractDetail
        contract={selected}
        onClose={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Data Contracts</h1>
        <Button
          onClick={() => setShowWizard(true)}
          className="bg-[#0695A8] hover:bg-[#057A8A]"
        >
          <Plus className="mr-1 h-4 w-4" /> New Contract
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <ContractTable contracts={contracts} onSelect={setSelected} />
      )}
    </div>
  );
}
