"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const WebSearchTool: ToolCallMessagePartComponent<{ query?: string }> = ({
  args,
  status,
}) => (
  <div className="my-2 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
    <span aria-hidden>⌕</span>
    <span className="truncate">
      {status.type === "running" ? "Buscando" : "Búsqueda"}:{" "}
      <span className="text-neutral-200">{args?.query ?? "..."}</span>
    </span>
  </div>
);

export const WebExtractTool: ToolCallMessagePartComponent<{
  url?: string;
  urls?: string[];
}> = ({ args, status }) => {
  const target = args?.url ?? args?.urls?.join(", ") ?? "...";
  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
      <span aria-hidden>◍</span>
      <span className="truncate">
        {status.type === "running" ? "Leyendo" : "Leído"}:{" "}
        <span className="text-neutral-200">{target}</span>
      </span>
    </div>
  );
};

export const ToolCard: ToolCallMessagePartComponent = ({ toolName, status }) => (
  <div className="my-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
    {status.type === "running" ? "Ejecutando" : "Herramienta"}:{" "}
    <span className="text-neutral-200">{toolName}</span>
  </div>
);
