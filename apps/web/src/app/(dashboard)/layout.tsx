import { auth } from "@clerk/nextjs/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-h-screen">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/80 bg-background/85 px-5 backdrop-blur">
            <SidebarTrigger />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-medium text-foreground">Publishing workspace</p>
              <p className="text-xs text-muted-foreground">Manage Facebook group publishing from one place</p>
            </div>
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
