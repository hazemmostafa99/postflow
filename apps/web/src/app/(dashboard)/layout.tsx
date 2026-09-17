import { auth, currentUser } from "@clerk/nextjs/server";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopbar } from "@/components/dashboard-topbar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { redirect } from "next/navigation";

const API_BASE = process.env.API_URL || "http://localhost:8000";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;

  const accessResponse = await fetch(`${API_BASE}/api/auth/me`, {
    headers: {
      "x-clerk-user-id": userId,
      ...(email ? { "x-clerk-user-email": email } : {}),
    },
    cache: "no-store",
  });
  if (!accessResponse.ok) redirect("/access-denied");
  const postflowUser = await accessResponse.json();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar role={postflowUser.role} />
        <main className="flex-1 flex flex-col min-h-screen">
          <header className="sticky top-0 z-30 flex min-h-16 items-center gap-4 border-b border-border/80 bg-background/85 px-5 py-3 backdrop-blur">
            <SidebarTrigger />
            <DashboardTopbar role={postflowUser.role} />
          </header>
          <div className="flex-1 p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
      {/* Hidden meta element for the PostFlow extension to read the user ID */}
      {userId && (
        <span
          id="postflow-user-meta"
          data-postflow-user-id={userId}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      )}
    </SidebarProvider>
  );
}
