"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NexusLogo } from "@/components/brand/logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  mode: "login" | "register";
  /** La instancia aún no tiene cuentas: se puede crear la primera. */
  canRegister?: boolean;
}

const COPY = {
  login: {
    title: "Bienvenido a Nexus",
    description: "Tu buscador con IA, con tus propias claves.",
    endpoint: "/api/auth/login",
    submit: "Entrar",
    busy: "Entrando…",
    fallbackError: "No se pudo iniciar sesión",
    next: "/",
    alt: { text: "Instalación nueva.", link: "Crear la cuenta de administrador", href: "/register" },
    autoComplete: "current-password",
  },
  register: {
    title: "Crea la cuenta de administrador",
    description: "Es la primera cuenta de esta instalación (superadmin). Desde ella podrás crear las de los demás.",
    endpoint: "/api/auth/register",
    submit: "Crear cuenta",
    busy: "Creando…",
    fallbackError: "No se pudo crear la cuenta",
    next: "/settings?seccion=models",
    alt: { text: "¿Ya tienes cuenta?", link: "Entrar", href: "/login" },
    autoComplete: "new-password",
  },
} as const;

/** Formulario compartido de acceso y registro. */
export function AuthForm({ mode, canRegister = false }: Props) {
  const copy = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(copy.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      window.location.href = copy.next;
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? copy.fallbackError);
    setBusy(false);
  }

  return (
    <main className="bg-bg flex min-h-svh flex-col items-center justify-center px-4">
      <NexusLogo className="text-fg size-10" />
      <h1 className="mt-5 text-center text-[28px] font-normal tracking-tight">{copy.title}</h1>
      <p className="text-muted-fg mt-2 max-w-sm text-center text-[14px]">{copy.description}</p>
      <form onSubmit={submit} className="mt-8 w-full max-w-sm space-y-3">
        <Label htmlFor="email" className="sr-only">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="bg-surface h-11 rounded-xl px-4 text-[15px]"
        />
        <Label htmlFor="password" className="sr-only">
          Contraseña
        </Label>
        <Input
          id="password"
          type="password"
          required
          minLength={mode === "register" ? 8 : undefined}
          autoComplete={copy.autoComplete}
          placeholder="Contraseña"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="bg-surface h-11 rounded-xl px-4 text-[15px]"
        />
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl text-[15px]">
          {busy ? copy.busy : copy.submit}
        </Button>
      </form>
      {mode === "login" && !canRegister ? (
        <p className="text-muted-fg mt-6 text-sm">Las cuentas las crea un administrador.</p>
      ) : (
        <p className="text-muted-fg mt-6 text-sm">
          {copy.alt.text}{" "}
          <Link href={copy.alt.href} className="text-fg underline underline-offset-4">
            {copy.alt.link}
          </Link>
        </p>
      )}
    </main>
  );
}
