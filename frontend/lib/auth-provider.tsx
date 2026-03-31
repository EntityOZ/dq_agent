"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { LocalAuthProvider } from "@/context/auth-context";

const authMode = process.env.NEXT_PUBLIC_AUTH_MODE;
const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (authMode === "local" || !publishableKey) {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }
  return <ClerkProvider>{children}</ClerkProvider>;
}
