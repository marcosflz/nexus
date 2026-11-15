"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessagesSquare,
  BarChart3,
  Bell,
  Bot,
  ChevronDown,
  Cpu,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Search,
  Trash2,
  Users,
  Loader2,
} from "lucide-react";
import { NewRoomDialog } from "@/components/bots/bots-page";
import { NexusLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProjectSummary, ThreadSummary } from "@/components/chat/types";
import { isAdminRole } from "@/lib/access";
import { splitThreads } from "@/lib/threads/sections";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import { ThreadMenuItems } from "./thread-menu";
import { UserMenu } from "./user-menu";

const ROW =
  "h-9 gap-3 rounded-lg px-2.5 text-[14px] text-fg/90 hover:bg-surface-2 data-[active=true]:bg-surface-3 data-[active=true]:font-normal [&_svg]:size-[18px]";
const NAV_ROW = `${ROW} h-10 text-[15px]`;

const SECTIONS_KEY = "nexus.sidebar.sections";
type SectionState = { pinned: boolean; rooms: boolean; projects: boolean; recent: boolean };
const DEFAULT_SECTIONS: SectionState = { pinned: true, rooms: true, projects: true, recent: true };

function useSectionState() {
  const [state, setState] = useState<SectionState>(DEFAULT_SECTIONS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SECTIONS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee del navegador tras montar
      if (raw) setState({ ...DEFAULT_SECTIONS, ...(JSON.parse(raw) as Partial<SectionState>) });
    } catch {
      // Almacenamiento no disponible: valores por defecto.
    }
  }, []);
  const set = (id: keyof SectionState, open: boolean) =>
    setState((prev) => {
      const next = { ...prev, [id]: open };
      try {
        window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // Sin persistencia: solo afecta a esta sesión.
      }
      return next;
    });
  return [state, set] as const;
}

interface RoomLink {
  id: string;
  name: string;
  openTopics: number;
}

/** Quien crea, renombra o borra una sala lo anuncia con este evento para refrescar la barra. */
export const ROOMS_CHANGED = "nexus:rooms-changed";

/** Salas de NexBots, junto a los chats pero en su propia sección. */
function RoomsSection({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomLink[] | null>(null);
  const [creating, setCreating] = useState<{ id: string; name: string; description: string; status: string; lastError: string | null }[] | null>(null);
  const inRooms = pathname.startsWith("/bots");

  const load = useCallback(async () => {
    const res = await fetch("/api/rooms").catch(() => null);
    if (res?.ok) setRooms(((await res.json()) as { rooms: RoomLink[] }).rooms);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga desde la API
    void load();
    window.addEventListener(ROOMS_CHANGED, load);
    return () => window.removeEventListener(ROOMS_CHANGED, load);
    // Se recarga al entrar o salir de NexBots: ahí es donde cambian las salas.
  }, [load, inRooms]);

  async function startCreating() {
    const res = await fetch("/api/bots").catch(() => null);
    setCreating(res?.ok ? ((await res.json()) as { bots: NonNullable<typeof creating> }).bots : []);
  }

  return (
    <>
      <Section
        label="Salas"
        open={open}
        onOpenChange={onOpenChange}
        action={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Nueva sala"
            onClick={() => void startCreating()}
            className="opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100"
          >
            <Plus />
          </Button>
        }
      >
        {rooms === null ? null : rooms.length === 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => void startCreating()} className={cn(ROW, "text-muted-fg")}>
              <MessagesSquare />
              Nueva sala
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          rooms.map((room) => (
            <SidebarMenuItem key={room.id}>
              <SidebarMenuButton asChild isActive={pathname === `/bots/salas/${room.id}`} className={ROW}>
                <Link href={`/bots/salas/${room.id}`}>
                  <MessagesSquare />
                  <span className="truncate">{room.name}</span>
                  {room.openTopics > 0 ? (
                    <span className="text-muted-fg ml-auto text-[12px]" title="Tareas abiertas">
                      {room.openTopics}
                    </span>
                  ) : null}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))
        )}
      </Section>
      {creating ? (
        <NewRoomDialog
          bots={creating}
          open
          onOpenChange={(value) => !value && setCreating(null)}
          onCreated={(roomId) => {
            setCreating(null);
            void load();
            router.push(`/bots/salas/${roomId}`);
          }}
        />
      ) : null}
    </>
  );
}

function Section({
  label,
  open,
  onOpenChange,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="group/section px-2 pt-3 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex h-8 items-center justify-between px-2.5">
        <CollapsibleTrigger className="text-muted-fg hover:text-fg flex flex-1 items-center justify-between text-[13px] transition-colors">
          {label}
          <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=closed]/section:-rotate-90" />
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0">
        <SidebarMenu className="gap-0.5">{children}</SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Spinner mientras se genera la respuesta; punto cuando terminó sin que se estuviera mirando. */
function ThreadStatus({ id }: { id: string }) {
  const { runningThreadIds, unreadThreadIds } = useShell();
  if (runningThreadIds.includes(id)) {
    return (
      <Loader2
        className="text-muted-fg ml-auto size-3.5 shrink-0 animate-spin"
        role="status"
        aria-label="Generando respuesta"
      />
    );
  }
  if (unreadThreadIds.includes(id)) {
    return (
      <span
        className="bg-brand ml-auto size-2 shrink-0 rounded-full"
        role="status"
        aria-label="Respuesta nueva"
        title="Respuesta nueva"
      />
    );
  }
  return null;
}

function ThreadItem({ thread }: { thread: ThreadSummary }) {
  const { currentThreadId, selectThread } = useShell();
  const pathname = usePathname();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={pathname === "/" && thread.id === currentThreadId}
        onClick={() => selectThread(thread.id)}
        title={thread.title}
        className={ROW}
      >
        <span className="truncate">{thread.title}</span>
        <ThreadStatus id={thread.id} />
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Acciones del chat" className="top-2 rounded-md">
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
          <ThreadMenuItems thread={thread} />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function ProjectItem({
  project,
  threads,
  expanded,
  onToggle,
}: {
  project: ProjectSummary;
  threads: ThreadSummary[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const shell = useShell();
  const pathname = usePathname();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={onToggle} className={ROW} title={project.name}>
        <Folder />
        <span className="truncate">{project.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Acciones del proyecto" className="top-2 rounded-md">
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
          <DropdownMenuItem onSelect={() => shell.newChat(project.id)}>
            <Plus className="size-4" />
            Nuevo chat en el proyecto
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => shell.requestRenameProject(project)}>
            <Pencil className="size-4" />
            Renombrar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => shell.requestDeleteProject(project)}>
            <Trash2 className="size-4" />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {expanded ? (
        <SidebarMenuSub className="border-l-border mr-0 pr-0">
          {threads.map((t) => (
            <SidebarMenuSubItem key={t.id}>
              <SidebarMenuSubButton
                isActive={pathname === "/" && t.id === shell.currentThreadId}
                onClick={() => shell.selectThread(t.id)}
                className="h-8 cursor-pointer text-[13.5px]"
              >
                <span className="truncate">{t.title}</span>
                <ThreadStatus id={t.id} />
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              onClick={() => shell.newChat(project.id)}
              className="text-muted-fg h-8 cursor-pointer text-[13.5px]"
            >
              <Plus /> Nuevo chat aquí
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function MoreRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={onClick} className={cn(ROW, "text-muted-fg")}>
        <MoreHorizontal />
        {label}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const shell = useShell();
  const pathname = usePathname();
  const [open, setOpen] = useSectionState();
  const { pinned, byProject, recent } = useMemo(() => splitThreads(shell.threads), [shell.threads]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [recentLimit, setRecentLimit] = useState(20);

  // El proyecto del hilo abierto se despliega solo.
  const currentProjectId = shell.threads.find((t) => t.id === shell.currentThreadId)?.projectId ?? null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derivado del hilo abierto
    if (currentProjectId) setExpanded((prev) => (prev.has(currentProjectId) ? prev : new Set(prev).add(currentProjectId)));
  }, [currentProjectId]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const projects = showAllProjects ? shell.projects : shell.projects.slice(0, 5);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between px-3 pt-3 pb-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-2">
        <Link
          href="/"
          aria-label="Nexus"
          onClick={(event) => {
            event.preventDefault();
            shell.newChat();
          }}
          className="text-fg hover:bg-surface-2 flex size-8 items-center justify-center rounded-lg"
        >
          <NexusLogo className="size-[22px]" />
        </Link>
        <div className="flex items-center gap-0.5 group-data-[collapsible=icon]:flex-col">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                asChild
                className="text-muted-fg hover:text-fg relative group-data-[collapsible=icon]:hidden"
              >
                <Link href="/inbox" aria-label="Bandeja">
                  <Bell className="size-[18px]" />
                  {shell.unread > 0 ? <span className="bg-brand absolute top-1 right-1 size-2 rounded-full" /> : null}
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bandeja</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Buscar chats (Ctrl+K)"
                onClick={shell.openSearch}
                className="text-muted-fg hover:text-fg group-data-[collapsible=icon]:hidden"
              >
                <Search className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Buscar · Ctrl K</TooltipContent>
          </Tooltip>
          <SidebarTrigger className="text-muted-fg hover:text-fg" />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 py-2">
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Nuevo" onClick={() => shell.newChat()} className={NAV_ROW}>
                <Plus />
                <span>Nuevo</span>
                <kbd className="text-muted-fg ml-auto hidden text-[11px] group-hover/menu-button:inline">Ctrl ⇧ O</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {shell.user.permissions.skills ? (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Skills" isActive={pathname.startsWith("/skills")} className={NAV_ROW}>
                  <Link href="/skills">
                    <Bot />
                    <span>Skills</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            {shell.user.permissions.bots ? (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="NexBots" isActive={pathname.startsWith("/bots") && !pathname.startsWith("/bots/salas")} className={NAV_ROW}>
                  <Link href="/bots">
                    <Cpu />
                    <span>NexBots</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            {shell.user.permissions.connectors ? (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Conectores" onClick={() => shell.openSettings("connectors")} className={NAV_ROW}>
                  <Plug />
                  <span>Conectores</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Uso" isActive={pathname === "/usage"} className={NAV_ROW}>
                <Link href="/usage">
                  <BarChart3 />
                  <span>Uso</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {isAdminRole(shell.user.role) ? (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Usuarios" isActive={pathname.startsWith("/admin/users")} className={NAV_ROW}>
                  <Link href="/admin/users">
                    <Users />
                    <span>Usuarios</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroup>

        {pinned.length > 0 ? (
          <Section label="Fijados" open={open.pinned} onOpenChange={(v) => setOpen("pinned", v)}>
            {pinned.map((t) => (
              <ThreadItem key={t.id} thread={t} />
            ))}
          </Section>
        ) : null}

        {shell.user.permissions.bots ? <RoomsSection open={open.rooms} onOpenChange={(v) => setOpen("rooms", v)} /> : null}

        <Section
          label="Proyectos"
          open={open.projects}
          onOpenChange={(v) => setOpen("projects", v)}
          action={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Nuevo proyecto"
              onClick={() => shell.requestCreateProject()}
              className="opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100"
            >
              <Plus />
            </Button>
          }
        >
          {shell.projects.length === 0 ? (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => shell.requestCreateProject()} className={cn(ROW, "text-muted-fg")}>
                <FolderPlus />
                Nuevo proyecto
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                threads={byProject[project.id] ?? []}
                expanded={expanded.has(project.id)}
                onToggle={() => toggle(project.id)}
              />
            ))
          )}
          {shell.projects.length > 5 ? (
            <MoreRow
              label={showAllProjects ? "Mostrar menos" : "Mostrar más"}
              onClick={() => setShowAllProjects((v) => !v)}
            />
          ) : null}
        </Section>

        <Section label="Recientes" open={open.recent} onOpenChange={(v) => setOpen("recent", v)}>
          {recent.length === 0 ? (
            <li className="text-muted-fg px-2.5 py-2 text-[13px]">Todavía no hay chats.</li>
          ) : (
            recent.slice(0, recentLimit).map((t) => <ThreadItem key={t.id} thread={t} />)
          )}
          {recent.length > recentLimit ? (
            <MoreRow label="Mostrar más" onClick={() => setRecentLimit((n) => n + 30)} />
          ) : null}
        </Section>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
