import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail, Send } from "lucide-react";

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="p-10">
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-sidebar-foreground/65 transition-colors hover:text-sidebar-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
          </div>

          <div className="max-w-xl p-10">
            <div className="mb-8 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                <Send className="h-5 w-5" />
              </span>
              <span className="text-xl font-semibold">PostFlow</span>
            </div>
            <p className="text-sm font-semibold uppercase tracking-normal text-sidebar-primary">Start publishing</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              Run your Facebook group posting from one calm workspace.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-sidebar-foreground/65">
              Sync groups from the extension, create posts with media, and follow publishing status without jumping between tools.
            </p>
            <div className="mt-10 space-y-3 text-sm text-sidebar-foreground/75">
              {["Create and manage posts", "Publish to multiple groups", "Track publishing status", "Keep group sync in one flow"].map((item) => (
                <p key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-sidebar-primary" />
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div className="p-10 text-sm text-sidebar-foreground/45">
            Copyright {new Date().getFullYear()} PostFlow
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center lg:text-left">
              <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Send className="h-5 w-5" />
                </span>
                <span className="text-xl font-semibold">PostFlow</span>
              </div>
              <h2 className="text-3xl font-semibold tracking-tight">Invitation required</h2>
              <p className="mt-2 text-muted-foreground">PostFlow is a private workspace. Ask an administrator to invite you.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <Mail className="h-8 w-8 text-primary" />
              <h3 className="mt-4 font-semibold">Have an invitation?</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Follow the secure link in your invitation email to finish setting up your Clerk account.</p>
              <Link href="/sign-in" className="mt-6 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Go to sign in</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
