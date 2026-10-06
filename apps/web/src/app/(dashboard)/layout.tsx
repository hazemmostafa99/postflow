import { auth, currentUser } from "@clerk/nextjs/server";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopbar } from "@/components/dashboard-topbar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { redirect } from "next/navigation";
import { fetchPostFlowUser } from "@/lib/postflow-user";
import { TrialStatusBanner } from "@/components/trial-status-banner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    redirectToSignIn({ returnBackUrl: "/dashboard" });
    throw new Error("Expected Clerk redirectToSignIn to interrupt rendering.");
  }
  const clerkUserId = userId;
  // The session ID is the source of truth for authentication. A temporary
  // failure while loading the profile must not destroy an otherwise valid session.
  const user = await currentUser().catch((error) => {
    console.error("[Auth] Unable to load the current Clerk user", error);
    return null;
  });
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress;
  const firstName = user?.firstName ?? undefined;
  const lastName = user?.lastName ?? undefined;

  const postflowUser = await fetchPostFlowUser({
    clerkUserId,
    email,
    firstName,
    lastName,
  });
  if (!postflowUser) redirect("/access-denied");
  if (
    postflowUser.accountType === "INDIVIDUAL_SALES" &&
    !postflowUser.subscription
  ) {
    redirect("/access-denied");
  }
  if (postflowUser.subscription && !postflowUser.subscription.isAccessAllowed) {
    redirect("/trial-expired");
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar role={postflowUser.role} />
        <main className="flex-1 flex flex-col min-h-screen">
          <header className="sticky top-0 z-30 flex min-h-16 items-start gap-3 border-b border-border/80 bg-background/85 px-4 py-3 backdrop-blur sm:px-5 xl:items-center">
            <SidebarTrigger />
            <DashboardTopbar role={postflowUser.role} />
          </header>
          <div className="flex-1 p-4 sm:p-6 lg:p-8">
            <TrialStatusBanner subscription={postflowUser.subscription} />
            {children}
          </div>
        </main>
      </div>
      {/* Hidden meta element for the PostFlow extension to read the user ID */}
      {clerkUserId && (
        <span
          id="postflow-user-meta"
          data-postflow-user-id={clerkUserId}
          style={{ display: "none" }}
          aria-hidden="true"
        />
      )}
    </SidebarProvider>
  );
}
