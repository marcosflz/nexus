"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectSummary, ThreadSummary } from "@/components/chat/types";

export type ProjectDialogState =
  | { mode: "create"; moveThreadId?: string }
  | { mode: "rename"; project: ProjectSummary }
  | null;

interface Props {
  renaming: ThreadSummary | null;
  onCloseRename: () => void;
  onRename: (id: string, title: string) => void;

  deleting: ThreadSummary | null;
  onCloseDelete: () => void;
  onDelete: (id: string) => void;

  projectDialog: ProjectDialogState;
  onCloseProject: () => void;
  onCreateProject: (name: string, moveThreadId?: string) => void;
  onRenameProject: (id: string, name: string) => void;

  deletingProject: ProjectSummary | null;
  onCloseDeleteProject: () => void;
  onDeleteProject: (id: string) => void;
}

function NameDialog({
  open,
  title,
  description,
  placeholder,
  maxLength,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  maxLength: number;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== initial;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit(trimmed);
            onClose();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={title}
            className="h-10"
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ShellDialogs(props: Props) {
  const { renaming, deleting, projectDialog, deletingProject } = props;
  return (
    <>
      <NameDialog
        open={renaming !== null}
        title="Renombrar chat"
        maxLength={200}
        initial={renaming?.title ?? ""}
        submitLabel="Guardar"
        onClose={props.onCloseRename}
        onSubmit={(value) => renaming && props.onRename(renaming.id, value)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && props.onCloseDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este chat?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleting?.title}» y todos sus mensajes se borrarán de forma permanente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                if (deleting) props.onDelete(deleting.id);
                props.onCloseDelete();
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NameDialog
        open={projectDialog !== null}
        title={projectDialog?.mode === "rename" ? "Renombrar proyecto" : "Nuevo proyecto"}
        description={projectDialog?.mode === "create" ? "Agrupa chats relacionados en una carpeta." : undefined}
        placeholder="Nombre del proyecto"
        maxLength={80}
        initial={projectDialog?.mode === "rename" ? projectDialog.project.name : ""}
        submitLabel={projectDialog?.mode === "rename" ? "Guardar" : "Crear"}
        onClose={props.onCloseProject}
        onSubmit={(value) => {
          if (projectDialog?.mode === "rename") props.onRenameProject(projectDialog.project.id, value);
          else if (projectDialog?.mode === "create") props.onCreateProject(value, projectDialog.moveThreadId);
        }}
      />

      <AlertDialog open={deletingProject !== null} onOpenChange={(open) => !open && props.onCloseDeleteProject()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{deletingProject?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>Los chats del proyecto no se borran: pasan a Recientes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                if (deletingProject) props.onDeleteProject(deletingProject.id);
                props.onCloseDeleteProject();
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
