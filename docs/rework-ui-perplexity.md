# Rework de la interfaz de Nexus al estilo Perplexity

> Plan escrito para que lo ejecute un modelo de implementación sin tener que decidir nada de diseño.
> Todo lo que aparece aquí (clases, textos, colores, rutas y firmas) es **literal**: cópialo tal cual.
> Si algo no está especificado, **no lo inventes**: déjalo como está hoy en el código.

---

## 0. Contexto

**Por qué.** Nexus es un buscador con IA autoalojado (Next.js 16.3, React 19.3, Tailwind v4, shadcn
estilo "radix-nova", assistant-ui 0.15). Su interfaz actual es un chat genérico: barra lateral shadcn
por defecto, burbujas de mensaje y una barra de herramientas llena de selects. El usuario quiere que
**se parezca lo más posible a Perplexity** (ver sus capturas: barra lateral oscura con «Nuevo» y
secciones plegables, portada centrada con «¿Qué quieres saber?», un compositor grande con
segmentos «Búsqueda | Computer», selector de modelo y botón circular blanco, un menú de usuario como
popover y un modal de ajustes grande con navegación lateral) y que **se note moderna**.

**Qué se decidió con el usuario.**
1. Alcance: **UI completa + chats fijados + proyectos** (carpetas de chats). Esto incluye cambios en
   la base de datos y en la API.
2. Ajustes: **modal estilo Perplexity + página `/settings`** que muestra el mismo contenido a
   pantalla completa.

**Resultado.** Todas las páginas autenticadas comparten un *shell* con la barra lateral nueva. La
portada es la pantalla de Perplexity. Los hilos se leen como en Perplexity: la pregunta es un titular,
hay pestañas «Respuesta / Fuentes», tarjetas de fuentes, citas con el nombre del dominio, una barra
de acciones y la lista «Relacionado». Los ajustes se abren en un modal (`#settings/<sección>`).

**No se copia la marca de Perplexity**: ni su logo, ni su nombre, ni sus textos legales. Nexus
conserva su nombre y estrena un logo propio (§1.4). Solo se imitan la disposición, las proporciones,
la paleta neutra con acento verde azulado y los patrones de interacción.

---

## 1. Reglas para quien implemente

1. **Antes de nada**: copia este documento a `docs/rework-ui-perplexity.md` (forma parte de la
   entrega) y crea una rama: `git switch -c feat/ui-rework`. El árbol tiene muchos cambios sin
   confirmar del usuario: **no hagas `git stash`, `reset` ni commits** salvo que el usuario lo pida.
2. `AGENTS.md` obliga a leer la documentación de Next que trae el repo antes de escribir código.
   Lee como mínimo:
   - `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md` (para §2.3)
   - `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`, la parte de
     *route groups* (para §4)
   - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/` → `layout.md` y
     `route-groups.md`
3. Idioma de toda la UI: **español**. Los textos de este plan son definitivos.
4. Iconos: solo `lucide-react` (v1.x). Todos los nombres que aparecen aquí se han comprobado en el
   paquete instalado: `Plus Bot Plug BarChart3 Bell Search PanelLeft Pin PinOff Folder FolderPlus
   FolderInput MoreHorizontal Ellipsis CircleUser SlidersHorizontal KeyRound Settings Settings2
   LogOut Moon Sun Monitor ChevronDown ChevronRight ChevronsUpDown ArrowUp Square Paperclip
   LayoutTemplate Copy RefreshCw ThumbsUp ThumbsDown Share2 Pencil Trash2 ListTree Sparkles
   ExternalLink Inbox X Check MessageSquare Loader2 Layers Telescope GraduationCap MessagesSquare
   ChartLine Newspaper Globe FileText`.
5. Utilidades que **ya existen** y hay que reutilizar (no las dupliques):
   - `cn` → `@/lib/utils`
   - `groupThreadsByDate` → `@/lib/threads/group.ts` (agrupa Hoy/Ayer/7 días…)
   - `domainOf`, `stripFollowupsBlock` → `@/lib/sources.ts`
   - `citationIdOf`, `remarkCitations`, `stripSourcesBlock` → `@/lib/markdown/citations.ts`
   - `likePattern` → `@/lib/sql.ts`
   - `FOCUS_OPTIONS`, `FOCUS_IDS` → `@/lib/focus.ts`
   - `getCurrentUser` → `@/lib/auth.ts`
   - Componentes shadcn en `components/ui/` (Button, Dialog, DropdownMenu con Sub/Radio/Checkbox/
     Shortcut, Command/CommandDialog, Collapsible, Select, Switch, Input, Skeleton, Avatar,
     AlertDialog, Popover, Tooltip, Sidebar…), `TextShimmer` (`components/ui/text-shimmer.tsx`),
     `Markdown` (`components/ui/markdown.tsx`) y `Source*` (`components/ui/source.tsx`).
6. **No cambies** la lógica de streaming o de runs (`followRun`, `reduceAgUi`, `consumeRun`,
   `resumeRun`, `onCancel`, `rate`, `convertMessage` salvo lo indicado en §7.2). El rework es de
   presentación y estado de navegación.
7. Después de cada fase: `npm run typecheck && npm test`. Al final, además, `npm run build`.
8. Accesibilidad: todo botón que solo tenga icono lleva `aria-label` en español. Respeta
   `prefers-reduced-motion` (ya hay una regla global en `tokens.css`, consérvala).

### Orden de las fases

| Fase | Contenido | Sección |
|---|---|---|
| F1 | Fundamentos visuales: tokens, fuente, CSS global, logo | §2 |
| F2 | Backend: fijados y proyectos (migración, esquema, API, helpers + tests) | §3 |
| F3 | Shell compartido: *route group*, layout, contexto | §4 |
| F4 | Barra lateral, menú de usuario y diálogos | §5 |
| F5 | Buscador de chats (Ctrl+K) y atajos | §6 |
| F6 | Chat: cabecera, portada, compositor y mensajes | §7 |
| F7 | Ajustes: modal + página | §8 |
| F8 | Páginas secundarias, autenticación y vista compartida | §9 |
| F9 | Limpieza, documentación y verificación | §10–§11 |

---

## 2. F1 · Fundamentos visuales

### 2.1 Paleta: reemplaza **entero** `app/tokens.css`

Se pasa de OKLCH azulado a la paleta neutra de Perplexity (grises casi puros, acento verde azulado).
Se mantienen todos los nombres de variable que ya existen y se añaden `--solid`, `--solid-fg` y
`--sidebar-bg`. El color de los botones principales («Mejorar», enviar) en Perplexity es **blanco en
oscuro y casi negro en claro**: eso es `--solid`. El verde azulado (`--brand`) queda para enlaces,
citas al pasar el ratón, el foco y los indicadores.

```css
/*
 * Tokens de diseño de Nexus (rework estilo Perplexity).
 *
 * Tailwind v4 es CSS-first: las variables se declaran aquí y se mapean con
 * `@theme inline` para que existan utilidades como `bg-surface` o `text-muted-fg`.
 * Paleta neutra con acento verde azulado; `--solid` es el color de los botones principales.
 */

:root {
  --bg: #fcfcf9;
  --sidebar-bg: #f3f3ee;
  --surface: #ffffff;
  --surface-2: #f3f3ee;
  --surface-3: #e8e8e2;
  --border: #e4e4dd;
  --border-strong: #d2d2ca;
  --fg: #13343b;
  --fg-soft: #2f4f56;
  --muted-fg: #64706f;
  --solid: #13343b;
  --solid-fg: #fcfcf9;
  --brand: #1a7f8c;
  --brand-hover: #156b76;
  --brand-fg: #ffffff;
  --brand-soft: color-mix(in oklab, #1a7f8c 12%, transparent);
  --success: #2f9e5b;
  --warning: #c98a12;
  --danger: #d0453a;
  --ring: #1a7f8c;

  --chart-1: oklch(0.62 0.12 205);
  --chart-2: oklch(0.66 0.15 260);
  --chart-3: oklch(0.70 0.15 152);
  --chart-4: oklch(0.78 0.15 85);
  --chart-5: oklch(0.68 0.17 330);
  --chart-6: oklch(0.64 0.18 25);

  --radius: 0.75rem;

  --shadow-1: 0 1px 2px rgb(19 52 59 / 0.06);
  --shadow-2: 0 2px 4px rgb(19 52 59 / 0.05), 0 8px 24px rgb(19 52 59 / 0.08);
  --shadow-3: 0 4px 8px rgb(19 52 59 / 0.08), 0 16px 48px rgb(19 52 59 / 0.14);

  --duration: 150ms;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);

  --sidebar-width: 280px;
  --panel-width: 360px;
}

.dark {
  --bg: #191a1a;
  --sidebar-bg: #1d1e1e;
  --surface: #202222;
  --surface-2: #272929;
  --surface-3: #2f3131;
  --border: #2e3030;
  --border-strong: #3d4040;
  --fg: #e8e8e6;
  --fg-soft: #c8c9c6;
  --muted-fg: #8d9191;
  --solid: #e8e8e6;
  --solid-fg: #191a1a;
  --brand: #20b8cd;
  --brand-hover: #45c7d9;
  --brand-fg: #0c1a1c;
  --brand-soft: color-mix(in oklab, #20b8cd 16%, transparent);
  --success: #4cc27e;
  --warning: #e3b341;
  --danger: #f0665b;
  --ring: #20b8cd;

  --chart-1: oklch(0.74 0.12 205);
  --chart-2: oklch(0.74 0.13 260);
  --chart-3: oklch(0.76 0.14 152);
  --chart-4: oklch(0.82 0.14 85);
  --chart-5: oklch(0.76 0.16 330);
  --chart-6: oklch(0.72 0.17 25);

  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-2: 0 2px 4px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.4);
  --shadow-3: 0 4px 8px rgb(0 0 0 / 0.35), 0 16px 48px rgb(0 0 0 / 0.5);
}

@theme inline {
  --color-bg: var(--bg);
  --color-sidebar-bg: var(--sidebar-bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-fg: var(--fg);
  --color-fg-soft: var(--fg-soft);
  --color-muted-fg: var(--muted-fg);
  --color-solid: var(--solid);
  --color-solid-fg: var(--solid-fg);
  --color-brand: var(--brand);
  --color-brand-hover: var(--brand-hover);
  --color-brand-fg: var(--brand-fg);
  --color-brand-soft: var(--brand-soft);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-chart-6: var(--chart-6);

  --shadow-1: var(--shadow-1);
  --shadow-2: var(--shadow-2);
  --shadow-3: var(--shadow-3);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 2.2 `app/globals.css`

Cambios exactos (el resto del archivo se queda igual):

1. En el bloque «Puente entre las dos paletas» (`:root, .dark { --background: … }`) sustituye estas
   líneas:
   ```css
   --primary: var(--solid);
   --primary-foreground: var(--solid-fg);
   --secondary: var(--surface-2);
   --muted: var(--surface-2);
   --accent: var(--surface-2);
   --input: var(--border-strong);
   --sidebar: var(--sidebar-bg);
   --sidebar-accent: var(--surface-2);
   --sidebar-primary: var(--solid);
   --sidebar-primary-foreground: var(--solid-fg);
   ```
   (`--background`, `--foreground`, `--card*`, `--popover*`, `--destructive`, `--sidebar-foreground`,
   `--sidebar-border`, `--sidebar-ring` se quedan como están.)
2. En el segundo `@theme inline`, cambia `--font-sans` por:
   ```css
   --font-sans:
     var(--font-geist), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
     "Helvetica Neue", Arial, "Noto Sans", sans-serif;
   --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
   ```
3. Sustituye el bloque «Prosa del asistente» (`.aui-md …` hasta `.aui-md td`) por:
   ```css
   /* Prosa del asistente (tamaños de Perplexity: 16px, interlineado amplio) */
   .aui-md {
     line-height: 1.75;
     font-size: 1rem;
     color: var(--fg);
   }
   .aui-md > * + * { margin-top: 0.85rem; }
   .aui-md h1, .aui-md h2, .aui-md h3 { font-weight: 500; margin-top: 1.75rem; letter-spacing: -0.01em; }
   .aui-md h1 { font-size: 1.5rem; }
   .aui-md h2 { font-size: 1.25rem; }
   .aui-md h3 { font-size: 1.075rem; }
   .aui-md strong { font-weight: 600; }
   .aui-md a { color: var(--brand); text-decoration: none; }
   .aui-md a:hover { text-decoration: underline; text-underline-offset: 3px; }
   .aui-md ul { list-style: disc; padding-left: 1.4rem; }
   .aui-md ol { list-style: decimal; padding-left: 1.4rem; }
   .aui-md li + li { margin-top: 0.35rem; }
   .aui-md li::marker { color: var(--muted-fg); }
   .aui-md code {
     background: var(--surface-2);
     padding: 0.12rem 0.35rem;
     border-radius: 0.375rem;
     font-size: 0.85em;
   }
   .aui-md pre {
     background: var(--surface);
     border: 1px solid var(--border);
     padding: 0.9rem 1rem;
     border-radius: 0.75rem;
     overflow-x: auto;
   }
   .aui-md pre code { background: transparent; padding: 0; }
   .aui-md blockquote { border-left: 2px solid var(--brand); padding-left: 0.9rem; color: var(--fg-soft); }
   .aui-md table { border-collapse: collapse; width: 100%; font-size: 0.925rem; }
   .aui-md th { font-weight: 500; color: var(--muted-fg); }
   .aui-md th, .aui-md td { border-bottom: 1px solid var(--border); padding: 0.55rem 0.6rem; text-align: left; }
   ```
4. Añade al final del archivo:
   ```css
   /* Toque moderno: scrollbars finas, selección con el acento y la animación de TextShimmer. */
   * {
     scrollbar-width: thin;
     scrollbar-color: var(--border-strong) transparent;
   }
   ::selection {
     background: color-mix(in oklab, var(--brand) 28%, transparent);
   }
   @keyframes shimmer {
     from { background-position: 100% center; }
     to { background-position: -100% center; }
   }
   ```
   (`TextShimmer` usa `animate-[shimmer_4s_infinite_linear]`, pero hoy no hay ningún `@keyframes
   shimmer` definido; con esto empieza a funcionar.)

### 2.3 Fuente: Geist con `next/font/google` en `app/layout.tsx`

`next/font/google` exporta `Geist` y `Geist_Mono` (comprobado en
`node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts`). Las fuentes se descargan
**durante el build**, así que se sirven desde el propio dominio, sin peticiones a Google desde el
navegador (privacidad). El Dockerfile ya tiene red en el build.

`app/layout.tsx` queda así:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Nexus",
  description: "Buscador con IA open source, autoalojado y con tus propias claves",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes añade la clase del tema antes de hidratar.
    <html lang="es" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-svh bg-bg text-fg antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### 2.4 Logo propio: crea `components/brand/logo.tsx`

Logo original (un nodo central unido a tres nodos: «nexus»). Usa `currentColor`, así hereda el color.

```tsx
import { cn } from "@/lib/utils";

/** Marca de Nexus: un nodo central conectado a tres nodos. Hereda el color del texto. */
export function NexusLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-6", className)}
      aria-hidden
    >
      <path d="M12 3.5 19.36 16.25 4.64 16.25Z" opacity={0.3} />
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="12" cy="3.5" r="1.6" />
      <circle cx="19.36" cy="16.25" r="1.6" />
      <circle cx="4.64" cy="16.25" r="1.6" />
      <path d="M12 5.1V9.6M14.08 13.2 17.98 15.45M9.92 13.2 6.02 15.45" />
    </svg>
  );
}
```

### 2.5 Ajustes en `components/ui/sidebar.tsx` (generado por shadcn; cambios mínimos)

- `const SIDEBAR_WIDTH_ICON = "3.5rem"` (era `3rem`).
- En `SidebarTrigger`, `<span className="sr-only">Toggle Sidebar</span>` → `Mostrar u ocultar la barra lateral`.
- En `SidebarRail`, `aria-label` y `title` → `"Mostrar u ocultar la barra lateral"`.
- En la cabecera móvil de `Sidebar` (`SheetTitle`/`SheetDescription`): `Barra lateral` / `Navegación de Nexus`.
- No cambies nada más de ese archivo.

### 2.6 `components/ui/source.tsx`

En `SourceTrigger` cambia la clase base del `<a>` por:
```
"inline-flex h-[18px] max-w-36 items-center gap-1 overflow-hidden rounded-full bg-surface-2 text-[11px] text-muted-fg no-underline align-[1px] transition-colors duration-150 hover:bg-brand hover:text-brand-fg"
```
(y conserva el `showFavicon ? "pr-2 pl-1" : "px-1.5"`; cambia `px-1` por `px-1.5`). En
`SourceContent` cambia `HoverCardContent` a `className={cn("w-80 rounded-xl p-0 shadow-2", className)}`
y el dominio `text-primary` por `text-brand`.

**Criterio de aceptación de F1:** la app arranca con fuente Geist, fondo `#191a1a` en oscuro, los
botones `default` son blancos con texto oscuro en oscuro y `TextShimmer` se anima.

---

## 3. F2 · Backend: chats fijados y proyectos

### 3.1 Migración: `scripts/migrate.mjs`

Añade este bloque **justo antes** del comentario «Un run que quedó `running`…» (el `UPDATE runs`
final):

```js
  // Proyectos (carpetas de chats) y chats fijados. Borrar un proyecto conserva sus chats.
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id, updated_at DESC)`;
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS pinned_at timestamptz`;
  await sql`ALTER TABLE threads ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL`;
  await sql`CREATE INDEX IF NOT EXISTS threads_project_idx ON threads (project_id) WHERE project_id IS NOT NULL`;
```

### 3.2 Esquema Drizzle: `lib/db/schema.ts`

1. Añade la tabla **antes** de `export const threads` (debe existir antes porque `threads` la referencia):
   ```ts
   export const projects = pgTable("projects", {
     id: uuid("id").primaryKey().defaultRandom(),
     userId: uuid("user_id")
       .notNull()
       .references(() => users.id, { onDelete: "cascade" }),
     name: text("name").notNull(),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
   });
   ```
2. Dentro de `threads`, después de `origin`, añade:
   ```ts
   /** Fijado en la barra lateral (null = no fijado). Ordena la sección «Fijados». */
   pinnedAt: timestamp("pinned_at", { withTimezone: true }),
   /** Proyecto (carpeta) al que pertenece; null = sin proyecto. */
   projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
   ```

### 3.3 Consultas compartidas: crea `lib/threads/queries.ts`

Las usan el layout del shell (§4.2) y las rutas de la API, así no se duplica el `select`.

```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, threads } from "@/lib/db/schema";

export interface ThreadRow {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  updatedAt: string;
}

export const MAX_PROJECTS = 100;

export const threadSummaryColumns = {
  id: threads.id,
  title: threads.title,
  updatedAt: threads.updatedAt,
  pinnedAt: threads.pinnedAt,
  projectId: threads.projectId,
};

export function serializeThread(row: {
  id: string;
  title: string;
  updatedAt: Date;
  pinnedAt: Date | null;
  projectId: string | null;
}): ThreadRow {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    projectId: row.projectId,
  };
}

export async function listThreadsFor(userId: string, limit = 200): Promise<ThreadRow[]> {
  const rows = await db
    .select(threadSummaryColumns)
    .from(threads)
    .where(eq(threads.userId, userId))
    .orderBy(desc(threads.updatedAt))
    .limit(limit);
  return rows.map(serializeThread);
}

export async function listProjectsFor(userId: string): Promise<ProjectRow[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt))
    .limit(MAX_PROJECTS);
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function ownedProject(userId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}
```

### 3.4 `app/api/threads/route.ts`

- **GET**: en el `select` añade `pinnedAt: threads.pinnedAt` y `projectId: threads.projectId`
  (deja el resto igual, también `createdAt` y la búsqueda con `q`).
- **POST**: el esquema pasa a
  `z.object({ title: z.string().max(200).optional(), projectId: z.string().uuid().optional() })`.
  Si viene `projectId`, comprueba `await ownedProject(user.id, projectId)`; si es `null` responde
  `404 { error: "Proyecto no encontrado" }`. Inserta con `projectId: parsed.data.projectId ?? null`.
  Si `parsed.success` es falso, se comporta como hoy (título por defecto, sin proyecto).

### 3.5 `app/api/threads/[id]/route.ts` (PATCH)

Sustituye `patchSchema` y el cuerpo de `PATCH`:

```ts
const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    projectId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined || v.projectId !== undefined);

export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

  const thread = await ownedThread(user.id, id);
  if (!thread) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });

  const { title, pinned, projectId } = parsed.data;
  if (projectId) {
    const project = await ownedProject(user.id, projectId);
    if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  // Fijar o mover no cambia `updatedAt`: el chat no debe saltar al principio de «Recientes».
  const changes: Partial<typeof threads.$inferInsert> = {};
  if (title !== undefined) {
    changes.title = title;
    changes.updatedAt = new Date();
  }
  if (pinned !== undefined) changes.pinnedAt = pinned ? new Date() : null;
  if (projectId !== undefined) changes.projectId = projectId;

  await db.update(threads).set(changes).where(eq(threads.id, id));
  return NextResponse.json({ ok: true });
}
```
Importa `ownedProject` de `@/lib/threads/queries`. GET y DELETE no cambian (GET ya devuelve la fila
completa, que ahora incluye `pinnedAt` y `projectId`).

### 3.6 API de proyectos

**`app/api/projects/route.ts`**
```ts
import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { listProjectsFor, MAX_PROJECTS } from "@/lib/threads/queries";

export const runtime = "nodejs";

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ projects: await listProjectsFor(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = nameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nombre no válido" }, { status: 400 });

  const [{ total }] = await db.select({ total: count() }).from(projects).where(eq(projects.userId, user.id));
  if (total >= MAX_PROJECTS) {
    return NextResponse.json({ error: "Has alcanzado el máximo de proyectos" }, { status: 400 });
  }
  const [row] = await db.insert(projects).values({ userId: user.id, name: parsed.data.name }).returning();
  return NextResponse.json(
    { project: { id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString() } },
    { status: 201 },
  );
}
```

**`app/api/projects/[id]/route.ts`**: mismo patrón que `threads/[id]`:
- `type RouteContext = { params: Promise<{ id: string }> }`.
- Valida el id con `z.string().uuid().safeParse(id)`; si falla → `404 { error: "Proyecto no encontrado" }`.
- Comprueba propiedad con `ownedProject`; si no es suyo → el mismo 404.
- **PATCH** `{ name }` (mismo `nameSchema`): `update(projects).set({ name, updatedAt: new Date() })`
  → `{ ok: true }`.
- **DELETE**: `db.delete(projects).where(eq(projects.id, id))` → `{ ok: true }`. Los chats quedan sin
  proyecto gracias a `ON DELETE SET NULL`.

### 3.7 Helpers puros y tests (vitest solo recoge `lib/**/*.test.ts`)

**`lib/threads/sections.ts`**
```ts
export interface SectionThread {
  id: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
}

export interface ThreadSections<T extends SectionThread> {
  /** Fijados, del más reciente al más antiguo según `pinnedAt`. */
  pinned: T[];
  /** Chats no fijados de cada proyecto, en el orden recibido (por `updatedAt` desc). */
  byProject: Record<string, T[]>;
  /** Chats no fijados y sin proyecto. */
  recent: T[];
}

/** Reparte los hilos (ya ordenados por `updatedAt` desc) en las secciones de la barra lateral. */
export function splitThreads<T extends SectionThread>(threads: T[]): ThreadSections<T> {
  const pinned: T[] = [];
  const byProject: Record<string, T[]> = {};
  const recent: T[] = [];
  for (const thread of threads) {
    if (thread.pinnedAt) pinned.push(thread);
    else if (thread.projectId) (byProject[thread.projectId] ??= []).push(thread);
    else recent.push(thread);
  }
  pinned.sort((a, b) => (a.pinnedAt! < b.pinnedAt! ? 1 : a.pinnedAt! > b.pinnedAt! ? -1 : 0));
  return { pinned, byProject, recent };
}
```
**`lib/threads/sections.test.ts`** (mismo estilo que `group.test.ts`): (a) un fijado con proyecto
aparece solo en `pinned`; (b) `pinned` se ordena por `pinnedAt` desc; (c) los no fijados con
proyecto van a `byProject[id]` conservando el orden; (d) los demás van a `recent`; (e) con `[]`
devuelve `{ pinned: [], byProject: {}, recent: [] }`.

**`lib/sources.ts`**: añade
```ts
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "gob", "ac", "edu"]);

/** Nombre corto de un dominio para las citas: «es.wikipedia.org» → «wikipedia», «bbc.co.uk» → «bbc». */
export function shortDomain(url: string): string {
  const host = domainOf(url);
  if (!host) return "";
  const parts = host.split(".");
  if (parts.length < 2) return host;
  const candidate = parts[parts.length - 2];
  if (SECOND_LEVEL.has(candidate) && parts.length >= 3) return parts[parts.length - 3];
  return candidate;
}
```
y en `lib/sources.test.ts` un `describe("shortDomain")` con: `https://es.wikipedia.org/x` →
`wikipedia`; `https://www.reuters.com` → `reuters`; `https://bbc.co.uk/news` → `bbc`;
`https://localhost:3000` → `localhost`; `no es url` → `""`.

**`lib/prefs.ts`** (preferencias por navegador; las usan el chat y Ajustes → Preferencias)
```ts
import { FOCUS_IDS } from "@/lib/focus";

export interface Prefs {
  focus: string;
  mode: "search" | "research";
  ui: boolean;
}

export const DEFAULT_PREFS: Prefs = { focus: "web", mode: "search", ui: false };
export const PREFS_KEY = "nexus.prefs";
export const PREFS_EVENT = "nexus:prefs";

/** Lee las preferencias de un JSON guardado; cualquier valor raro vuelve al predeterminado. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const data = JSON.parse(raw) as Partial<Prefs>;
    return {
      focus: typeof data.focus === "string" && FOCUS_IDS.includes(data.focus) ? data.focus : DEFAULT_PREFS.focus,
      mode: data.mode === "research" ? "research" : "search",
      ui: data.ui === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function readPrefs(): Prefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Modo privado o almacenamiento bloqueado: se aplica solo en esta sesión.
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  return next;
}
```
**`lib/prefs.test.ts`**: `parsePrefs(null)`, JSON inválido, `focus` desconocido → `"web"`,
`mode: "research"` se conserva, `ui: "true"` (string) → `false`.

**`lib/settings-search.ts`**
```ts
/** Quita tildes y pasa a minúsculas para buscar «busqueda» y encontrar «Búsqueda». */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** ¿La sección de ajustes coincide con la búsqueda? Busca en la etiqueta y en las palabras clave. */
export function matchesSettings(query: string, label: string, keywords: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return normalizeText(`${label} ${keywords}`).includes(q);
}
```
**`lib/settings-search.test.ts`**: «busqueda» encuentra «Búsqueda»; la consulta vacía coincide
siempre; «xyz» no coincide.

### 3.8 Tipos del cliente: `components/chat/types.ts`

`ThreadSummary` pasa a:
```ts
export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}
```

**Criterio de aceptación de F2:** `npm run migrate` aplica sin errores dos veces seguidas;
`npm test` pasa con los tests nuevos; `PATCH /api/threads/:id {"pinned":true}` y
`POST /api/projects {"name":"Viajes"}` responden 200 y 201.

---

## 4. F3 · Shell compartido

### 4.1 *Route group* `(app)`

Mueve con `git mv` (las URLs no cambian):

| Antes | Después |
|---|---|
| `app/page.tsx` | `app/(app)/page.tsx` |
| `app/agents/` (entera) | `app/(app)/agents/` |
| `app/inbox/page.tsx` | `app/(app)/inbox/page.tsx` |
| `app/usage/page.tsx` | `app/(app)/usage/page.tsx` |
| `app/settings/page.tsx` | `app/(app)/settings/page.tsx` |

Se quedan fuera: `app/layout.tsx`, `app/login`, `app/register`, `app/s`, `app/api`, `globals.css`,
`tokens.css`. Cada página movida conserva su `getCurrentUser()` + `redirect("/login")`.

### 4.2 `app/(app)/layout.tsx`

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjectsFor, listThreadsFor } from "@/lib/threads/queries";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [threads, projects, store] = await Promise.all([
    listThreadsFor(user.id),
    listProjectsFor(user.id),
    cookies(),
  ]);
  // Misma cookie que escribe SidebarProvider al plegar o desplegar.
  const sidebarOpen = store.get("sidebar_state")?.value !== "false";
  return (
    <AppShell
      user={{ id: user.id, email: user.email }}
      initialThreads={threads}
      initialProjects={projects}
      sidebarOpen={sidebarOpen}
    >
      {children}
    </AppShell>
  );
}
```

### 4.3 `app/(app)/page.tsx` (la portada)

Ya no carga hilos (lo hace el layout). Queda:

```tsx
import { ChatApp } from "@/components/chat/chat-app";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const pick = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const agent = pick(query.agent);
  const thread = pick(query.thread);
  return (
    <ChatApp
      initialAgentId={agent && UUID.test(agent) ? agent : null}
      // La API vuelve a comprobar que el hilo es del usuario (404 si no).
      initialThreadId={thread && UUID.test(thread) ? thread : null}
    />
  );
}
```

### 4.4 Contexto del shell: crea `components/shell/shell-context.tsx`

```tsx
"use client";

import { createContext, useContext } from "react";
import type { ProjectSummary, ThreadSummary } from "@/components/chat/types";

export type SettingsSection = "account" | "preferences" | "models" | "connectors" | "usage";

export interface ShellContextValue {
  user: { id: string; email: string };
  threads: ThreadSummary[];
  projects: ProjectSummary[];
  /** Hilo abierto en la portada (`/`). null = portada vacía («¿Qué quieres saber?»). */
  currentThreadId: string | null;
  /** Proyecto en el que se creará el próximo chat nuevo. */
  activeProjectId: string | null;
  /** Se incrementa en cada «Nuevo chat» para que el chat limpie adjuntos y estado. */
  newChatSignal: number;
  unread: number;

  selectThread(id: string | null): void;
  newChat(projectId?: string | null): void;
  refreshThreads(): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  moveThread(id: string, projectId: string | null): Promise<void>;
  requestRename(thread: ThreadSummary): void;
  requestDelete(thread: ThreadSummary): void;

  requestCreateProject(moveThreadId?: string): void;
  requestRenameProject(project: ProjectSummary): void;
  requestDeleteProject(project: ProjectSummary): void;

  openSettings(section?: SettingsSection, opts?: { notice?: string }): void;
  openSearch(): void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell debe usarse dentro de <AppShell>");
  return value;
}
```

### 4.5 `components/shell/app-shell.tsx`

Componente cliente. Props: `{ user, initialThreads: ThreadSummary[], initialProjects: ProjectSummary[], sidebarOpen: boolean, children }`.

**Estado** (`useState`): `threads`, `projects`, `currentThreadId` (inicial `null`),
`activeProjectId` (`null`), `newChatSignal` (`0`), `unread` (`0`), `searchOpen` (`false`),
`settings: { open: boolean; section: SettingsSection; notice?: string }` (inicial
`{ open: false, section: "account" }`), `renaming: ThreadSummary | null`,
`deleting: ThreadSummary | null`, `projectDialog: { mode: "create"; moveThreadId?: string } | { mode: "rename"; project: ProjectSummary } | null`,
`deletingProject: ProjectSummary | null`.

Hooks: `const router = useRouter(); const pathname = usePathname();` (de `next/navigation`).

**Funciones** (todas con `useCallback`):

- `refreshThreads`: `GET /api/threads` → `setThreads(data.threads)` (mapear `updatedAt`/`pinnedAt`
  a string si llegan como fecha serializada: ya llegan como string ISO en JSON). Ignora errores.
- `refreshProjects`: `GET /api/projects` → `setProjects`.
- `selectThread(id)`:
  ```ts
  setCurrentThreadId(id);
  const thread = id ? threadsRef.current.find((t) => t.id === id) : null;
  setActiveProjectId(thread?.projectId ?? null);
  const href = id ? `/?thread=${id}` : "/";
  if (pathname !== "/") router.push(href);
  else window.history.replaceState(null, "", href);
  ```
  (`threadsRef` es un `useRef` sincronizado con `threads` en cada render, como `messagesRef` en
  `chat-app.tsx`.)
- `newChat(projectId = null)`: `setActiveProjectId(projectId)`, `setCurrentThreadId(null)`,
  `setNewChatSignal((n) => n + 1)`, y navega como `selectThread(null)` (pero sin tocar
  `activeProjectId`).
- `setPinned(id, pinned)`: optimista. `setThreads(prev => prev.map(t => t.id === id ? { ...t, pinnedAt: pinned ? new Date().toISOString() : null } : t))`;
  luego `PATCH /api/threads/${id}` con `{ pinned }`; si `!res.ok` → `toast.error("No se pudo actualizar el chat")`
  y `refreshThreads()`. Al acabar bien: `toast.success(pinned ? "Chat fijado" : "Chat desfijado")`.
- `moveThread(id, projectId)`: optimista igual, con `{ projectId }`. Éxito:
  `toast.success(projectId ? "Chat movido al proyecto" : "Chat quitado del proyecto")`.
- `renameThread(id, title)` (privada, la usa el diálogo): es la `handleRename` actual de
  `chat-app.tsx` (líneas 722-736) sin la búsqueda: si falla, `refreshThreads()`.
- `deleteThread(id)` (privada): es la `handleDelete` actual (líneas 738-749); si era el hilo abierto
  → `setCurrentThreadId(null)` y `window.history.replaceState(null, "", "/")` si `pathname === "/"`.
- `createProject(name, moveThreadId?)`: `POST /api/projects`; error → `toast.error(data.error ?? "No se pudo crear el proyecto")`;
  éxito → `setProjects(prev => [project, ...prev])`, y si hay `moveThreadId` → `moveThread(moveThreadId, project.id)`.
- `renameProject(id, name)`: optimista + `PATCH /api/projects/${id}`.
- `deleteProject(id)`: `DELETE /api/projects/${id}`; éxito → quita el proyecto y pon
  `projectId: null` en sus hilos localmente; si `activeProjectId === id` → `setActiveProjectId(null)`;
  `toast.success("Proyecto eliminado")`.
- `requestRename/requestDelete/requestCreateProject/requestRenameProject/requestDeleteProject`:
  solo abren el diálogo correspondiente (ponen el estado).
- `openSettings(section = "account", opts)`: `setSettings({ open: true, section, notice: opts?.notice })`
  y `window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#settings/${section}`)`.
- `closeSettings()`: `setSettings(s => ({ ...s, open: false, notice: undefined }))` y
  `window.history.replaceState(null, "", window.location.pathname + window.location.search)`.
- `openSearch()`: `setSearchOpen(true)`.

**Efectos:**
1. Contador de no leídas: mueve aquí tal cual el `useEffect` de `chat-app.tsx` líneas 206-219
   (`/api/notifications/count` cada 30 s).
2. Hash de ajustes: al montar y en `hashchange`, si `location.hash` empieza por `#settings`, abre
   el modal con la sección (`#settings/models` → `"models"`; si la sección no es válida o falta →
   `"account"`). Lista válida: `["account","preferences","models","connectors","usage"]`.
3. Atajos de teclado (`keydown` en `window`; `mod = event.metaKey || event.ctrlKey`):
   - `mod + k` → `preventDefault()`, `openSearch()`.
   - `mod + ,` → `preventDefault()`, `openSettings()`.
   - `mod + shift + o` (comprueba `event.key.toLowerCase() === "o"`) → `preventDefault()`, `newChat()`.
   - (`mod + b` ya lo gestiona `SidebarProvider`.)

**Render:**
```tsx
<ShellContext.Provider value={value}>
  <SidebarProvider defaultOpen={sidebarOpen}>
    <AppSidebar />
    <SidebarInset className="min-h-svh min-w-0 bg-bg">{children}</SidebarInset>
  </SidebarProvider>
  <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
  <SettingsDialog
    open={settings.open}
    section={settings.section}
    notice={settings.notice}
    onSectionChange={(section) => openSettings(section)}
    onClose={closeSettings}
  />
  <ShellDialogs ... />   {/* §5.4: renombrar/eliminar chat, crear/renombrar/eliminar proyecto */}
</ShellContext.Provider>
```
`value` se construye con `useMemo` con todos los campos de `ShellContextValue`.

**Criterio de aceptación de F3:** `/`, `/agents`, `/inbox`, `/usage` y `/settings` cargan con la misma
barra lateral; pasar de una a otra no vuelve a cargar la lista de chats.

---

## 5. F4 · Barra lateral

Crea `components/shell/app-sidebar.tsx` y **borra** `components/chat/sidebar.tsx` al final de F6
(cuando `chat-app.tsx` ya no la importe).

### 5.1 Estructura y medidas (captura 1 de Perplexity)

```tsx
<Sidebar collapsible="icon">
  <SidebarHeader>…</SidebarHeader>
  <SidebarContent className="gap-0">
    <NavGroup />          {/* Nuevo, Agentes, Conectores, Uso */}
    <PinnedSection />     {/* solo si hay fijados */}
    <ProjectsSection />
    <RecentSection />
  </SidebarContent>
  <SidebarFooter><UserMenu /></SidebarFooter>
  <SidebarRail />
</Sidebar>
```

Todas las filas de la barra comparten estas clases (constante `ROW` en el archivo):
`"h-9 gap-3 rounded-lg px-2.5 text-[14px] text-fg/90 hover:bg-surface-2 data-[active=true]:bg-surface-3 data-[active=true]:font-normal [&_svg]:size-[18px]"`
y se aplican vía `className` de `SidebarMenuButton`. Las filas de navegación principal son un poco
más altas: `NAV_ROW = ROW + " h-10 text-[15px]"`.

**Cabecera (`SidebarHeader className="flex-row items-center justify-between px-3 pt-3 pb-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-2"`):**
- Izquierda: `<Link href="/" aria-label="Nexus" onClick={(e) => { e.preventDefault(); newChat(); }} className="flex size-8 items-center justify-center rounded-lg text-fg hover:bg-surface-2"><NexusLogo className="size-[22px]" /></Link>`.
- Derecha: `<div className="flex items-center gap-0.5 group-data-[collapsible=icon]:flex-col">` con:
  1. Campana: `Button variant="ghost" size="icon-sm" asChild` → `<Link href="/inbox" aria-label="Bandeja">` con `<Bell className="size-[18px]" />` y, si `unread > 0`, un punto
     `<span className="absolute top-1 right-1 size-2 rounded-full bg-brand" />` (el botón lleva `relative`).
     Clase extra: `group-data-[collapsible=icon]:hidden`.
  2. Lupa: `Button variant="ghost" size="icon-sm" aria-label="Buscar chats (Ctrl+K)" onClick={openSearch}` con `<Search className="size-[18px]" />`. Clase extra: `group-data-[collapsible=icon]:hidden`.
  3. `<SidebarTrigger className="text-muted-fg hover:text-fg" />` (icono `PanelLeft`).
- Envuelve la campana y la lupa en `Tooltip` con textos «Bandeja» y «Buscar · Ctrl K».

**Navegación principal (`SidebarGroup className="px-2 py-2"` → `SidebarMenu className="gap-0.5"`):**

| Icono | Texto | Acción | Activo cuando |
|---|---|---|---|
| `Plus` | Nuevo | `newChat()` | nunca |
| `Bot` | Agentes | `Link href="/agents"` | `pathname.startsWith("/agents")` |
| `Plug` | Conectores | `openSettings("connectors")` | nunca |
| `BarChart3` | Uso | `Link href="/usage"` | `pathname === "/usage"` |

Cada uno con `tooltip={texto}` (solo se ve plegada) y `className={NAV_ROW}`. «Nuevo» lleva además a
la derecha `<kbd className="ml-auto hidden text-[11px] text-muted-fg group-hover/menu-button:inline">Ctrl ⇧ O</kbd>`.

### 5.2 Secciones plegables

Componente interno `Section({ id, label, action?, children })`:
```tsx
<Collapsible open={open} onOpenChange={setOpen} className="group/section px-2 pt-3 group-data-[collapsible=icon]:hidden">
  <div className="flex h-8 items-center justify-between px-2.5">
    <CollapsibleTrigger className="flex flex-1 items-center justify-between text-[13px] text-muted-fg transition-colors hover:text-fg">
      {label}
      <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=closed]/section:-rotate-90" />
    </CollapsibleTrigger>
    {action}
  </div>
  <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0">
    <SidebarMenu className="gap-0.5">{children}</SidebarMenu>
  </CollapsibleContent>
</Collapsible>
```
El estado abierto/cerrado de cada sección se guarda en `localStorage["nexus.sidebar.sections"]` como
`{ pinned: boolean, projects: boolean, recent: boolean }` (por defecto todo `true`); lee en un
`useEffect` al montar y escribe al cambiar, siempre dentro de `try/catch`.

Las secciones se calculan con `const { pinned, byProject, recent } = useMemo(() => splitThreads(threads), [threads])`.

**Fila de chat** (componente `ThreadItem({ thread })`, reutilizado por las tres secciones):
```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    isActive={pathname === "/" && thread.id === currentThreadId}
    onClick={() => selectThread(thread.id)}
    title={thread.title}
    className={ROW}
  >
    <span className="truncate">{thread.title}</span>
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
```

**Fijados** (`id="pinned"`, `label="Fijados"`): solo se pinta si `pinned.length > 0`; lista de
`ThreadItem`.

**Proyectos** (`id="projects"`, `label="Proyectos"`):
- `action`: botón `Button variant="ghost" size="icon-xs" aria-label="Nuevo proyecto" onClick={() => requestCreateProject()}`
  con `<Plus />`, clase `opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100`.
- Sin proyectos: una fila `ROW` con `FolderPlus` y el texto «Nuevo proyecto» en `text-muted-fg`, que
  llama a `requestCreateProject()`.
- Cada proyecto (`ProjectItem`): fila `ROW` con `<Folder />` + nombre. Clic → alterna si está
  desplegado (estado local `expanded: Set<string>`; el proyecto del hilo abierto se despliega solo:
  `useEffect` sobre `currentThreadId`). Si está desplegado, debajo:
  ```tsx
  <SidebarMenuSub className="mr-0 border-l-border pr-0">
    {(byProject[project.id] ?? []).map((t) => (
      <SidebarMenuSubItem key={t.id}>
        <SidebarMenuSubButton isActive={…} onClick={() => selectThread(t.id)} className="h-8 text-[13.5px]">
          <span className="truncate">{t.title}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    ))}
    <SidebarMenuSubItem>
      <SidebarMenuSubButton onClick={() => newChat(project.id)} className="h-8 text-[13.5px] text-muted-fg">
        <Plus /> Nuevo chat aquí
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  </SidebarMenuSub>
  ```
  Menú «…» del proyecto (`SidebarMenuAction showOnHover`): «Nuevo chat en el proyecto» (`Plus`,
  `newChat(project.id)`), «Renombrar» (`Pencil`, `requestRenameProject`), separador, «Eliminar»
  (`Trash2`, `variant="destructive"`, `requestDeleteProject`).
- Se muestran los 5 primeros; si hay más, última fila «Mostrar más» (`MoreHorizontal`,
  `text-muted-fg`) que muestra todos y pasa a «Mostrar menos».

**Recientes** (`id="recent"`, `label="Recientes"`): `recent` en lista plana (sin agrupar por fecha,
como Perplexity). Muestra 20; si hay más, fila «Mostrar más» que suma 30 cada vez. Sin chats:
`<p className="px-2.5 py-2 text-[13px] text-muted-fg">Todavía no hay chats.</p>`.

### 5.3 Menú de usuario: crea `components/shell/user-menu.tsx` (captura 2)

Disparador (en `SidebarFooter className="p-2"`):
```tsx
<SidebarMenu><SidebarMenuItem>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarMenuButton size="lg" className="h-12 gap-2.5 rounded-lg px-2 hover:bg-surface-2 data-[state=open]:bg-surface-2">
        <Initial email={user.email} className="size-8 text-[13px]" />
        <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span className="truncate text-[14px] text-fg">{localPart}</span>
          <span className="truncate text-[12px] text-muted-fg">Cuenta personal</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-fg" />
      </SidebarMenuButton>
    </DropdownMenuTrigger>
    …contenido…
  </DropdownMenu>
</SidebarMenuItem></SidebarMenu>
```
`localPart = user.email.split("@")[0]`. `Initial` es un componente local:
`<span className={cn("flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-medium uppercase text-fg", className)}>{email.charAt(0)}</span>`.

Contenido: `DropdownMenuContent side="top" align="start" sideOffset={8} className="w-80 rounded-xl p-1.5"`.
Todos los `DropdownMenuItem` llevan `className="h-10 gap-3 rounded-lg px-2.5 text-[15px] [&_svg]:size-[18px]"`.
1. Cabecera (no es item): `<div className="flex items-center gap-3 px-2.5 py-2">` con
   `<Initial className="size-10 text-base" />` y dos líneas: `localPart` (`text-[15px] font-medium`) y
   el email completo (`text-[13px] text-muted-fg truncate`).
2. `DropdownMenuSeparator`.
3. «Todos los ajustes» — `Settings` — `onSelect={() => openSettings()}` —
   `<DropdownMenuShortcut>Ctrl ,</DropdownMenuShortcut>`.
4. «Uso y actividad» — `BarChart3` — `Link href="/usage"` (`asChild`).
5. «Bandeja» — `Inbox` — `Link href="/inbox"`; si `unread > 0`, a la derecha
   `<span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] text-brand-fg tabular-nums">{unread}</span>`.
6. `DropdownMenuSeparator`.
7. `DropdownMenuSub` «Apariencia»: el `DropdownMenuSubTrigger` lleva `Moon` y dos líneas:
   «Apariencia» y debajo, en `text-[12px] text-muted-fg`, la etiqueta del tema actual:
   `Sistema (Oscuro)` / `Sistema (Claro)` / `Claro` / `Oscuro` (con `useTheme()`; hasta montar,
   muestra «Sistema»). `DropdownMenuSubContent className="w-44"` con un `DropdownMenuRadioGroup`
   (`value={theme}`, `onValueChange={setTheme}`) y tres `DropdownMenuRadioItem`: «Claro» (`Sun`),
   «Oscuro» (`Moon`), «Sistema» (`Monitor`).
8. `DropdownMenuSeparator`.
9. «Cerrar sesión» — `LogOut` — la función `logout()` actual de `components/chat/sidebar.tsx`
   (líneas 89-92).

### 5.4 Menú de acciones del chat y diálogos

**`components/shell/thread-menu.tsx`** exporta `ThreadMenuItems({ thread }: { thread: ThreadSummary })`,
que devuelve solo los items (lo usan la barra lateral y la cabecera del chat):
1. «Renombrar» (`Pencil`) → `requestRename(thread)`.
2. «Fijar» (`Pin`) o «Desfijar» (`PinOff`) según `thread.pinnedAt` → `setPinned(thread.id, !thread.pinnedAt)`.
3. `DropdownMenuSub` «Mover a proyecto» (`FolderInput`) con `DropdownMenuSubContent className="w-56"`:
   - un item por proyecto (`Folder` + nombre; si es el actual, `Check` a la derecha y deshabilitado)
     → `moveThread(thread.id, project.id)`;
   - si `thread.projectId`: separador + «Quitar del proyecto» (`X`) → `moveThread(thread.id, null)`;
   - separador + «Nuevo proyecto…» (`FolderPlus`) → `requestCreateProject(thread.id)`.
4. `DropdownMenuSeparator`.
5. «Eliminar» (`Trash2`, `variant="destructive"`) → `requestDelete(thread)`.

**`components/shell/dialogs.tsx`** exporta `ShellDialogs` (lo pinta `AppShell`; recibe por props el
estado y los callbacks de §4.5):
- **Renombrar chat**: `Dialog` con `DialogContent className="sm:max-w-md rounded-2xl"`, título
  «Renombrar chat», `Input` con autofocus (`maxLength={200}`, valor inicial = título), botones
  «Cancelar» (`variant="ghost"`) y «Guardar» (default). Enter envía. No guarda si está vacío o igual.
- **Eliminar chat**: el `AlertDialog` que hoy está en `components/chat/sidebar.tsx` (líneas 256-276),
  con los mismos textos. El botón de acción lleva `className="bg-danger text-white hover:bg-danger/90"`.
- **Proyecto (crear/renombrar)**: `Dialog` `sm:max-w-md`; título «Nuevo proyecto» o «Renombrar proyecto»;
  descripción (solo al crear): «Agrupa chats relacionados en una carpeta.»; `Input` con placeholder
  «Nombre del proyecto» (`maxLength={80}`); botón «Crear» o «Guardar».
- **Eliminar proyecto**: `AlertDialog`, título «¿Eliminar «{nombre}»?», descripción «Los chats del
  proyecto no se borran: pasan a Recientes.», acción «Eliminar».

**Criterio de aceptación de F4:** se puede fijar, desfijar, mover a un proyecto, crear, renombrar y
borrar proyectos desde la barra; recargar la página conserva todo; la barra plegada (Ctrl+B) muestra
solo iconos con tooltips.

---

## 6. F5 · Buscador de chats y atajos

Crea `components/shell/search-dialog.tsx` (`"use client"`), props `{ open, onOpenChange }`. Sustituye
al campo «Buscar en tus chats» de la barra lateral antigua.

```tsx
<CommandDialog open={open} onOpenChange={onOpenChange} title="Buscar" description="Busca en tus chats"
  className="top-[18%] sm:max-w-2xl">
  <Command shouldFilter={false} className="rounded-2xl!">
    <CommandInput placeholder="Buscar en tus chats…" value={query} onValueChange={setQuery} />
    <CommandList className="max-h-[60vh]">
      <CommandEmpty>{loading ? "Buscando…" : "Sin resultados."}</CommandEmpty>
      {query.trim() === "" ? (
        <CommandGroup heading="Acciones">
          <CommandItem onSelect={() => run(() => newChat())}><Plus /> Nuevo chat <CommandShortcut>Ctrl ⇧ O</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/agents"))}><Bot /> Agentes</CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/inbox"))}><Inbox /> Bandeja</CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/usage"))}><BarChart3 /> Uso</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings())}><Settings /> Ajustes <CommandShortcut>Ctrl ,</CommandShortcut></CommandItem>
        </CommandGroup>
      ) : null}
      {groups.map((group) => (
        <CommandGroup key={group.label} heading={group.label}>
          {group.threads.map((thread) => (
            <CommandItem key={thread.id} value={thread.id} onSelect={() => run(() => selectThread(thread.id))}>
              <MessageSquare /> <span className="truncate">{thread.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  </Command>
</CommandDialog>
```
- `run(fn)` = `onOpenChange(false); fn();`.
- Sin texto: `results = shell.threads.slice(0, 20)`. Con texto: espera 200 ms (debounce con
  `setTimeout` en un `useEffect`, bandera `alive` para descartar respuestas viejas) y pide
  `GET /api/threads?q=${encodeURIComponent(query.trim())}` → `results = data.threads`.
- `groups = groupThreadsByDate(results)` (helper existente).
- Al cerrar, limpia `query`.

Los atajos están en `AppShell` (§4.5). **Criterio:** Ctrl+K abre el buscador desde cualquier página;
escribir filtra por título y contenido; Enter abre el chat.

---

## 7. F6 · Chat

### 7.1 Archivos

| Archivo | Acción |
|---|---|
| `components/chat/chat-app.tsx` | Refactor (§7.2) |
| `components/chat/chat-header.tsx` | Nuevo (§7.3) |
| `components/chat/composer.tsx` | Nuevo (§7.5) |
| `components/chat/source-cards.tsx` | Nuevo (§7.7) |
| `components/chat/thread.tsx` | Reescritura de la presentación (§7.4, §7.6) |
| `components/chat/message-parts.tsx` | Reestilo (§7.7) |
| `components/chat/chat-context.tsx` | `MessageCustom` gana `attachments?: { name: string }[]` |
| `components/share/share-button.tsx` | Solo el botón disparador (§7.3) |

### 7.2 `chat-app.tsx`

Firma nueva: `ChatApp({ initialAgentId = null, initialThreadId = null }: { initialAgentId?: string | null; initialThreadId?: string | null })`
(ya no recibe `user` ni `initialThreads`).

**Quita:** los estados `threads`, `search`, `searching`, `unread`; `refreshThreads` y su efecto de
búsqueda (líneas 298-311); el efecto de notificaciones (206-219); `handleNew`, `handleRename`,
`handleDelete` (716-749); el render de `SidebarProvider`/`AppSidebar`/`SidebarInset`/`header`
(767-816) y los imports que queden sin uso (`Separator`, `Sidebar*`, `AppSidebar`, `ShareButton`).

**Añade:**
```ts
const shell = useShell();
const currentThreadId = shell.currentThreadId;
const [loadingThread, setLoadingThread] = useState(false);
const [modelLabel, setModelLabel] = useState<string | null>(null);
```
- Al montar (una vez, `useEffect` con `[]`): si `initialThreadId` → `shell.selectThread(initialThreadId)`;
  si no y hay `initialAgentId` → `shell.newChat()` y `setAgentId(initialAgentId)`.
- Preferencias: al montar `const p = readPrefs(); setFocus(p.focus); setMode(p.mode); setUiMode(p.ui);`
  y escucha `window.addEventListener(PREFS_EVENT, …)` para aplicarlas cuando cambien en Ajustes.
- Modelo: al montar, `fetch("/api/settings")` → si `data.credential?.model`,
  `setModelLabel(data.credential.model.split("/").pop() ?? data.credential.model)`.
- `newChatSignal`: `useEffect(() => { setPendingAttachments([]); setUploadError(null); }, [shell.newChatSignal])`.
  Además, si `initialAgentId` no se ha pedido, «Nuevo» vuelve a Nexus: `setAgentId(null)` dentro
  del mismo efecto **excepto en el primer render** (usa un `useRef` para saltar la primera vez).
- En el efecto de carga del hilo (líneas 313-359): `setLoadingThread(true)` antes del `fetch` y
  `setLoadingThread(false)` en `then` y en `catch` (solo si `!cancelled`). En el `catch`, además,
  `shell.selectThread(null)` (hilo inexistente o ajeno). Cuando `currentThreadId` es `null`,
  `setLoadingThread(false)`.
- En `runTurn`, la creación del hilo pasa a:
  ```ts
  const res = await fetch("/api/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: shell.activeProjectId ?? undefined }),
  });
  …
  skipLoadRef.current = threadId;
  shell.selectThread(threadId);
  await shell.refreshThreads();
  ```
  y el refresco final `await refreshThreads(search.trim()).catch(() => {})` pasa a
  `await shell.refreshThreads().catch(() => {})`. Actualiza las dependencias del `useCallback`
  (quita `search`, `refreshThreads`, `router`; añade `shell`).
- El caso `no_credential` deja de navegar: en vez de `router.push("/settings?aviso=sin-credencial")`
  → `shell.openSettings("models", { notice: "Antes de chatear necesitas configurar un proveedor y su API key." })`.
  (Quita `useRouter` si queda sin uso.)
- `convertMessage`: elimina el bloque que añade `📎 nombre` como texto (líneas 608-613) y añade
  `attachments: message.attachments.map(({ name }) => ({ name }))` al objeto `custom`.

**Render nuevo:**
```tsx
const currentThread = shell.threads.find((t) => t.id === currentThreadId) ?? null;
const activeAgent = agents.find((agent) => agent.id === agentId);
const activeProject = shell.projects.find((p) => p.id === shell.activeProjectId) ?? null;

return (
  <AssistantRuntimeProvider runtime={runtime}>
    <ChatActionsProvider value={actions}>
      <div className="relative flex h-svh min-w-0 flex-col">
        <ChatHeader thread={currentThread} />
        <div className="min-h-0 flex-1">
          <ChatThread
            isEmpty={messages.length === 0 && !loadingThread}
            loading={loadingThread && messages.length === 0}
            agentName={activeAgent?.name}
            projectName={currentThreadId ? null : activeProject?.name ?? null}
            onClearProject={() => shell.newChat(null)}
            modelLabel={modelLabel}
            …/* el resto de props que ya pasaba: starters, agents, agentId, focus, mode, uiEnabled, backend, backends, handlers, attachments… */
          />
        </div>
      </div>
    </ChatActionsProvider>
  </AssistantRuntimeProvider>
);
```
`starters` ahora es `agentStarters ?? []` (se elimina `DEFAULT_STARTERS`).

### 7.3 Cabecera: `components/chat/chat-header.tsx`

```tsx
<header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 bg-bg/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
  <SidebarTrigger className="md:hidden" />
  {thread ? (
    <>
      <h1 className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{thread.title}</h1>
      <div className="flex items-center gap-1">
        <ShareButton threadId={thread.id} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Más acciones" className="rounded-full">
              <Ellipsis className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56"><ThreadMenuItems thread={thread} /></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  ) : <div className="flex-1" />}
</header>
```
En `share-button.tsx`, el disparador pasa a
`<Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-full px-3"><Share2 className="size-4" />Compartir</Button>`
(sin `ml-auto`). El resto del componente no cambia.

### 7.4 Portada (hilo vacío), en `thread.tsx`

`ChatThreadProps` gana: `isEmpty: boolean; loading: boolean; agentName?: string; projectName: string | null; onClearProject: () => void; modelLabel: string | null;`
y pierde `name`. Se quita `Toolbar` (sus controles pasan al compositor, §7.5).

Si `loading`: esqueleto
```tsx
<div className="mx-auto w-full max-w-[760px] space-y-4 px-6 pt-10">
  <Skeleton className="h-8 w-2/3 rounded-lg" />
  <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" />
</div>
```
Si `isEmpty` (captura 1):
```tsx
<ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
  <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[14vh]">
    <NexusLogo className="size-10 text-fg animate-in fade-in-0 zoom-in-95 duration-500" />
    {projectName ? (
      <button onClick={onClearProject} className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px] text-muted-fg hover:text-fg">
        <Folder className="size-3.5" /> {projectName} <X className="size-3.5" />
      </button>
    ) : null}
    <h1 className="mt-4 mb-8 text-center text-[28px] font-normal tracking-tight text-balance sm:text-[32px]">
      {agentName ? `Pregunta a ${agentName}` : "¿Qué quieres saber?"}
    </h1>
    <div className="w-full max-w-[700px]">
      <Composer {...props} placeholder={mode === "research" ? "Describe la investigación que quieres…" : "Pregunta lo que quieras…"} autoFocus />
    </div>
    {starters.length > 0 ? (
      <ul className="mt-6 w-full max-w-[700px] divide-y divide-border">
        {starters.map((s) => (
          <li key={s}>
            <button onClick={() => actions.send(s)} className="flex w-full items-center gap-3 py-2.5 text-left text-[15px] text-muted-fg transition-colors hover:text-fg">
              <Search className="size-4 shrink-0" /> {s}
            </button>
          </li>
        ))}
      </ul>
    ) : null}
  </div>
  <footer className="pb-4 text-center text-[12px] text-muted-fg">Nexus · Tus claves, tus datos</footer>
</ThreadPrimitive.Root>
```
(En móvil la cabecera de §7.3 ya pinta el `SidebarTrigger`.)

Si hay mensajes:
```tsx
<ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
  <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 pt-4 pb-10 sm:px-6">
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
    </div>
  </ThreadPrimitive.Viewport>
  <div className="sticky bottom-0 bg-gradient-to-t from-bg from-60% to-transparent px-4 pt-6 pb-4">
    <div className="mx-auto w-full max-w-[760px]">
      <Composer {...props} placeholder="Haz una pregunta de seguimiento" />
    </div>
  </div>
</ThreadPrimitive.Root>
```

### 7.5 Compositor: `components/chat/composer.tsx`

Exporta `Composer(props: ChatThreadProps & { placeholder: string; autoFocus?: boolean })`. Usa
`useAuiState((s) => s.thread.isRunning)` y `useShell()`.

```tsx
<ComposerPrimitive.Root className="group/composer flex w-full flex-col rounded-2xl border border-border bg-surface shadow-1 transition-[border-color,box-shadow] duration-200 focus-within:border-border-strong focus-within:shadow-2">
  {attachmentsRow}
  <ComposerPrimitive.Input
    rows={1}
    autoFocus={autoFocus}
    placeholder={placeholder}
    className="max-h-60 min-h-[56px] w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[16px] leading-6 text-fg outline-none placeholder:text-muted-fg"
  />
  <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
    <PlusMenu {...props} />
    <ModeSwitch mode={props.mode} onChange={props.onModeChange} />
    <ActiveChips {...props} />
    <div className="ml-auto flex items-center gap-1">
      <ModelPicker {...props} />
      {isRunning ? <StopButton /> : <SendButton />}
    </div>
  </div>
</ComposerPrimitive.Root>
```

- **`attachmentsRow`** (solo si hay adjuntos o `uploadError`): `<div className="flex flex-wrap gap-2 px-3 pt-3">`
  y por cada adjunto un chip
  `inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs`
  con `FileText size-3.5`, el nombre truncado (+ « (recortado)» si `truncated`) y el botón quitar
  (`X size-3`, `aria-label={`Quitar ${name}`}`, `text-muted-fg hover:text-danger`). Si `uploading`, un
  chip extra con `Loader2 animate-spin` y «Subiendo…». El error en `text-xs text-danger`.
- **`PlusMenu`**: `<input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log" onChange={…igual que ahora…} />`
  y un `DropdownMenu`:
  - Disparador: `Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-fg hover:text-fg" aria-label="Añadir"` con `<Plus className="size-[18px]" />`.
  - `DropdownMenuContent side="top" align="start" className="w-64 rounded-xl p-1.5"`:
    1. «Subir archivos» (`Paperclip`) → `fileRef.current?.click()`; deshabilitado si `uploading`.
       Debajo, en el mismo item, `text-[11px] text-muted-fg`: «PDF, DOCX, TXT, MD, CSV o JSON · máx. 10 MB».
    2. Separador + `DropdownMenuLabel className="text-[12px] text-muted-fg"` «Fuentes».
    3. `DropdownMenuRadioGroup value={focus} onValueChange={onFocusChange}` con un
       `DropdownMenuRadioItem` por `FOCUS_OPTIONS`, cada uno con su icono:
       `web: Globe, academic: GraduationCap, reddit: MessagesSquare, finance: ChartLine, news: Newspaper`
       (constante `FOCUS_ICONS` en el archivo).
    4. Separador + `DropdownMenuCheckboxItem checked={uiEnabled} onCheckedChange={onUiChange}` con
       `LayoutTemplate` y «Interfaz generativa»; segunda línea `text-[11px] text-muted-fg`:
       «Tablas, gráficos, mapas y formularios».
- **`ModeSwitch`** (segmentos de la captura 1):
  ```tsx
  <div role="group" aria-label="Modo" className="inline-flex items-center rounded-full bg-bg/60 p-0.5 ring-1 ring-border">
    {([["search", "Búsqueda", Search], ["research", "Research", Telescope]] as const).map(([id, label, Icon]) => (
      <button key={id} type="button" aria-pressed={mode === id} onClick={() => onChange(id)}
        className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] transition-colors",
          mode === id ? "bg-surface-2 text-fg ring-1 ring-border-strong" : "text-muted-fg hover:text-fg")}>
        <Icon className="size-4" /> {label}
      </button>
    ))}
  </div>
  ```
  Envuelve cada botón en `Tooltip`: «Respuesta rápida con fuentes» / «Informe a fondo: varias
  búsquedas y lecturas».
- **`ActiveChips`**: si `focus !== "web"`, un chip
  `inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 text-[13px] text-brand`
  con el icono del foco, su `label` y un botón `X` (`aria-label="Quitar fuente"`) que llama a
  `onFocusChange("web")`. Si `uiEnabled`, otro chip igual con `LayoutTemplate`, «Interfaz» y `X` →
  `onUiChange(false)`. En móvil (`max-sm`) oculta el texto y deja solo el icono.
- **`ModelPicker`** (como «GPT-6.1 Sol ⌄»):
  - Disparador: `Button variant="ghost" className="h-8 gap-1 rounded-full px-2.5 text-[14px] text-muted-fg hover:text-fg"`
    con el texto `activeAgent ? `${activeAgent.avatar ? activeAgent.avatar + " " : ""}${activeAgent.name}` : (modelLabel ?? "Nexus")`
    (truncado a `max-w-40`) y `<ChevronDown className="size-3.5" />`. `aria-label="Agente y modelo"`.
  - `DropdownMenuContent side="top" align="end" className="w-72 rounded-xl p-1.5"`:
    1. `DropdownMenuLabel` «Agente»; `DropdownMenuRadioGroup value={agentId ?? "__none"} onValueChange={(v) => onAgentChange(v === "__none" ? null : v)}`
       con «Nexus» (`NexusLogo className="size-4"`) y un item por agente (`avatar` + nombre).
    2. Si hay más de un motor disponible (`backends.filter(b => b.available).length > 1`): separador,
       `DropdownMenuLabel` «Motor» y un `RadioGroup` con `backend`/`onBackendChange`.
    3. Separador; «Cambiar modelo…» (`Settings2`) → `shell.openSettings("models")`; «Gestionar agentes»
       (`Bot`) → `Link href="/agents"`.
- **`SendButton`**: `<ComposerPrimitive.Send asChild><Button size="icon" aria-label="Enviar" className="size-9 rounded-full bg-solid text-solid-fg hover:bg-solid/85 disabled:opacity-30"><ArrowUp className="size-[18px]" /></Button></ComposerPrimitive.Send>`.
- **`StopButton`**: igual con `ComposerPrimitive.Cancel`, `aria-label="Detener"` y `<Square className="size-3.5 fill-current" />`.

### 7.6 Mensajes, en `thread.tsx`

**`UserMessage`** (la pregunta como titular, sin burbuja):
```tsx
<MessagePrimitive.Root className="group relative pt-8 first:pt-4 [&:not(:first-child)]:mt-10 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
  <h2 className="text-[26px] leading-tight font-normal tracking-tight break-words text-fg sm:text-[28px]">
    <MessagePrimitive.Parts components={{ Text: UserText }} />
  </h2>
  <UserAttachments />   {/* chips de custom.attachments: mismo estilo que en el compositor, sin botón quitar; contenedor "mt-3 flex flex-wrap gap-2" */}
  <ActionBarPrimitive.Root hideWhenRunning className="mt-2 flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
    <ActionBarPrimitive.Edit asChild>
      <Button variant="ghost" size="xs" className="gap-1 rounded-full text-muted-fg"><Pencil className="size-3.5" /> Editar</Button>
    </ActionBarPrimitive.Edit>
  </ActionBarPrimitive.Root>
</MessagePrimitive.Root>
```
`UserText` (en `message-parts.tsx`) pasa a devolver `<span className="whitespace-pre-wrap">{text}</span>`
(un `<p>` no puede ir dentro de `<h2>`).

**`EditComposer`**: `MessagePrimitive.Root className="pt-8"` con
`ComposerPrimitive.Root className="flex w-full flex-col gap-2 rounded-2xl border border-border-strong bg-surface p-3"`,
el input con `className="max-h-60 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-[18px] outline-none"`,
y los botones «Cancelar» (ghost, `rounded-full`) y «Enviar» (default, `rounded-full`).

**`AssistantMessage`**:
```tsx
function AssistantMessage() {
  const sources = useMessageSources();
  const [tab, setTab] = useState<"answer" | "sources">("answer");
  return (
    <MessagePrimitive.Root className="mt-6 flex flex-col animate-in fade-in-0 duration-300">
      <SourcesProvider value={sources}>
        <AnswerTabs tab={tab} onTab={setTab} count={sources.length} />
        <div className={cn(tab !== "answer" && "hidden")}>
          <SourcesStrip onShowAll={() => setTab("sources")} />
          <AnswerStatus />
          <MessagePrimitive.Parts components={{ /* el mismo mapa que hoy */ }} />
          <ApprovalCards />
          <MessageActions />
          <Related />
        </div>
        {tab === "sources" ? <SourcesList /> : null}
      </SourcesProvider>
    </MessagePrimitive.Root>
  );
}
```
(El contenido de la respuesta se oculta con `hidden` en vez de desmontarse para no perder el
estado de los componentes de OpenUI.)

- **`AnswerTabs`**:
  ```tsx
  <div role="tablist" className="mb-5 flex items-center gap-6 border-b border-border">
    <Tab active={tab === "answer"} onClick={() => onTab("answer")}><NexusLogo className="size-4" /> Respuesta</Tab>
    {count > 0 ? <Tab active={tab === "sources"} onClick={() => onTab("sources")}><Layers className="size-4" /> Fuentes · {count}</Tab> : null}
  </div>
  ```
  `Tab` = `<button role="tab" aria-selected={active} className={cn("-mb-px inline-flex h-10 items-center gap-2 border-b-2 text-[14px] font-medium transition-colors", active ? "border-fg text-fg" : "border-transparent text-muted-fg hover:text-fg")}>`.
- **`AnswerStatus`**: si el mensaje está `running` y todavía no hay ninguna parte de texto con
  contenido (`useAuiState((s) => s.message.content.some((p) => p.type === "text" && Boolean((p as { text?: string }).text)))`),
  pinta `<TextShimmer className="text-[15px]">{sources.length > 0 ? "Leyendo fuentes…" : "Pensando…"}</TextShimmer>`
  con un `mb-3`. En otro caso, `null`.
- **`MessageActions`** (barra inferior de Perplexity):
  ```tsx
  <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="mt-6 flex items-center justify-between text-muted-fg">
    <div className="flex items-center gap-1">
      <ActionBarPrimitive.Reload asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full px-3"><RefreshCw className="size-4" /> Reescribir</Button>
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.Copy asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Copiar respuesta"><Copy className="size-4" /></Button>
      </ActionBarPrimitive.Copy>
    </div>
    <div className="flex items-center gap-1">{/* pulgares: misma lógica que hoy, size="icon-sm", rounded-full, iconos size-4; activo con text-brand */}</div>
  </ActionBarPrimitive.Root>
  ```
- **`Related`** (antes `Followups`, misma lógica de visibilidad):
  ```tsx
  <section className="mt-8">
    <h3 className="mb-1 flex items-center gap-2 text-[18px] font-medium"><ListTree className="size-5" /> Relacionado</h3>
    <ul className="divide-y divide-border border-t border-border">
      {questions.map((q) => (
        <li key={q}>
          <button disabled={actions.isRunning} onClick={() => actions.send(q)}
            className="group flex w-full items-center justify-between gap-4 py-3 text-left text-[15px] text-fg transition-colors hover:text-brand disabled:opacity-50">
            <span>{q}</span><Plus className="size-4 shrink-0 text-brand" />
          </button>
        </li>
      ))}
    </ul>
  </section>
  ```
  `PromptSuggestion` deja de usarse en `thread.tsx`.

### 7.7 Fuentes, citas y pasos

**`components/chat/source-cards.tsx`** (presentacional, sin assistant-ui; lo usa también la vista
compartida):
```tsx
export interface CardSource { id: number; url: string; title?: string }

export function SourceCards({ sources, onShowAll }: { sources: CardSource[]; onShowAll?: () => void }) {
  if (sources.length === 0) return null;
  const overflow = sources.length > 4;
  const shown = overflow ? sources.slice(0, 3) : sources.slice(0, 4);
  const rest = sources.slice(3);
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {shown.map((s) => (
        <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
          className="flex h-[84px] flex-col justify-between rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-2">
          <span className="line-clamp-2 text-[13px] leading-snug text-fg">{s.title ?? domainOf(s.url)}</span>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-fg">
            <DomainInitial url={s.url} /> <span className="truncate">{shortDomain(s.url)}</span> <span className="tabular-nums">· {s.id}</span>
          </span>
        </a>
      ))}
      {overflow ? (
        <button type="button" onClick={onShowAll}
          className="flex h-[84px] flex-col justify-between rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-2">
          <span className="flex -space-x-1">{rest.slice(0, 3).map((s) => <DomainInitial key={s.id} url={s.url} ring />)}</span>
          <span className="text-[12px] text-muted-fg">+{rest.length} fuentes</span>
        </button>
      ) : null}
    </div>
  );
}

/** Inicial del dominio en un círculo. Sin favicons remotos: pedirlos a un tercero filtraría qué se consulta. */
export function DomainInitial({ url, ring = false }: { url: string; ring?: boolean }) {
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[9px] font-medium uppercase text-fg", ring && "ring-2 ring-surface")}>
      {shortDomain(url).charAt(0) || "?"}
    </span>
  );
}
```
Si no se pasa `onShowAll`, la tarjeta «+N» no es botón sino un `<div>` (en la vista compartida).

**En `message-parts.tsx`:**
- `SourcesRow` se sustituye por `SourcesStrip({ onShowAll })` =
  `<SourceCards sources={useContext(SourcesContext)} onShowAll={onShowAll} />`. Se quita el `Sheet`.
- Nuevo `SourcesList()`:
  ```tsx
  <ol className="divide-y divide-border">
    {sources.map((s) => (
      <li key={s.id}>
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="group flex gap-3 py-4">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12px] tabular-nums text-muted-fg">{s.id}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[12px] text-muted-fg"><DomainInitial url={s.url} /> {domainOf(s.url)}</span>
            <span className="mt-1 line-clamp-2 block text-[15px] font-medium text-fg group-hover:underline">{s.title ?? s.url}</span>
            <span className="mt-0.5 block truncate text-[12px] text-muted-fg">{s.url}</span>
          </span>
        </a>
      </li>
    ))}
  </ol>
  ```
- En `AssistantText`, la cita usa el dominio como etiqueta (como Perplexity):
  `<SourceTrigger label={shortDomain(source.url) || id} className="mx-0.5" />`. La cita sin fuente
  (`[n]` sin match) queda igual.
- `ToolRow` pasa a:
  ```tsx
  <div className="my-1.5 flex items-center gap-2.5 text-[13px] text-muted-fg">
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-2">
      {running ? <Loader2 className="size-3 animate-spin text-brand" /> : error ? <X className="size-3 text-danger" /> : <Check className="size-3" />}
    </span>
    {icon}
    <span className="truncate">{children}</span>
  </div>
  ```
  y en `WebSearchTool`/`WebExtractTool`/`GenericTool` el texto destacado pasa de
  `className="text-foreground"` a `className="rounded-md bg-surface-2 px-1.5 py-0.5 text-fg"`.
- `ApprovalCards`: cambia el contenedor a `rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm`
  y los botones a `rounded-full` (lógica igual).
- `ReasoningPart`: `ReasoningTrigger` con `className="text-[13px] text-muted-fg"`; `Reasoning className="my-3"`.

**Criterio de aceptación de F6:** la portada coincide con la captura 1 (logo, titular, compositor
de 700 px, segmentos, selector a la derecha, botón circular claro). Al preguntar: el titular es la
pregunta, aparecen pestañas, tarjetas de fuentes, la respuesta con citas por dominio, la barra de
acciones y «Relacionado». Editar, regenerar, cancelar, aprobar y los formularios de OpenUI siguen
funcionando.

---

## 8. F7 · Ajustes (captura 3)

### 8.1 Archivos

| Archivo | Contenido |
|---|---|
| `components/settings/sections.ts` | Configuración de la navegación |
| `components/settings/rows.tsx` | Primitivas visuales (sección, grupo, fila) |
| `components/settings/settings-view.tsx` | Navegación + contenido (modal y página) |
| `components/settings/settings-dialog.tsx` | El `Dialog` |
| `components/settings/sections/account-section.tsx` | Cuenta |
| `components/settings/sections/preferences-section.tsx` | Preferencias |
| `components/settings/sections/models-section.tsx` | Sale de `components/chat/settings-form.tsx` |
| `components/settings/sections/connectors-section.tsx` | Sale de `components/chat/connectors-panel.tsx` |
| `components/settings/sections/usage-section.tsx` | Usa `UsageContent` (§9.3) |

Al terminar, **borra** `components/chat/settings-form.tsx` y `components/chat/connectors-panel.tsx`.

### 8.2 `sections.ts`

```ts
import { BarChart3, Bot, CircleUser, Inbox, KeyRound, Plug, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { SettingsSection } from "@/components/shell/shell-context";

export interface SettingsNavItem { id: SettingsSection; label: string; icon: LucideIcon; group: "Cuenta" | "Agentes"; keywords: string }
export interface SettingsNavLink { href: string; label: string; icon: LucideIcon; keywords: string }

export const SETTINGS_ITEMS: SettingsNavItem[] = [
  { id: "account", label: "Cuenta", icon: CircleUser, group: "Cuenta", keywords: "email correo sesión cerrar seguridad cifrado" },
  { id: "preferences", label: "Preferencias", icon: SlidersHorizontal, group: "Cuenta", keywords: "tema apariencia oscuro claro fuente búsqueda modo research interfaz" },
  { id: "models", label: "Modelos y claves", icon: KeyRound, group: "Cuenta", keywords: "proveedor api key clave modelo openrouter openai anthropic base url local" },
  { id: "usage", label: "Uso", icon: BarChart3, group: "Cuenta", keywords: "tokens ejecuciones consumo actividad" },
  { id: "connectors", label: "Conectores", icon: Plug, group: "Agentes", keywords: "mcp servidor herramientas integraciones" },
];

export const SETTINGS_LINKS: SettingsNavLink[] = [
  { href: "/agents", label: "Agentes", icon: Bot, keywords: "asistentes galería" },
  { href: "/inbox", label: "Bandeja", icon: Inbox, keywords: "notificaciones aprobaciones" },
];
```

### 8.3 `rows.tsx`

```tsx
export function SettingsSectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-8 text-[22px] font-medium tracking-tight">{children}</h2>;
}
export function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      {title ? <h3 className="mb-3 text-[17px] font-medium">{title}</h3> : null}
      <div className="divide-y divide-border rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}
export function SettingsRow({ label, description, children, htmlFor }: { label: string; description?: React.ReactNode; children?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[15px] font-medium">{label}</label>
        {description ? <p className="mt-0.5 text-[13px] text-muted-fg">{description}</p> : null}
      </div>
      {children ? <div className="shrink-0 sm:max-w-[60%]">{children}</div> : null}
    </div>
  );
}
```
Inputs dentro de filas: `className="h-10 w-full rounded-lg bg-transparent sm:w-72"`. Selects:
`SelectTrigger className="h-10 w-full rounded-lg sm:w-72"`.

### 8.4 `settings-view.tsx`

Props: `{ variant: "dialog" | "page"; section: SettingsSection; onSectionChange(section): void; notice?: string; onClose?: () => void }`.

```tsx
<div className={cn("grid min-h-0 grid-cols-1 md:grid-cols-[292px_1fr]", variant === "dialog" ? "h-full" : "min-h-svh")}>
  <nav className="hidden min-h-0 flex-col overflow-y-auto border-r border-border p-2.5 md:flex">
    <div className="relative mb-2">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-fg" />
      <Input value={query} onChange={…} placeholder="Buscar ajustes" aria-label="Buscar ajustes" className="h-11 rounded-lg bg-transparent pl-9 text-[15px]" />
    </div>
    {/* Grupos «Cuenta», «Agentes» con SETTINGS_ITEMS filtrados por matchesSettings(query, label, keywords),
        y grupo «Otros» con SETTINGS_LINKS filtrados igual. Los grupos vacíos no se pintan. */}
    <p className="px-3 pt-5 pb-2 text-[13px] text-muted-fg">{grupo}</p>
    <button className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[15px] transition-colors [&_svg]:size-[18px]",
      active ? "bg-surface-2 text-fg" : "text-fg/85 hover:bg-surface-2")}>…</button>
    {/* Los SETTINGS_LINKS son <Link> con el mismo estilo y un ExternalLink size-3.5 text-muted-fg a la derecha;
        en variant="dialog" llaman a onClose() al hacer clic. */}
  </nav>
  <div className="min-h-0 overflow-y-auto px-5 py-8 md:px-10 md:py-10">
    {/* Móvil: Select de sección en lugar de la nav */}
    <div className="mb-6 md:hidden">
      <Select value={section} onValueChange={(v) => onSectionChange(v as SettingsSection)}>…SETTINGS_ITEMS…</Select>
    </div>
    {notice ? <p role="status" className="mb-6 rounded-xl border border-brand/40 bg-brand-soft px-4 py-3 text-sm">{notice}</p> : null}
    {section === "account" ? <AccountSection /> : null}
    {section === "preferences" ? <PreferencesSection /> : null}
    {section === "models" ? <ModelsSection /> : null}
    {section === "connectors" ? <ConnectorsSection /> : null}
    {section === "usage" ? <UsageSection /> : null}
  </div>
</div>
```
Si la búsqueda deja una sola sección y no es la actual, no cambies de sección automáticamente
(solo filtra la lista).

### 8.5 `settings-dialog.tsx`

```tsx
<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
  <DialogContent showCloseButton={false}
    className="h-[min(88vh,805px)] w-[calc(100%-2rem)] max-w-none gap-0 overflow-hidden rounded-2xl bg-bg p-0 sm:max-w-[1090px]">
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
```
El `DialogOverlay` por defecto es `bg-black/10`; para parecerse a la captura 3, en
`components/ui/dialog.tsx` cambia esa clase a `bg-black/50` (afecta a todos los diálogos y es lo
deseado).

### 8.6 Secciones

**Cuenta** (`account-section.tsx`, usa `useShell().user`):
- `SettingsSectionTitle` «Cuenta».
- Grupo «Detalles»: fila «Foto de perfil» con `Initial` `size-10` (mismo componente que §5.3; muévelo
  a `components/shell/initial.tsx` y expórtalo); fila «Usuario» con `localPart` en `text-muted-fg`;
  fila «Correo electrónico» con el email en `text-muted-fg`.
- Grupo «Seguridad»: fila «Cifrado de claves», descripción «Tus API keys se guardan cifradas en el
  servidor (AES-256-GCM) y solo se usan para tus consultas.», a la derecha
  `<Badge variant="outline" className="rounded-full">Activo</Badge>`.
- Grupo «Sesión»: fila «Cerrar sesión», descripción «Cierra la sesión en este navegador.», botón
  `variant="outline" className="rounded-full"` «Cerrar sesión» (misma función `logout`).

**Preferencias** (`preferences-section.tsx`):
- `SettingsSectionTitle` «Preferencias».
- Grupo «Apariencia»: fila «Tema» con `Select` (Claro/Oscuro/Sistema) enlazado a `useTheme()`.
- Grupo «Búsqueda» (descripción del grupo en la primera fila): 
  - «Fuente predeterminada», descripción «Dónde busca Nexus si no eliges otra cosa.», `Select` con
    `FOCUS_OPTIONS`.
  - «Modo predeterminado», `Select` «Búsqueda» / «Research».
  - «Interfaz generativa», descripción «Responder con tablas, gráficos y formularios cuando aporten.»,
    `Switch`.
  - Todas leen `readPrefs()` en un `useEffect` al montar y guardan con `writePrefs({...})` al cambiar.
- Texto al pie, `text-[13px] text-muted-fg`: «Estas preferencias se guardan en este navegador.»

**Modelos y claves** (`models-section.tsx`): **copia toda la lógica** de `SettingsForm`
(estados, `useEffect` de carga, `loadModels`, el efecto de cambio de proveedor, `save`) sin cambiar
llamadas ni validaciones. Cambia solo el marcado:
- Sin `<main>`, sin cabecera «Ajustes»/email, sin «← Volver al chat», sin `notice` (lo pinta la vista).
- `SettingsSectionTitle` «Modelos y claves».
- `<form onSubmit={save}>` con `SettingsGroup title="Proveedor"` y estas filas:
  1. «Proveedor»: `Select` shadcn con los proveedores (texto `label` + « ✓» si tiene clave guardada);
     el `onValueChange` hace exactamente lo mismo que hoy el `onChange` del `<select>`.
  2. «API key» (+ « (opcional)» si `!current.needsKey`), descripción «Se cifra en el servidor y solo
     se usa para tus consultas.»: `Input type="password"` con el mismo `placeholder` y `onBlur`.
  3. «Modelo», descripción `{models.length} modelos disponibles en {label}.` si hay lista; control:
     si hay lista, `Select` (con `SelectContent className="max-h-80"`) — **ojo**: Radix no admite
     `SelectItem value=""`; para el caso «sin modelo» usa `<SelectValue placeholder="Elige un modelo…" />`
     y para el modelo actual que no está en la lista añade un item `{model} (actual)`. Si no hay
     lista, el `Input` de hoy. Debajo del control, el botón de texto «Cargar modelos / Recargar lista /
     Consultando…» (`variant="link" size="xs"`) y el `listError` en `text-[12px] text-warning`.
  4. «Base URL (opcional)», descripción «Para modelos locales, p. ej. http://localhost:1234/v1».
- Pie: `<div className="flex items-center justify-end gap-3">` con `error` (`text-danger`), `status`
  (`text-success`) y `Button type="submit" className="rounded-full px-5"` «Guardar» / «Guardando…».

**Conectores** (`connectors-section.tsx`): copia la lógica de `ConnectorsPanel` tal cual. Marcado:
- `SettingsSectionTitle` «Conectores» y debajo el párrafo actual de explicación en
  `-mt-6 mb-8 text-[14px] text-muted-fg`.
- `SettingsGroup title="Tus conectores"`: una `SettingsRow` por conector (`label=name`,
  `description={`${url} · ${hasSecret ? "con secreto" : "sin autenticación"}`}`) con el botón borrar
  (`Trash2`). Si no hay: una fila con `label="Sin conectores"` y descripción «Añade uno con el formulario
  de abajo.».
- `SettingsGroup title="Añadir conector"`: el formulario actual dentro de `<div className="space-y-3 p-4">`,
  botón `rounded-full`.

**Uso** (`usage-section.tsx`): `SettingsSectionTitle` «Uso» + `<UsageContent />` (§9.3).

### 8.7 Página `/settings`: `app/(app)/settings/page.tsx`

Componente servidor que lee `aviso` y `seccion` de `searchParams` y pinta un cliente
`SettingsPage({ initialSection, notice })` (nuevo, en `components/settings/settings-page.tsx`) que
guarda la sección en estado y renderiza
`<SettingsView variant="page" section={section} onSectionChange={setSection} notice={notice} />`.
- `notice` = el texto actual si `aviso === "sin-credencial"`.
- `initialSection` = `seccion` si es una de las válidas; si no, `"models"` cuando hay aviso y
  `"account"` en otro caso.
- En `components/auth-form.tsx`, `register.next` pasa de `"/settings"` a `"/settings?seccion=models"`.
- En `components/agents/editor.tsx` (línea ~348), el enlace «Añádelos en Ajustes» pasa a un
  `<button type="button" className="underline" onClick={() => openSettings("connectors")}>Ajustes</button>`
  con `const { openSettings } = useShell();`.

**Criterio de aceptación de F7:** Ctrl+, abre el modal; la URL muestra `#settings/<sección>`;
recargar con ese hash lo reabre; la búsqueda «busqueda» deja visible «Preferencias»; guardar
proveedor, clave y modelo funciona igual que antes; `/settings` muestra lo mismo a pantalla completa.

---

## 9. F8 · Páginas secundarias, autenticación y vista compartida

### 9.1 Envoltorio común: crea `components/shell/page.tsx`

```tsx
"use client";
export function Page({ title, description, actions, back, width = "default", children }: {
  title: string; description?: string; actions?: React.ReactNode;
  back?: { href: string; label: string }; width?: "default" | "wide"; children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-bg/80 px-3 backdrop-blur-md md:hidden">
        <SidebarTrigger />
      </header>
      <main className={cn("mx-auto w-full px-6 py-8 md:py-12", width === "wide" ? "max-w-5xl" : "max-w-3xl")}>
        {back ? (
          <Link href={back.href} className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-fg hover:text-fg">
            <ArrowLeft className="size-4" /> {back.label}
          </Link>
        ) : null}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-normal tracking-tight">{title}</h1>
            {description ? <p className="mt-1 max-w-xl text-[14px] text-muted-fg">{description}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
```

### 9.2 Agentes

- `components/agents/gallery.tsx`: sustituye el `<main>` y la cabecera (incluido «Volver al chat»)
  por `<Page width="wide" title="Agentes" description="Asistentes con sus propias instrucciones, herramientas, conocimiento y tareas programadas." actions={<Button asChild className="rounded-full">…Nuevo agente…</Button>}>`.
  Tarjetas: `Card className="flex flex-col rounded-2xl border-border bg-surface transition-colors hover:bg-surface-2"`;
  avatar `size-11 rounded-xl bg-surface-3 text-xl`; badges `rounded-full`; botones `rounded-full`.
  Títulos de sección «Mis agentes» / «Galería de la instancia» en `text-[13px] text-muted-fg mb-3`.
  Estado vacío: `rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-fg`.
- `components/agents/editor.tsx`: sustituye `<main>` + enlace atrás + `h1` + botón guardar por
  `<Page title={isNew ? "Nuevo agente" : spec.name || "Agente"} back={{ href: "/agents", label: "Agentes" }} actions={…el botón Guardar o el Badge «Solo lectura», con rounded-full…}>`.
  `TabsList`: `className="mb-6 h-auto flex-wrap justify-start gap-1 rounded-full bg-surface-2 p-1"` y
  cada `TabsTrigger` `className="rounded-full px-3.5"`. Las filas `rounded-lg border p-3` pasan a
  `rounded-xl border border-border bg-surface p-4`. No cambies lógica.
- `triggers-panel.tsx` y `knowledge-panel.tsx`: solo sustituye `rounded-lg border` por
  `rounded-xl border border-border bg-surface` en los contenedores de lista y formulario.

### 9.3 Bandeja y Uso

- `components/inbox.tsx`: `<Page title="Bandeja" description="Lo que hacen tus agentes cuando trabajan por su cuenta.">`.
  Quita el `h1` con `Bell` y el enlace atrás. Notificaciones: tarjeta
  `rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2`; aprobaciones
  igual que `ApprovalCards` (§7.7).
- `components/usage.tsx`: extrae todo el contenido (selector de periodo, KPIs, tablas, barras) a
  `export function UsageContent()` y deja `export function UsageDashboard()` como
  `<Page title="Uso"><UsageContent /></Page>`. En `UsageContent`: el `Select` del periodo arriba a la
  derecha (`mb-6 flex justify-end`); KPIs `rounded-xl border border-border bg-surface p-4`, valor
  `text-[28px] font-normal tabular-nums`; barras `bg-brand` sobre `bg-surface-2`.

### 9.4 Login y registro: `components/auth-form.tsx`

Sin `Card`. Misma lógica y textos de `COPY`, salvo los títulos: login «Bienvenido a Nexus»,
registro «Crea tu cuenta en Nexus».
```tsx
<main className="flex min-h-svh flex-col items-center justify-center bg-bg px-4">
  <NexusLogo className="size-10 text-fg" />
  <h1 className="mt-5 text-center text-[28px] font-normal tracking-tight">{copy.title}</h1>
  <p className="mt-2 max-w-sm text-center text-[14px] text-muted-fg">{copy.description}</p>
  <form onSubmit={submit} className="mt-8 w-full max-w-sm space-y-3">
    {/* Label sr-only + Input className="h-11 rounded-xl bg-surface px-4 text-[15px]" con placeholder «Email» / «Contraseña» */}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl text-[15px]">{busy ? copy.busy : copy.submit}</Button>
  </form>
  <p className="mt-6 text-sm text-muted-fg">{copy.alt.text} <Link href={copy.alt.href} className="text-fg underline underline-offset-4">{copy.alt.link}</Link></p>
</main>
```

### 9.5 Vista compartida: `components/share/shared-thread.tsx`

Mismo aspecto que un hilo: cabecera `flex h-14 items-center justify-between` con
`<Link href="/" className="flex items-center gap-2 text-[15px] font-medium"><NexusLogo className="size-5" /> Nexus</Link>`
y `ThemeToggle`; debajo «Conversación compartida» (`text-[13px] text-muted-fg`) y el título
(`text-[28px] font-normal`). Cada pregunta del usuario como `UserMessage` (`h2` de 26–28 px, separada
por `border-t` desde la segunda); cada respuesta con `<SourceCards sources={sources} />` (sin
`onShowAll`) y el `Markdown` con citas por dominio (`label={shortDomain(source.url) || id}`).
Contenedor `mx-auto w-full max-w-[760px] px-4 sm:px-6`. Pie igual que hoy.

**Criterio de aceptación de F8:** ninguna página interna tiene enlaces «Volver al chat»; todas se
ven con la barra lateral y la tipografía/paleta nuevas; login y registro siguen funcionando.

---

## 10. F9 · Limpieza y documentación

1. Borra `components/chat/sidebar.tsx`, `components/chat/settings-form.tsx` y
   `components/chat/connectors-panel.tsx`. Comprueba con `grep -rn "chat/sidebar\|settings-form\|connectors-panel" app components`
   que no queda ninguna importación.
2. `PromptSuggestion` puede quedarse en `components/ui/` aunque no se use.
3. Busca restos de la paleta vieja: `grep -rn "text-green-600\|text-amber-600\|bg-secondary text-secondary-foreground" components`
   y sustitúyelos por `text-success`, `text-warning` y `bg-surface-2 text-fg`.
4. En `docs/decisiones-mvp.md` añade una sección corta «Rework de la UI (estilo Perplexity)» con:
   shell compartido en `app/(app)`, fijados y proyectos (tabla `projects`, columnas
   `threads.pinned_at` y `threads.project_id`), ajustes en modal con hash `#settings/<sección>` y
   preferencias en `localStorage["nexus.prefs"]`.
5. Asegúrate de que `docs/rework-ui-perplexity.md` (copia de este plan) está en el repo.

---

## 11. Verificación

### Automática
```bash
npm run typecheck
npm test            # incluye sections, sources (shortDomain), prefs y settings-search
npm run build       # descarga Geist; debe compilar sin avisos de rutas duplicadas
```

### Base de datos
```bash
npm run migrate && npm run migrate   # idempotente: la segunda pasada no falla
```
(o `docker compose build app && APP_PORT=3010 docker compose up -d`, que migra al arrancar).

### Manual (con `npm run dev` o docker, en claro y en oscuro, a 1440 px y a 390 px)
1. **Portada**: logo, «¿Qué quieres saber?», compositor centrado de ~700 px, segmentos
   Búsqueda/Research, «+» con Subir archivos / Fuentes / Interfaz, selector de modelo con el nombre
   del modelo configurado, botón circular claro deshabilitado sin texto. Compárala con la captura 1.
2. **Hilo**: enviar una pregunta → titular, pestañas, «Pensando…» animado, pasos de búsqueda,
   tarjetas de fuentes, citas con dominio (hover = tarjeta), «Reescribir», copiar, pulgares,
   «Relacionado» con «+». La pestaña «Fuentes · N» lista todas. Cancelar, editar y regenerar
   funcionan. Recargar a mitad de respuesta reengancha el run.
3. **Barra lateral**: Nuevo / Agentes / Conectores / Uso; Fijados aparece al fijar; crear proyecto,
   «Nuevo chat aquí» crea el hilo dentro del proyecto (aparece bajo él tras la primera respuesta);
   mover y quitar; borrar el proyecto deja sus chats en Recientes; las secciones recuerdan si están
   plegadas; Ctrl+B pliega a iconos.
4. **Menú de usuario**: coincide con la captura 2; Apariencia cambia el tema al momento.
5. **Ajustes**: Ctrl+, abre el modal (captura 3); navegar entre secciones cambia el hash; búsqueda
   filtra; guardar un proveedor y una clave; añadir y borrar un conector; las preferencias cambian el
   foco/modo por defecto del compositor sin recargar. Un usuario nuevo sin clave que pregunta ve el
   modal en «Modelos y claves» con el aviso.
6. **Ctrl+K**: busca por título y contenido; Enter abre el chat; las acciones navegan.
7. **Otras páginas**: `/agents`, `/agents/new`, `/agents/<id>`, `/inbox`, `/usage`, `/settings`,
   `/login`, `/register` y un enlace `/s/<slug>` se ven con el nuevo estilo y funcionan.
8. **Móvil (390 px)**: la barra lateral es un panel deslizante; el compositor no desborda; el modal
   de ajustes usa el `Select` de secciones.
9. **Accesibilidad**: navegación completa con teclado (Tab/Enter/Escape), foco visible en verde
   azulado, todos los botones de icono con `aria-label`.

---

## 12. Fuera de alcance (no implementar)

- Logo, nombre o textos de Perplexity; «Términos de servicio», planes «Pro/Max», «Añade tu equipo»,
  modo incógnito, voz y micrófono, «Computer», «Artefactos», «Plugins» (no existen en Nexus).
- Instrucciones o archivos por proyecto (los proyectos solo agrupan chats).
- Agrupar citas consecutivas en un chip «dominio +2» (requiere cambiar `remarkCitations`).
- Favicons remotos (decisión de privacidad ya documentada en `components/ui/source.tsx`).
- Cambiar idioma de la interfaz.
