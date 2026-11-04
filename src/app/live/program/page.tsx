import { LiveProgramOutput } from '@/components/live-program-output';

type LiveProgramPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LiveProgramPage({ searchParams }: LiveProgramPageProps) {
  const params = await searchParams;
  const sessionId = firstValue(params.session) || '';
  const orientation = firstValue(params.orientation) === 'landscape' ? 'landscape' : 'portrait';
  return <LiveProgramOutput sessionId={sessionId} orientation={orientation} />;
}
