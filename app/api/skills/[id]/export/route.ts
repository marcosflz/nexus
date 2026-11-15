import { ownedSkill, skillVersion } from "@/lib/skills/store";
import { skillRoute } from "@/lib/skills/http";
import { skillOperation } from "@/lib/skills/sidecar";

export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return skillRoute(async (user) => {
    const skill = await ownedSkill(user.id, (await ctx.params).id);
    if (!skill) return Response.json({ error: "Skill no encontrada" }, { status: 404 });
    const version = await skillVersion(user.id, new URL(req.url).searchParams.get("version") ?? skill.currentVersionId ?? "");
    if (!version || version.skillId !== skill.id) throw new Error("Versión no encontrada");
    const result = await skillOperation({ op: "export", package: version.package });
    return new Response(Buffer.from(result.archive!, "base64"), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${version.package.manifest.name}.zip"` } });
  });
}
