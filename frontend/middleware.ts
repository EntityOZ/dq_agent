import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const isLocalAuth = process.env.NEXT_PUBLIC_AUTH_MODE === "local";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/licence-error",
  "/health",
]);

// clerkMiddleware validates the publishable key on every request BEFORE calling
// the inner handler. Wrapping it here means we can return early in local auth
// mode without Clerk ever touching the key.
const withClerk = clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) {
    auth.protect();
  }
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isLocalAuth) {
    return NextResponse.next();
  }
  return withClerk(req, event);
}

// Static matcher — always required by Next.js, cannot be conditional
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
