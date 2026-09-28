"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";

export default function SignOutPage() {
  const { signOut } = useClerk();

  useEffect(() => {
    void signOut({ redirectUrl: "/sign-up" });
  }, [signOut]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Resetting your session</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We are clearing an expired sign-in and sending you back to create your account.
        </p>
      </div>
    </main>
  );
}
