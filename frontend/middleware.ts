import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isLocalAuth = process.env.NEXT_PUBLIC_AUTH_MODE === "local";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/licence-error",
  "/health",
]);

export default clerkMiddleware((auth, req) => {
  // Skip auth entirely in local dev mode
  if (isLocalAuth) {
    return NextResponse.next();
  }
  if (!isPublicRoute(req)) {
    auth.protect();
  }
});

// Static matcher — always required by Next.js, cannot be conditional
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
