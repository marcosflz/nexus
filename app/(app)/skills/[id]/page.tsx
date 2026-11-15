import { SkillDetail } from "@/components/skills/library";

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  return <SkillDetail id={(await params).id} />;
}
