import type { FloorAssetStatus, FloorModelFormat, FloorRequestStatus } from '@vistar/shared';
import { Chip } from '@/components/ui/chip';

export const REQUEST_STATUS_LABEL: Record<FloorRequestStatus, string> = {
  submitted: 'New',
  in_progress: 'In progress',
  published: 'Published',
  rejected: 'Rejected',
};
const REQUEST_TONE: Record<FloorRequestStatus, 'blue' | 'amber' | 'green' | 'red'> = {
  submitted: 'blue',
  in_progress: 'amber',
  published: 'green',
  rejected: 'red',
};

export function RequestStatusChip({ status }: { status: FloorRequestStatus }) {
  return (
    <Chip tone={REQUEST_TONE[status]} dot>
      {REQUEST_STATUS_LABEL[status]}
    </Chip>
  );
}

const ASSET_LABEL: Record<FloorAssetStatus, string> = {
  draft: 'Draft',
  published: 'Live',
  superseded: 'Replaced',
};
const ASSET_TONE: Record<FloorAssetStatus, 'neutral' | 'green' | 'grey'> = {
  draft: 'neutral',
  published: 'green',
  superseded: 'grey',
};

export function AssetStatusChip({ status }: { status: FloorAssetStatus }) {
  return (
    <Chip tone={ASSET_TONE[status]} dot={status === 'published'}>
      {ASSET_LABEL[status]}
    </Chip>
  );
}

export const FORMAT_LABEL: Record<FloorModelFormat, string> = {
  layout_json: 'Floor plan (AI)',
  glb: 'GLB model',
  gltf_zip: 'glTF (zip)',
};

export const TZ = 'Asia/Kolkata';
