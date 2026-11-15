"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { BarChart3, ChevronsUpDown, Inbox, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Initial } from "./initial";
import { useShell } from "./shell-context";

const ITEM = "h-10 gap-3 rounded-lg px-2.5 text-[15px] [&_svg]:size-[18px]";

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export function UserMenu() {
  const { user, unread, openSettings } = useShell();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- patrón estándar de next-themes
  useEffect(() => setMounted(true), []);
  const localPart = user.email.split("@")[0];

  const resolved = resolvedTheme === "dark" ? "Oscuro" : "Claro";
  const themeLabel = !mounted
    ? "Sistema"
    : theme === "system"
      ? `Sistema (${resolved})`
      : theme === "dark"
        ? "Oscuro"
        : "Claro";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-12 gap-2.5 rounded-lg px-2 hover:bg-surface-2 data-[state=open]:bg-surface-2"
            >
              <Initial email={user.email} className="size-8 text-[13px]" />
              <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="text-fg truncate text-[14px]">{localPart}</span>
                <span className="text-muted-fg truncate text-[12px]">Cuenta personal</span>
              </span>
              <ChevronsUpDown className="text-muted-fg size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-80 rounded-xl p-1.5">
            <div className="flex items-center gap-3 px-2.5 py-2">
              <Initial email={user.email} className="size-10 text-base" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">{localPart}</p>
                <p className="text-muted-fg truncate text-[13px]">{user.email}</p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={ITEM} onSelect={() => openSettings()}>
              <Settings />
              Todos los ajustes
              <DropdownMenuShortcut>Ctrl ,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={ITEM}>
              <Link href="/usage">
                <BarChart3 />
                Uso y actividad
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={ITEM}>
              <Link href="/inbox">
                <Inbox />
                Bandeja
                {unread > 0 ? (
                  <span className="bg-brand text-brand-fg ml-auto rounded-full px-1.5 text-[11px] tabular-nums">
                    {unread}
                  </span>
                ) : null}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={ITEM}>
                <Moon />
                <span className="flex flex-col leading-tight">
                  Apariencia
                  <span className="text-muted-fg text-[12px]">{themeLabel}</span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup value={mounted ? (theme ?? "system") : "system"} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="size-4" /> Claro
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="size-4" /> Oscuro
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Monitor className="size-4" /> Sistema
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={ITEM} onSelect={logout}>
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
