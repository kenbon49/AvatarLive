import { AvatarDesignStudio } from '@/components/avatar-design-studio';
import { ProductShell } from '@/components/product-shell';
import { findDefaultAvatar } from '@/lib/avatar-catalog';
import type { AvatarDriveTab } from '@/components/avatar-capability-panel';
import type { CreatorTab } from '@/components/avatar-design-studio';

type DesignPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CREATOR_TABS = new Set<CreatorTab>(['appearance', 'voice', 'background', 'persona', 'model', 'drive', 'style']);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DesignPage({ searchParams }: DesignPageProps) {
  const params = await searchParams;
  const avatarId = firstValue(params.avatar);
  const requestedTab = firstValue(params.tab) as CreatorTab | undefined;
  const requestedDriveTab = firstValue(params.driveTab) as AvatarDriveTab | undefined;
  const initialTab = requestedTab && CREATOR_TABS.has(requestedTab) ? requestedTab : 'appearance';
  const initialDriveTab = requestedDriveTab === 'motion' ? 'motion' : 'expression';

  return (
    <ProductShell>
      <AvatarDesignStudio
        initialAvatar={findDefaultAvatar(avatarId)}
        initialAvatarId={avatarId}
        initialDriveTab={initialDriveTab}
        initialTab={initialTab}
      />
    </ProductShell>
  );
}
