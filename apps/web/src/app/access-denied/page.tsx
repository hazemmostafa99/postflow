import Link from "next/link";
import { ShieldX } from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <ShieldX className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="mt-5 text-2xl font-semibold">Access not provisioned</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your Clerk account is valid, but you do not have an active PostFlow invitation. Contact an administrator.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <SignOutButton>
            <button className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Sign out
            </button>
          </SignOutButton>
          <Link href="/" className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
