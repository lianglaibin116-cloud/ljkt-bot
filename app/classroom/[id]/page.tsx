import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';

export default async function ClassroomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ botEmbedded?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return (
    <ClassroomSurface classroomId={id} variant="page" teacherOnly={query.botEmbedded === '1'} />
  );
}
