import { SkillDraftEditor } from "@/components/skills/draft-editor";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  return <SkillDraftEditor id={(await params).id} />;
}
