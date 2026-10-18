import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plexo",
  description: "Buscador con IA open source, autoalojado y con tus propias claves",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
