"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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

export interface GalleryAgent {
  id: string;
  slug: string;
  name: string;
  avatar: string;
  description: string;
  visibility: "private" | "unlisted" | "public";
  status: "active" | "paused";
  mine: boolean;
}

const VISIBILITY_LABEL = { private: "Privado", unlisted: "Con enlace", public: "Público" } as const;

export function AgentsGallery({ agents }: { agents: GalleryAgent[] }) {
  const router = useRouter();
  const [toDelete, setToDelete] = useState<GalleryAgent | null>(null);
  const mine = agents.filter((agent) => agent.mine);
  const shared = agents.filter((agent) => !agent.mine);

  async function duplicate(agent: GalleryAgent) {
    const res = await fetch(`/api/agents/${agent.id}/duplicate`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { agent?: { id: string }; error?: string };
    if (!res.ok || !data.agent) return toast.error(data.error ?? "No se pudo duplicar");
    toast.success("Agente copiado a tu cuenta");
    router.push(`/agents/${data.agent.id}`);
  }

  async function remove(agent: GalleryAgent) {
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("No se pudo eliminar el agente");
    toast.success(`«${agent.name}» eliminado`);
    router.refresh();
  }

  const card = (agent: GalleryAgent) => (
    <Card key={agent.id} className="border-border bg-surface hover:bg-surface-2 flex flex-col rounded-2xl transition-colors">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="bg-surface-3 flex size-11 shrink-0 items-center justify-center rounded-xl text-xl" aria-hidden>
            {agent.avatar || agent.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{agent.name}</CardTitle>
            <CardDescription className="line-clamp-2 min-h-8">{agent.description || "Sin descripción"}</CardDescription>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-full">{VISIBILITY_LABEL[agent.visibility]}</Badge>
          {agent.status === "paused" ? <Badge variant="secondary" className="rounded-full">En pausa</Badge> : null}
          <Badge variant="outline" className="rounded-full">@{agent.slug}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1" />
      <CardFooter className="gap-2">
        <Button asChild size="sm" className="rounded-full">
          <Link href={`/?agent=${agent.id}`}>
            <MessageSquare className="size-4" />
            Usar
          </Link>
        </Button>
        {agent.mine ? (
          <>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <Link href={`/agents/${agent.id}`}>
                <Pencil className="size-4" />
                Editar
              </Link>
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Eliminar agente" onClick={() => setToDelete(agent)}>
              <Trash2 className="size-4" />
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto rounded-full" onClick={() => duplicate(agent)}>
          <Copy className="size-4" />
          Duplicar
        </Button>
      </CardFooter>
    </Card>
  );

  return (
    <Page
      width="wide"
      title="Agentes"
      description="Asistentes con sus propias instrucciones, herramientas, conocimiento y tareas programadas."
      actions={
        <Button asChild className="rounded-full">
          <Link href="/agents/new">
            <Plus className="size-4" />
            Nuevo agente
          </Link>
        </Button>
      }
    >
      <section className="mb-10">
        <h2 className="text-muted-fg mb-3 text-[13px]">Mis agentes</h2>
        {mine.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-2xl border border-dashed p-10 text-center text-sm">
            Aún no tienes agentes. Crea uno describiendo en una frase lo que quieres que haga.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{mine.map(card)}</div>
        )}
      </section>

      {shared.length > 0 ? (
        <section>
          <h2 className="text-muted-fg mb-3 text-[13px]">Galería de la instancia</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shared.map(card)}</div>
        </section>
      ) : null}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{toDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran también su conocimiento, sus disparadores y su memoria. Los chats ya hechos se conservan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) void remove(toDelete);
                setToDelete(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
