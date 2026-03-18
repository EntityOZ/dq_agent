"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { Upload, FileUp, CheckCircle, AlertTriangle, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { uploadFile } from "@/lib/api/upload";
import { pollVersionStatus } from "@/lib/api/reports";
import { getVersion } from "@/lib/api/versions";
import { scoreColor, formatModuleName } from "@/lib/format";
import type { Version } from "@/types/api";

const MODULES = [
  // ECC Financial
  { value: "business_partner", label: "Business Partner" },
  { value: "material_master", label: "Material Master" },
  { value: "fi_gl", label: "GL Accounts" },
  { value: "accounts_payable", label: "Accounts Payable" },
  { value: "accounts_receivable", label: "Accounts Receivable" },
  { value: "asset_accounting", label: "Asset Accounting" },
  { value: "mm_purchasing", label: "MM Purchasing" },
  // SuccessFactors
  { value: "employee_central", label: "Employee Central" },
  { value: "benefits", label: "Benefits" },
  { value: "compensation", label: "Compensation" },
  { value: "learning_management", label: "Learning Management" },
  { value: "payroll_integration", label: "Payroll Integration" },
  { value: "performance_goals", label: "Performance & Goals" },
  { value: "recruiting_onboarding", label: "Recruiting & Onboarding" },
  { value: "succession_planning", label: "Succession Planning" },
  { value: "time_attendance", label: "Time & Attendance" },
  // Warehouse / Fleet / Integration
  { value: "ewms_stock", label: "eWMS Stock" },
  { value: "ewms_transfer_orders", label: "eWMS Transfer Orders" },
  { value: "batch_management", label: "Batch Management" },
  { value: "fleet_management", label: "Fleet Management" },
  { value: "plant_maintenance", label: "Plant Maintenance" },
  { value: "production_planning", label: "Production Planning" },
  { value: "sd_customer_master", label: "SD Customer Master" },
  { value: "sd_sales_orders", label: "SD Sales Orders" },
  { value: "transport_management", label: "Transport Management" },
  { value: "wm_interface", label: "WM Interface" },
  { value: "cross_system_integration", label: "Cross-System Integration" },
  { value: "grc_compliance", label: "GRC Compliance" },
  { value: "mdg_master_data", label: "MDG Master Data" },
];

const ACCEPTED = ".csv,.xlsx,.xls";
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

type Step = "select" | "uploading" | "analysing" | "complete" | "error";

export default function UploadPage() {
  const [step, setStep] = useState<Step>("select");
  const [file, setFile] = useState<File | null>(null);
  const [module, setModule] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [version, setVersion] = useState<Version | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const reset = () => {
    setStep("select");
    setFile(null);
    setModule("");
    setProgress(0);
    setStatus("");
    setElapsed(0);
    setVersion(null);
    setErrorMsg("");
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.size <= MAX_SIZE) setFile(f);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.size <= MAX_SIZE) setFile(f);
  };

  const startAnalysis = async () => {
    if (!file || !module) return;
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // Step 2: Uploading
      setStep("uploading");
      const { version_id } = await uploadFile(file, module, setProgress, ac.signal);

      // Step 3: Analysing
      setStep("analysing");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);

      const finalStatus = await pollVersionStatus(version_id, setStatus);
      clearInterval(timerRef.current);

      if (finalStatus === "agents_complete") {
        const v = await getVersion(version_id);
        setVersion(v);
        setStep("complete");
      } else {
        setErrorMsg(`Analysis ended with status: ${finalStatus}`);
        setStep("error");
      }
    } catch (err: unknown) {
      clearInterval(timerRef.current);
      if (err instanceof Error && err.name === "CanceledError") {
        reset();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setStep("error");
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const statusLabel: Record<string, string> = {
    pending: "Queued for analysis...",
    running: "Running 254 checks against your data...",
    complete: "Checks complete. Generating AI insights...",
    agents_enqueued: "Checks complete. Generating AI insights...",
    agents_running: "Generating AI insights...",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Upload SAP Data</h1>

      {/* Step 1: File Selection */}
      {step === "select" && (
        <Card>
          <CardContent className="space-y-6 py-8">
            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-12 transition-colors hover:border-[#0695A8]"
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag and drop your file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Accepts .csv, .xlsx, .xls — Maximum 100 MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                onChange={onFileChange}
                className="hidden"
              />
            </div>

            {/* Selected file */}
            {file && (
              <div className="flex items-center justify-between rounded-md bg-accent p-3">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  <span className="text-sm">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(file.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </div>
                <TooltipProvider delay={0}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFile(null)}
                        />
                      }
                    >
                      <X className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>Remove file</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {/* Module selector */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                SAP Module
              </label>
              <select
                value={module}
                onChange={(e) => setModule(e.target.value)}
                className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
              >
                <option value="">Select module...</option>
                {MODULES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={startAnalysis}
              disabled={!file || !module}
              className="w-full"
            >
              Start Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Uploading */}
      {step === "uploading" && (
        <Card>
          <CardContent className="space-y-4 py-8">
            <div className="text-center">
              <p className="text-sm font-medium">Uploading {file?.name}...</p>
              <p className="text-xs text-muted-foreground">
                {(file?.size ?? 0) / 1024 / 1024 > 0
                  ? `${((file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB`
                  : ""}
              </p>
            </div>
            <Progress value={progress} className="h-3" />
            <p className="text-center text-sm text-muted-foreground">
              {progress}%
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                abortRef.current?.abort();
                reset();
              }}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Analysing */}
      {step === "analysing" && (
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <div
              className="mx-auto h-12 w-12 rounded-full bg-[#0695A8]/20"
              style={{ animation: "pulse-soft 2s ease-in-out infinite" }}
            />
            <p className="text-sm font-medium">
              {statusLabel[status] ?? `Status: ${status}`}
            </p>
            <p className="text-xs text-muted-foreground">
              Elapsed: {elapsed}s
            </p>
            <p className="text-xs text-muted-foreground">
              Analysis is running in the background. You can navigate away — it
              will continue.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Complete */}
      {step === "complete" && version && (
        <Card>
          <CardContent className="space-y-6 py-8 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h2 className="text-xl font-bold">Analysis Complete</h2>

            {version.dqs_summary && (
              <>
                {Object.entries(version.dqs_summary).map(([mod, s]) => (
                  <div key={mod} className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {formatModuleName(mod)} DQS
                    </p>
                    <p
                      className="text-3xl font-bold"
                      style={{ color: scoreColor(s.composite_score) }}
                    >
                      {s.composite_score}
                    </p>
                    <div className="flex justify-center gap-2">
                      <Badge variant="destructive">
                        Critical {s.critical_count}
                      </Badge>
                      <Badge className="bg-orange-500">High {s.high_count}</Badge>
                      <Badge className="bg-yellow-500 text-black">
                        Medium {s.medium_count}
                      </Badge>
                      <Badge className="bg-green-600">Low {s.low_count}</Badge>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="flex justify-center gap-3">
              <Link href={`/findings?version_id=${version.id}`}>
                <Button>View Findings</Button>
              </Link>
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/reports/${version.id}/download`}
                download
              >
                <Button variant="outline">Download Report</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {step === "error" && (
        <Card>
          <CardContent className="space-y-4 py-8">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
            <Button onClick={reset} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
