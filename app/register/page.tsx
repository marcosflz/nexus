import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { registrationOpen } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Solo existe para crear la primera cuenta de la instancia (la de admin). */
export default async function RegisterPage() {
  if (!(await registrationOpen())) redirect("/login");
  return <AuthForm mode="register" />;
}
