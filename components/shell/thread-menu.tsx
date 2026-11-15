"use client";

import { Check, Folder, FolderInput, FolderPlus, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { ThreadSummary } from "@/components/chat/types";
import { useShell } from "./shell-context";

/** Items del menú de acciones de un chat (barra lateral y cabecera). */
export function ThreadMenuItems({ thread }: { thread: ThreadSummary }) {
  const shell = useShell();
  return (
    <>
      <DropdownMenuItem onSelect={() => shell.requestRename(thread)}>
        <Pencil className="size-4" />
        Renombrar
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void shell.setPinned(thread.id, !thread.pinnedAt)}>
        {thread.pinnedAt ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        {thread.pinnedAt ? "Desfijar" : "Fijar"}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput className="size-4" />
          Mover a proyecto
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          {shell.projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              disabled={project.id === thread.projectId}
              onSelect={() => void shell.moveThread(thread.id, project.id)}
            >
              <Folder className="size-4" />
              <span className="truncate">{project.name}</span>
              {project.id === thread.projectId ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuItem>
          ))}
          {thread.projectId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void shell.moveThread(thread.id, null)}>
                <X className="size-4" />
                Quitar del proyecto
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => shell.requestCreateProject(thread.id)}>
            <FolderPlus className="size-4" />
            Nuevo proyecto…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => shell.requestDelete(thread)}>
        <Trash2 className="size-4" />
        Eliminar
      </DropdownMenuItem>
    </>
  );
}
