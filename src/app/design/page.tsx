import { AvatarDesignStudio } from '@/components/avatar-design-studio';
import { ProductShell } from '@/components/product-shell';
import { findDefaultAvatar } from '@/lib/avatar-catalog';
import type { CreatorTab } from '@/components/avatar-design-studio';

type DesignPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CREATOR_TABS = new Set<CreatorTab>(['appearance', 'voice', 'expression', 'motion']);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DesignPage({ searchParams }: DesignPageProps) {
  const params = await searchParams;
  const avatarId = firstValue(params.avatar);
  const requestedTab = firstValue(params.tab);
  const legacyDriveTab = firstValue(params.driveTab);
  const initialTab: CreatorTab = requestedTab === 'model'
    ? 'expression'
    : requestedTab === 'drive'
      ? legacyDriveTab === 'motion' ? 'motion' : 'expression'
      : requestedTab && CREATOR_TABS.has(requestedTab as CreatorTab)
        ? requestedTab as CreatorTab
        : 'appearance';

  return (
    <ProductShell>
      <AvatarDesignStudio
        initialAvatar={findDefaultAvatar(avatarId)}
        initialAvatarId={avatarId}
        initialTab={initialTab}
      />
    </ProductShell>
  );
}
