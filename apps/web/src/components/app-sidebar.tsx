import * as React from "react"
import { Send, LayoutDashboard, FileText, Users, UserCog, Link2, Phone, BarChart3, UsersRound } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar"
import { UserButton } from "@clerk/nextjs"
import Link from "next/link"

const items = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Posts", url: "/posts", icon: FileText },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Leads", url: "/leads", icon: Phone },
  { title: "Connections", url: "/connections", icon: Link2 },
  { title: "Groups", url: "/groups", icon: UsersRound },
  { title: "Users", url: "/users", icon: UserCog },
  { title: "Teams", url: "/teams", icon: Users },
]

const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"

export function AppSidebar({ role, ...props }: React.ComponentProps<typeof Sidebar> & { role?: string }) {
  const visibleItems = items.filter((item) => {
    if (item.title === "Users") return role === "ADMIN" || role === "MANAGER";
    if (item.title === "Teams") return role !== "SALES";
    return true;
  });

  return (
    <Sidebar variant="sidebar" {...props}>
      <SidebarHeader className="flex h-16 justify-center border-b border-sidebar-border px-4">
        <Link href={MARKETING_URL} className="flex items-center gap-2 text-xl font-bold tracking-tight text-sidebar-foreground" aria-label="iPostFlow website">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Send className="h-5 w-5" />
          </span>
          <span>iPostFlow</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="mt-4 gap-1 px-2">
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton render={<Link href={item.url} prefetch={false} />}>
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="flex h-[76px] flex-row items-center gap-3 border-t border-sidebar-border p-4">
        <UserButton 
          appearance={{
            elements: {
              userButtonAvatarBox: "w-9 h-9"
            }
          }}
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-sidebar-foreground">My Account</span>
          <span className="text-xs text-sidebar-foreground/60">{role ? formatRole(role) : "Manage profile"}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function formatRole(role: string) {
  return role.replace("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}
