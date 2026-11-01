'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LABELS,
  visibleFields,
  type CustomRecordListQuery,
  type FieldTarget,
  type LabelOverrides,
  type ResolvedLabels,
  type StageCreate,
  type StageUpdate,
} from '@vistar/shared';
import type { z } from 'zod';
import type {
  CustomObjectCreateSchema,
  CustomObjectUpdateSchema,
  CustomRecordCreateSchema,
  CustomRecordUpdateSchema,
  FieldDefinitionCreateSchema,
  FieldDefinitionUpdateSchema,
} from '@vistar/shared';
import { useMe } from '../session/session';
import { getCustomizationSource } from './source';

/**
 * Hooks for the flexible data layer. OWNER: orchestrator. Query keys start with SYNC_SCOPES
 * ('customization', 'records') so realtime `customization.changed` / `record.*` events and resyncs
 * invalidate them. Stage changes also refresh the Board and lists ('board', 'leads').
 */
export const customizationKeys = {
  all: ['customization'] as const,
  fields: (q: { target?: FieldTarget; includeArchived?: boolean } = {}) => ['customization', 'fields', q] as const,
  objects: (q: { includeArchived?: boolean } = {}) => ['customization', 'objects', q] as const,
  object: (key: string) => ['customization', 'object', key] as const,
  labels: () => ['customization', 'labels'] as const,
  pipelines: () => ['customization', 'pipelines'] as const,
  /** Pack runtime (lib/packs) lives under the same scope so any customization change refreshes it. */
  runtime: () => ['customization', 'runtime'] as const,
};

export const recordKeys = {
  all: ['records'] as const,
  object: (objectKey: string) => ['records', objectKey] as const,
  list: (objectKey: string, q: Partial<CustomRecordListQuery>) => ['records', objectKey, 'list', q] as const,
  detail: (objectKey: string, id: string) => ['records', objectKey, 'detail', id] as const,
};

const src = () => getCustomizationSource();
const invalidateCustomization = (qc: QueryClient) => qc.invalidateQueries({ queryKey: customizationKeys.all });

// ---------------------------------------------------------------- fields

/** Field definitions. Pass a target for one entity/object; archived fields only with includeArchived. */
export function useFieldDefinitions(target?: FieldTarget, opts: { includeArchived?: boolean } = {}) {
  const q = { ...(target ? { target } : {}), ...(opts.includeArchived ? { includeArchived: true } : {}) };
  return useQuery({ queryKey: customizationKeys.fields(q), queryFn: () => src().listFields(q) });
}

/** Active fields of a target that the signed-in role may see, in display order (forms, detail panels). */
export function useVisibleFields(target: FieldTarget) {
  const me = useMe();
  const q = useFieldDefinitions(target);
  return { ...q, data: q.data ? visibleFields(q.data, target, me?.role.key) : undefined };
}

export function useCreateField() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: z.input<typeof FieldDefinitionCreateSchema>) => src().createField(body), onSuccess: () => invalidateCustomization(qc) });
}
export function useUpdateField() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: z.input<typeof FieldDefinitionUpdateSchema> }) => src().updateField(id, patch), onSuccess: () => invalidateCustomization(qc) });
}
export function useArchiveField() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => src().archiveField(id), onSuccess: () => invalidateCustomization(qc) });
}
export function useRestoreField() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => src().restoreField(id), onSuccess: () => invalidateCustomization(qc) });
}
export function useReorderFields() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ target, fieldIds }: { target: FieldTarget; fieldIds: string[] }) => src().reorderFields(target, fieldIds), onSuccess: () => invalidateCustomization(qc) });
}

// ---------------------------------------------------------------- objects

export function useCustomObjects(opts: { includeArchived?: boolean } = {}) {
  return useQuery({ queryKey: customizationKeys.objects(opts), queryFn: () => src().listObjects(opts) });
}
export function useCustomObject(key: string | null | undefined) {
  return useQuery({ queryKey: customizationKeys.object(key ?? ''), queryFn: () => src().getObject(key!), enabled: !!key });
}
export function useCreateObject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: z.input<typeof CustomObjectCreateSchema>) => src().createObject(body), onSuccess: () => invalidateCustomization(qc) });
}
export function useUpdateObject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ key, patch }: { key: string; patch: z.input<typeof CustomObjectUpdateSchema> }) => src().updateObject(key, patch), onSuccess: () => invalidateCustomization(qc) });
}
export function useArchiveObject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (key: string) => src().archiveObject(key), onSuccess: () => invalidateCustomization(qc) });
}
export function useRestoreObject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (key: string) => src().restoreObject(key), onSuccess: () => invalidateCustomization(qc) });
}

// ---------------------------------------------------------------- records

export function useRecords(objectKey: string, query: Partial<CustomRecordListQuery> = {}) {
  return useQuery({ queryKey: recordKeys.list(objectKey, query), queryFn: () => src().listRecords(objectKey, query), placeholderData: keepPreviousData, enabled: !!objectKey });
}
export function useRecord(objectKey: string, id: string | null | undefined) {
  return useQuery({ queryKey: recordKeys.detail(objectKey, id ?? ''), queryFn: () => src().getRecord(objectKey, id!), enabled: !!objectKey && !!id });
}
export function useCreateRecord(objectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof CustomRecordCreateSchema>) => src().createRecord(objectKey, body),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: recordKeys.object(objectKey) }), invalidateCustomization(qc)]),
  });
}
export function useUpdateRecord(objectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: z.input<typeof CustomRecordUpdateSchema> }) => src().updateRecord(objectKey, id, patch),
    onSuccess: (record) => {
      qc.setQueryData(recordKeys.detail(objectKey, record.id), record);
      return qc.invalidateQueries({ queryKey: [...recordKeys.object(objectKey), 'list'] });
    },
  });
}
export function useDeleteRecord(objectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => src().deleteRecord(objectKey, id),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: recordKeys.object(objectKey) }), invalidateCustomization(qc)]),
  });
}

// ---------------------------------------------------------------- labels

export function useLabelSettings() {
  return useQuery({ queryKey: customizationKeys.labels(), queryFn: () => src().getLabels() });
}

/** Resolved display labels: live query, else the session copy, else the defaults. Use with labelOf(). */
export function useLabels(): ResolvedLabels {
  const me = useMe();
  const q = useLabelSettings();
  return q.data?.labels ?? me?.labels ?? DEFAULT_LABELS;
}

export function useUpdateLabels() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (overrides: LabelOverrides) => src().updateLabels(overrides), onSuccess: () => invalidateCustomization(qc) });
}

// ---------------------------------------------------------------- pipelines and stages

export function usePipelines() {
  return useQuery({ queryKey: customizationKeys.pipelines(), queryFn: () => src().listPipelines() });
}

/** Default pipeline (Board, stage pickers). */
export function useDefaultPipeline() {
  const q = usePipelines();
  return { ...q, data: q.data?.find((p) => p.isDefault) ?? q.data?.[0] };
}

const invalidateStages = (qc: QueryClient) =>
  Promise.all([invalidateCustomization(qc), qc.invalidateQueries({ queryKey: ['board'] }), qc.invalidateQueries({ queryKey: ['leads'] })]);

export function useCreateStage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ pipelineId, body }: { pipelineId: string; body: Partial<StageCreate> & Pick<StageCreate, 'name'> }) => src().createStage(pipelineId, body), onSuccess: () => invalidateStages(qc) });
}
export function useUpdateStage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ stageId, patch }: { stageId: string; patch: StageUpdate }) => src().updateStage(stageId, patch), onSuccess: () => invalidateStages(qc) });
}
export function useReorderStages() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ pipelineId, stageIds }: { pipelineId: string; stageIds: string[] }) => src().reorderStages(pipelineId, stageIds), onSuccess: () => invalidateStages(qc) });
}
export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (stageId: string) => src().deleteStage(stageId), onSuccess: () => invalidateStages(qc) });
}
