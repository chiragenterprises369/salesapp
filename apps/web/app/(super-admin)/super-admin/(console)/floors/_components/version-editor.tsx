'use client';

import { seatMapFromPlan, type FloorAsset, type FloorPlan, type SeatMap } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Redo2, RefreshCw, Rocket, Save, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { usePermissions } from '@/lib/session/session';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { PLAN, StaticPlan } from '@/features/team-floor/flat/floor-map';
import {
  fetchFloorPlan,
  fetchModelBytes,
  floorKey,
  setCustomModelBytes,
} from '@/features/team-floor/state/layout/published';
import {
  templateFromModel,
  templateFromPlan,
} from '@/features/team-floor/state/layout/plan-template';
import type { FloorTemplate } from '@/features/team-floor/state/template';
import type { TopView } from '@/features/team-floor/scene/top-view';
import { useFloorVersion, usePublishFloor, useSaveSeatMap, useSuperFloorRequest } from './data';
import { FloorPreview } from './floor-preview';
import { Inspector } from './inspector';
import { seatMapProblems, useSeatMapHistory, type Selection } from './seat-model';
import { SeatToolCanvas, type Bounds } from './seat-tool';
import { AssetStatusChip, FORMAT_LABEL, TZ } from './status';

/** One floor version: seat tool, 3D and flat preview (Day and Evening), save and publish (SPEC 29.5, 29.11). */
export function FloorVersionEditor({ id }: { id: string }) {
  const version = useFloorVersion(id);
  const asset = version.data;
  const url = asset?.model.url ?? null;
  const plan = useQuery({
    queryKey: ['platform', 'floors', 'plan', id],
    queryFn: () => fetchFloorPlan(asset!.id, asset!.version, url!),
    enabled: !!asset && asset.format === 'layout_json' && !!url,
    staleTime: Infinity,
  });
  const bytes = useQuery({
    queryKey: ['platform', 'floors', 'bytes', id],
    queryFn: () => fetchModelBytes(asset!.id, asset!.version, url!),
    enabled: !!asset && asset.format !== 'layout_json' && !!url,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  const request = useSuperFloorRequest(asset?.requestId ?? '', !!asset?.requestId);

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link
        href={
          asset?.requestId
            ? `/super-admin/floors/requests/${asset.requestId}`
            : '/super-admin/floors'
        }
      >
        <ArrowLeft aria-hidden />
        {asset?.requestId ? 'Back to the request' : 'All requests'}
      </Link>
    </Button>
  );

  const source = asset?.format === 'layout_json' ? plan : bytes;
  if (version.isPending || (asset && url && source.isPending)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the floor version">
        <Skeleton className="h-10 w-96" />
        <div className="grid gap-4 2xl:grid-cols-2">
          <Skeleton className="h-[520px] rounded-lg" />
          <Skeleton className="h-[520px] rounded-lg" />
        </div>
      </div>
    );
  }
  if (version.isError || !asset || source.isError || !url) {
    const missing = isApiRequestError(version.error) && version.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <div>{back}</div>
        <EmptyState
          title={missing ? 'This floor version was not found' : 'The floor version did not load'}
          description={
            source.isError
              ? 'The floor file did not download or is not a valid floor. Upload it again from the request page.'
              : 'Check your connection, then try again.'
          }
          action={
            missing ? undefined : (
              <Button
                onClick={() => {
                  void version.refetch();
                  void source.refetch();
                }}
              >
                <RefreshCw aria-hidden />
                Try again
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <RequirePermission anyOf={['platform.companies.read']}>
      <Editor
        key={`${asset.id}:${asset.updatedAt}`}
        asset={asset}
        plan={plan.data ?? null}
        bytes={bytes.data ?? null}
        headcount={request.data?.headcount ?? null}
        company={request.data?.workspaceName ?? null}
        back={back}
      />
    </RequirePermission>
  );
}

const EMPTY_MODEL_MAP: SeatMap = {
  schemaVersion: 1,
  units: 'm',
  scale: 1,
  origin: [0, 0, 0],
  seats: [],
  zones: [],
};

function Editor({
  asset,
  plan,
  bytes,
  headcount,
  company,
  back,
}: {
  asset: FloorAsset;
  plan: FloorPlan | null;
  bytes: ArrayBuffer | null;
  headcount: number | null;
  company: string | null;
  back: ReactNode;
}) {
  const canManage = usePermissions().includes('platform.companies.manage');
  const readOnly = !canManage || asset.status === 'superseded';
  const theme = useDocumentTheme();
  const initial = useMemo<SeatMap>(
    () => asset.seatMap ?? (plan ? seatMapFromPlan(plan) : EMPTY_MODEL_MAP),
    [asset.seatMap, plan],
  );
  const history = useSeatMapHistory(initial);
  const map = history.map;
  const [baseline, setBaseline] = useState(() =>
    asset.seatMap ? JSON.stringify(asset.seatMap) : '',
  );
  const dirty = JSON.stringify(map) !== baseline;
  const [selection, setSelection] = useState<Selection>(null);
  const save = useSaveSeatMap(asset.id);
  const publish = usePublishFloor(asset.id);
  const problems = seatMapProblems(map);
  const isModel = asset.format !== 'layout_json';

  // Uploaded models: a top view under the seats, redrawn when the placement changes.
  const [top, setTop] = useState<TopView | null>(null);
  const [placed, setPlaced] = useState(!!asset.seatMap);
  const { scale, origin } = map;
  useEffect(() => {
    if (!bytes || !isModel) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void import('@/features/team-floor/scene/top-view')
        .then(({ renderTopView }) =>
          renderTopView(bytes, asset.format as 'glb' | 'gltf_zip', { scale, origin }),
        )
        .then((view) => {
          if (!cancelled) setTop(view);
        })
        .catch(() => {
          if (!cancelled)
            toast.error(
              'The model could not be drawn from above. Check that it is a valid glTF 2.0 file.',
            );
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bytes, isModel, asset.format, scale, origin]);

  // First open of a model without seats: put its corner at 0, 0 and add one zone over the whole office.
  if (isModel && top && !placed) {
    setPlaced(true);
    const [x0, y0, z0] = top.raw.min;
    const [x1, , z1] = top.raw.max;
    const w = Math.round((x1 - x0) * 100) / 100;
    const d = Math.round((z1 - z0) * 100) / 100;
    history.reset({
      ...map,
      origin: [x0, y0, z0],
      zones: map.zones.length
        ? map.zones
        : [
            {
              id: 'office',
              name: 'Office',
              kind: 'work_area',
              polygon: [
                [0, 0],
                [Math.max(1, w), 0],
                [Math.max(1, w), Math.max(1, d)],
                [0, Math.max(1, d)],
              ],
            },
          ],
    });
  }

  const bgTemplate = useMemo(
    () =>
      plan
        ? templateFromPlan(plan, seatMapFromPlan(plan), {
            key: `bg:${asset.id}`,
            floorId: asset.id,
            version: asset.version,
          })
        : null,
    [plan, asset.id, asset.version],
  );
  const bounds: Bounds = plan
    ? { minX: 0, minZ: 0, maxX: plan.size.width, maxZ: plan.size.depth }
    : top
      ? top.bounds
      : boundsOf(map);
  const background = bgTemplate ? (
    <StaticPlan template={bgTemplate} c={PLAN[theme]} label={0.32} hideSeats />
  ) : top ? (
    <image
      href={top.url}
      x={top.bounds.minX}
      y={top.bounds.minZ}
      width={top.bounds.maxX - top.bounds.minX}
      height={top.bounds.maxZ - top.bounds.minZ}
      preserveAspectRatio="none"
      opacity={0.95}
    />
  ) : null;

  // Preview follows the draft (debounced so dragging stays smooth).
  const [previewMap, setPreviewMap] = useState(map);
  useEffect(() => {
    const t = setTimeout(() => setPreviewMap(map), 500);
    return () => clearTimeout(t);
  }, [map]);
  const preview = useMemo((): { template: FloorTemplate | null; problem: string | null } => {
    if (!previewMap.seats.length)
      return { template: null, problem: 'Place at least one seat to see the preview.' };
    try {
      const key = floorKey(asset.id, asset.version, previewMap);
      if (plan)
        return {
          template: templateFromPlan(plan, previewMap, {
            key,
            floorId: asset.id,
            version: asset.version,
          }),
          problem: null,
        };
      if (!bytes) return { template: null, problem: null };
      setCustomModelBytes(key, bytes);
      return {
        template: templateFromModel(previewMap, {
          key,
          floorId: asset.id,
          version: asset.version,
          format: asset.format as 'glb' | 'gltf_zip',
        }),
        problem: null,
      };
    } catch (e) {
      return {
        template: null,
        problem: `The preview needs a valid seat map: ${e instanceof Error ? e.message.split('\n')[0] : 'check the seats and zones'}.`,
      };
    }
  }, [previewMap, plan, bytes, asset.id, asset.version, asset.format]);

  async function onSave(): Promise<boolean> {
    if (problems.length) {
      toast.error(problems[0]!);
      return false;
    }
    try {
      const saved = await save.mutateAsync(map);
      setBaseline(JSON.stringify(saved.seatMap ?? map));
      toast.success(
        saved.status === 'published'
          ? 'Seats saved. The live floor updates for the company now.'
          : 'Seats saved.',
      );
      return true;
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : 'The seats were not saved. Try again.');
      return false;
    }
  }

  async function onPublish() {
    if ((dirty || !asset.seatMap) && !(await onSave())) return;
    try {
      const live = await publish.mutateAsync();
      toast.success(`Version ${live.version} is live on ${company ?? "the company's"} Team Floor.`);
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : 'The floor was not published. Try again.');
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey && history.canUndo) history.undo();
    else if ((k === 'z' && e.shiftKey) || k === 'y') {
      if (history.canRedo) history.redo();
    } else if (k === 's' && !readOnly) void onSave();
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKey}>
      <div>{back}</div>
      <PageHeader
        title={`${company ?? 'Company'} · floor v${asset.version}`}
        meta={
          <>
            <AssetStatusChip status={asset.status} />
            {dirty && !readOnly && (
              <span className="text-xs text-warning-text">Unsaved changes</span>
            )}
          </>
        }
        description={`${FORMAT_LABEL[asset.format]} · uploaded ${formatDateTimeIn(asset.createdAt, TZ)}${asset.publishedAt ? ` · published ${formatDateTimeIn(asset.publishedAt, TZ)}` : ''}`}
        actions={
          readOnly ? undefined : (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Undo (Ctrl+Z)"
                title="Undo (Ctrl+Z)"
                disabled={!history.canUndo}
                onClick={history.undo}
              >
                <Undo2 aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Redo (Ctrl+Shift+Z)"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!history.canRedo}
                onClick={history.redo}
              >
                <Redo2 aria-hidden />
              </Button>
              <Button
                onClick={() => void onSave()}
                disabled={!dirty && !!asset.seatMap}
                loading={save.isPending}
              >
                <Save aria-hidden />
                Save seats
              </Button>
              <Button
                variant="primary"
                onClick={() => void onPublish()}
                disabled={problems.length > 0 || (asset.status === 'published' && !dirty)}
                loading={publish.isPending}
              >
                <Rocket aria-hidden />
                {asset.status === 'published'
                  ? dirty
                    ? 'Save and update live floor'
                    : 'Live'
                  : dirty || !asset.seatMap
                    ? 'Save and publish'
                    : 'Publish'}
              </Button>
            </>
          )
        }
        className="mb-0"
      />
      {asset.status === 'superseded' && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg-secondary">
          A newer version replaced this one. It is read-only; upload a new version to change the
          floor.
        </p>
      )}
      {problems.length > 0 && !readOnly && (
        <div
          role="status"
          className="rounded-md border border-status-amber-border bg-status-amber-bg px-3 py-2 text-xs text-status-amber-fg"
        >
          <p className="font-semibold">Before you save</p>
          <ul className="mt-0.5 list-disc pl-4">
            {problems.slice(0, 6).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="pt-4">
              {isModel && !top ? (
                <Skeleton
                  className="aspect-[3/2] w-full rounded-md"
                  aria-label="Drawing the model from above"
                />
              ) : (
                <SeatToolCanvas
                  map={map}
                  onChange={history.set}
                  selection={selection}
                  onSelect={setSelection}
                  background={background}
                  bounds={bounds}
                  readOnly={readOnly}
                />
              )}
            </CardContent>
          </Card>
          <Inspector
            map={map}
            onChange={(next) => history.set(next)}
            selection={selection}
            onSelect={setSelection}
            readOnly={readOnly}
            model={isModel ? { raw: top?.raw ?? null } : null}
            headcount={headcount}
          />
        </div>
        <FloorPreview
          template={preview.template}
          problem={preview.problem}
          loading={isModel && !bytes}
        />
      </div>
    </div>
  );
}

function boundsOf(map: SeatMap): Bounds {
  let minX = 0;
  let minZ = 0;
  let maxX = 10;
  let maxZ = 8;
  for (const z of map.zones)
    for (const [x, zz] of z.polygon) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, zz);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, zz);
    }
  for (const s of map.seats) {
    minX = Math.min(minX, s.position[0]);
    minZ = Math.min(minZ, s.position[2]);
    maxX = Math.max(maxX, s.position[0]);
    maxZ = Math.max(maxZ, s.position[2]);
  }
  return { minX, minZ, maxX, maxZ };
}
