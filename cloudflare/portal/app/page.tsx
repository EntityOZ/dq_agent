import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";

export default async function HomePage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Meridian HQ</h1>
        <p className="mt-2 text-[var(--muted)]">
          Sign in to manage your Meridian licence
        </p>
      </div>
      <SignIn routing="hash" />
    </div>
  );
}
