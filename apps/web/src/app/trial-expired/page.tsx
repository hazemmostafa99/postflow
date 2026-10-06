import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  MessageCircle,
  Send,
} from "lucide-react";
import { redirect } from "next/navigation";
import { fetchPostFlowUser } from "@/lib/postflow-user";

const MARKETING_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000";
const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(
  /\D/g,
  "",
);

export default async function TrialExpiredPage() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    redirectToSignIn({ returnBackUrl: "/trial-expired" });
    throw new Error("Expected Clerk redirectToSignIn to interrupt rendering.");
  }

  const clerkUser = await currentUser().catch((error) => {
    console.error("[Auth] Unable to load the current Clerk user", error);
    return null;
  });
  const postflowUser = await fetchPostFlowUser({
    clerkUserId: userId,
    email:
      clerkUser?.primaryEmailAddress?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress,
    firstName: clerkUser?.firstName ?? undefined,
    lastName: clerkUser?.lastName ?? undefined,
  });

  if (!postflowUser) redirect("/access-denied");
  if (
    postflowUser.accountType !== "INDIVIDUAL_SALES" ||
    postflowUser.subscription?.isAccessAllowed
  ) {
    redirect("/dashboard");
  }
  if (!postflowUser.subscription) redirect("/access-denied");

  const isRevoked = postflowUser.subscription.status === "REVOKED";
  const expirationDate = new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(postflowUser.subscription.accessUntil));
  const whatsappMessage = encodeURIComponent(
    "Hello PostFlow, I would like to discuss access for my sales account.",
  );
  const contactHref = WHATSAPP_NUMBER
    ? `https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage}`
    : MARKETING_URL;

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <div className="flex items-center justify-between">
          <Link
            href={MARKETING_URL}
            className="inline-flex items-center gap-2 font-semibold"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Send className="h-4 w-4" aria-hidden="true" />
            </span>
            PostFlow
          </Link>
          <Link
            href={MARKETING_URL}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to website
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <section className="grid w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-[0.85fr_1.15fr]">
            <div className="bg-sidebar p-8 text-sidebar-foreground sm:p-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent px-3 py-1 text-xs font-semibold">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                30-day free trial
              </span>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                {isRevoked
                  ? "Your sales access is unavailable"
                  : "Your free trial has ended"}
              </h1>
              <p className="mt-4 max-w-md leading-7 text-sidebar-foreground/70">
                Your PostFlow account and existing data are still safe. Contact
                us to discuss continued access for your sales workspace.
              </p>
              <div className="mt-8 space-y-3 text-sm text-sidebar-foreground/75">
                {[
                  "Your account remains available",
                  "Your existing posts are not deleted",
                  "No payment or card is required here",
                ].map((item) => (
                  <p key={item} className="flex items-center gap-2">
                    <CheckCircle2
                      className="h-4 w-4 text-sidebar-primary"
                      aria-hidden="true"
                    />
                    {item}
                  </p>
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-center p-8 sm:p-10 lg:p-12">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Account access
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Talk to the PostFlow team
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                {isRevoked
                  ? "Access for this account was stopped. Message us on WhatsApp and we will help you understand the next step."
                  : `Your trial access ended on ${expirationDate}. Message us on WhatsApp and we will help with the next step.`}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={contactHref}
                  target={WHATSAPP_NUMBER ? "_blank" : undefined}
                  rel={WHATSAPP_NUMBER ? "noreferrer" : undefined}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Contact us on WhatsApp
                </a>
                <SignOutButton>
                  <button className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-5 text-sm font-semibold transition-colors hover:bg-accent">
                    Sign out
                  </button>
                </SignOutButton>
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                There is no automatic charge and no payment method is stored.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
