import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RoomView } from "@/components/rooms/room-view";
import { hasPermission } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "bots")) redirect("/");
  const { id } = await params;
  return (
    <Suspense>
      <RoomView key={id} roomId={id} />
    </Suspense>
  );
}
