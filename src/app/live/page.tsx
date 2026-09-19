import { LiveStudio } from '@/components/live-studio';

type LivePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LivePage({ searchParams }: LivePageProps) {
  const params = await searchParams;
  const requestedDialog = firstValue(params.dialog);
  const dialog = requestedDialog === 'settings' || requestedDialog === 'voice' ? requestedDialog : undefined;
  const entered = firstValue(params.studio) === '1' || firstValue(params.demo) === '1' || Boolean(dialog);
  return (
    <LiveStudio
      dialog={dialog}
      entered={entered}
    />
  );
}
