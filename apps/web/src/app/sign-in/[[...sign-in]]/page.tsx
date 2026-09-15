import { SignIn } from "@clerk/nextjs";
import { Send } from "lucide-react";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="p-10">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                <Send className="h-5 w-5" />
              </span>
              <span className="text-xl font-semibold">PostFlow</span>
            </div>
          </div>

          <div className="max-w-xl p-10">
            <p className="text-sm font-semibold uppercase tracking-normal text-sidebar-primary">Publishing workspace</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              Publish to your Facebook Groups from one focused dashboard.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-sidebar-foreground/65">
              Create posts, pick target groups, and let the extension handle publishing while you track every job.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-4 text-sm">
              <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/70 p-4">
                <div className="font-semibold">Create</div>
                <p className="mt-1 text-sidebar-foreground/55">Write posts</p>
              </div>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/70 p-4">
                <div className="font-semibold">Target</div>
                <p className="mt-1 text-sidebar-foreground/55">Select groups</p>
              </div>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/70 p-4">
                <div className="font-semibold">Track</div>
                <p className="mt-1 text-sidebar-foreground/55">Watch status</p>
              </div>
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
              <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
              <p className="mt-2 text-muted-foreground">Sign in to manage your posts and Facebook groups.</p>
            </div>

            <SignIn
              appearance={{
                elements: {
                  rootBox: "w-full",
                  card: "w-full bg-card shadow-sm border border-border rounded-xl p-6",
                  headerTitle: "hidden",
                  headerSubtitle: "hidden",
                  socialButtonsBlockButton: "border border-border bg-background text-foreground hover:bg-accent",
                  socialButtonsBlockButtonText: "font-medium",
                  dividerLine: "bg-border",
                  dividerText: "text-muted-foreground",
                  formFieldLabel: "text-foreground",
                  formFieldInput: "bg-background border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-0",
                  formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-none",
                  footerActionText: "text-muted-foreground",
                  footerActionLink: "text-primary hover:text-primary/80 font-medium",
                  identityPreviewText: "text-foreground",
                  identityPreviewEditButton: "text-muted-foreground",
                  formFieldAction: "text-primary hover:text-primary/80",
                },
              }}
              fallbackRedirectUrl="/"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
