"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function LicenceErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold text-foreground">
          Licence Invalid or Expired
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Your Vantax licence is invalid or has expired.</AlertTitle>
          <AlertDescription className="mt-2">
            Please contact your administrator or visit the Vantax portal to
            renew your licence.
          </AlertDescription>
        </Alert>
        <a
          href="https://portal.dqagent.vantax.co.za"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline">Go to Vantax Portal</Button>
        </a>
      </div>
    </div>
  );
}
