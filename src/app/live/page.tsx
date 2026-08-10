import { LiveStudio, type LiveStudioInitialState } from '@/components/live-studio';

type LivePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SETTINGS_TABS = new Set(['qa', 'dynamic', 'ambience', 'product', 'output', 'environment']);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LivePage({ searchParams }: LivePageProps) {
  const params = await searchParams;
  const requestedDialog = firstValue(params.dialog);
  const requestedSettingsTab = firstValue(params.settingsTab);
  const quality = firstValue(params.quality);
  const protocol = firstValue(params.protocol)?.toLowerCase();
  const dialog = requestedDialog === 'settings' || requestedDialog === 'voice' ? requestedDialog : undefined;
  const settingsTab = requestedSettingsTab && SETTINGS_TABS.has(requestedSettingsTab)
    ? requestedSettingsTab as NonNullable<LiveStudioInitialState['settingsTab']>
    : undefined;
  const entered = firstValue(params.studio) === '1' || firstValue(params.demo) === '1' || Boolean(dialog);
  const outputConfig = quality === '4k60-h265'
    ? {
        resolution: '4K',
        frameRate: '60 fps',
        codec: 'H.265',
        protocol: protocol === 'webrtc' ? 'WebRTC' : 'RTMP',
      }
    : undefined;

  return (
    <LiveStudio
      autoDetectEnvironment={firstValue(params.detect) === '1'}
      dialog={dialog}
      entered={entered}
      outputConfig={outputConfig}
      settingsTab={settingsTab}
    />
  );
}
