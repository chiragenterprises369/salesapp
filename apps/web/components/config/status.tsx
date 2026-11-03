import type { ChipTone, ConfigGroupStatus, ConfigValueSource } from '@vistar/shared';
import { Chip } from '@/components/ui/chip';

export const GROUP_STATUS: Record<ConfigGroupStatus, { label: string; tone: ChipTone; hint: string }> = {
  configured: { label: 'Configured', tone: 'green', hint: 'Every required value is saved in the panel.' },
  missing: { label: 'Missing', tone: 'red', hint: 'A required value is not set; the feature is off or refuses to work.' },
  env_fallback: { label: 'Env fallback', tone: 'amber', hint: 'Works, but some values still come from the server environment. Save them here.' },
  dev_default: { label: 'Dev default', tone: 'amber', hint: 'Works only because of a development default. Production never uses it.' },
};

export function GroupStatusChip({ status, size }: { status: ConfigGroupStatus; size?: 'sm' | 'md' }) {
  const s = GROUP_STATUS[status];
  return (
    <Chip tone={s.tone} dot size={size}>
      {s.label}
    </Chip>
  );
}

export const SOURCE_LABEL: Record<ConfigValueSource, string> = {
  panel: 'Saved in the panel',
  env: 'Using env fallback',
  default: 'Using the default',
  dev_default: 'Development default',
  none: 'Not set',
};
