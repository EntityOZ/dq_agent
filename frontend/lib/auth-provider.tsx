"use client";

import { ClerkProvider } from "@clerk/nextjs";

const authMode = process.env.NEXT_PUBLIC_AUTH_MODE;
const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // If AUTH_MODE is local or no Clerk key is configured, skip Clerk
  if (authMode === "local" || !publishableKey) {
    return <>{children}</>;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
