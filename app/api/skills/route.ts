import { skillRoute } from "@/lib/skills/http";
import { skillGallery, skillLibrary } from "@/lib/skills/store";

export const runtime = "nodejs";
export async function GET() {
  return skillRoute(async (user) => Response.json({ skills: await skillLibrary(user.id), gallery: await skillGallery() }));
}
