import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Send } from "lucide-react";

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
              <h2 className="text-3xl font-semibold tracking-tight">Create your account</h2>
              <p className="mt-2 text-muted-foreground">Get started with PostFlow in a few seconds.</p>
            </div>

            <SignUp
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
