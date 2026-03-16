"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  getSettings,
  updateDqsWeights,
  updateAlertThresholds,
} from "@/lib/api/settings";
import { formatModuleName } from "@/lib/format";
import type { DimensionScores } from "@/types/api";

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
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

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
    </div>
  );
}
