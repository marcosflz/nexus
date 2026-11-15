"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { SettingsSection } from "@/components/shell/shell-context";
import { SettingsView } from "./settings-view";

export function SettingsDialog({
  open,
  section,
  notice,
  onSectionChange,
  onClose,
}: {
  open: boolean;
  section: SettingsSection;
  notice?: string;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="bg-bg h-[min(88vh,805px)] w-[calc(100%-2rem)] max-w-none gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[1090px]"
      >
        <DialogTitle className="sr-only">Ajustes</DialogTitle>
        <DialogDescription className="sr-only">Cuenta, preferencias, modelos y conectores de Nexus</DialogDescription>
        <SettingsView variant="dialog" section={section} onSectionChange={onSectionChange} notice={notice} onClose={onClose} />
        <DialogClose asChild>
          <Button variant="outline" size="icon" aria-label="Cerrar ajustes" className="absolute top-5 right-5 size-9 rounded-full">
            <X className="size-4" />
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
