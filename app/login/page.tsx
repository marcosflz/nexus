import { AuthForm } from "@/components/auth-form";
import { registrationOpen } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return <AuthForm mode="login" canRegister={await registrationOpen()} />;
}
