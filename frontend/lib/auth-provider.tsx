"use client";

import { ClerkProvider } from "@clerk/nextjs";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // If no Clerk key is configured, skip Clerk (local dev mode)
  if (!publishableKey) {
    return <>{children}</>;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
