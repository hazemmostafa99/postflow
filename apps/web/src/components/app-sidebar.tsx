import * as React from "react"
import { Send, LayoutDashboard, FileText } from "lucide-react"

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
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Posts", url: "/posts", icon: FileText },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="sidebar" {...props}>
      <SidebarHeader className="flex h-16 justify-center border-b border-sidebar-border px-4">
        <div className="flex items-center gap-2 text-xl font-bold tracking-tight text-sidebar-foreground">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Send className="h-5 w-5" />
          </span>
          <span>PostFlow</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="mt-4 gap-1 px-2">
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton render={<Link href={item.url} />}>
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
          <span className="text-xs text-sidebar-foreground/60">Manage profile</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
