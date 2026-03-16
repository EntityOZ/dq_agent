import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default async function middleware(request: NextRequest) {
  // If Clerk is not configured (local dev mode), allow all requests
  if (!publishableKey) {
    return NextResponse.next();
  }

  // When Clerk is configured, use Clerk middleware
  const { clerkMiddleware, createRouteMatcher } = await import(
    "@clerk/nextjs/server"
  );

  const isPublicRoute = createRouteMatcher([
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/licence-error",
    "/health",
  ]);

  // @ts-expect-error Dynamic import typing
  return clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  })(request);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
