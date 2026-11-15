import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
// Prosa de las respuestas (como la lectura de Perplexity); la interfaz sigue en Geist.
const serif = Source_Serif_4({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-serif-answer",
});

export const metadata: Metadata = {
  title: "Nexus",
  description: "Buscador con IA open source, autoalojado y con tus propias claves",
  // «Añadir a pantalla de inicio»: se abre a pantalla completa, sin la barra del navegador.
  appleWebApp: { capable: true, title: "Nexus", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Ocupa también la zona del notch y del indicador de inicio; el relleno va con env(safe-area-*).
  viewportFit: "cover",
  // El teclado encoge el área útil, así el compositor queda siempre a la vista.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcf9" },
    { media: "(prefers-color-scheme: dark)", color: "#191a1a" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes añade la clase del tema antes de hidratar.
    <html lang="es" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <body className="min-h-svh bg-bg text-fg antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
