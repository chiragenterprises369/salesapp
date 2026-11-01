import type {
  CustomObject,
  CustomRecord,
  CustomRecordListQuery,
  FieldDefinition,
  FieldTarget,
  LabelOverrides,
  LabelsResponse,
  Page,
  Pipeline,
  Stage,
  StageCreate,
  StageUpdate,
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
import { mockCustomizationSource } from './mock-source';

/**
 * Flexible data layer client (fields, custom objects, records, labels, pipelines and stages).
 * OWNER: orchestrator. Mirrors API_ROUTES (fieldList ... labelsUpdate, pipelineList, stage*).
 * Wave 1 uses the mock source over lib/mock-db; the HTTP source replaces it without changing hooks.
 */
export interface CustomizationSource {
  listFields(query?: { target?: FieldTarget; includeArchived?: boolean }): Promise<FieldDefinition[]>;
  createField(body: z.input<typeof FieldDefinitionCreateSchema>): Promise<FieldDefinition>;
  updateField(id: string, patch: z.input<typeof FieldDefinitionUpdateSchema>): Promise<FieldDefinition>;
  archiveField(id: string): Promise<FieldDefinition>;
  restoreField(id: string): Promise<FieldDefinition>;
  reorderFields(target: FieldTarget, fieldIds: string[]): Promise<FieldDefinition[]>;

  listObjects(query?: { includeArchived?: boolean }): Promise<CustomObject[]>;
  getObject(key: string): Promise<CustomObject>;
  createObject(body: z.input<typeof CustomObjectCreateSchema>): Promise<CustomObject>;
  updateObject(key: string, patch: z.input<typeof CustomObjectUpdateSchema>): Promise<CustomObject>;
  archiveObject(key: string): Promise<CustomObject>;
  restoreObject(key: string): Promise<CustomObject>;

  listRecords(objectKey: string, query?: Partial<CustomRecordListQuery>): Promise<Page<CustomRecord>>;
  getRecord(objectKey: string, id: string): Promise<CustomRecord>;
  createRecord(objectKey: string, body: z.input<typeof CustomRecordCreateSchema>): Promise<CustomRecord>;
  updateRecord(objectKey: string, id: string, patch: z.input<typeof CustomRecordUpdateSchema>): Promise<CustomRecord>;
  deleteRecord(objectKey: string, id: string): Promise<void>;

  getLabels(): Promise<LabelsResponse>;
  updateLabels(overrides: LabelOverrides): Promise<LabelsResponse>;

  listPipelines(): Promise<Pipeline[]>;
  createStage(pipelineId: string, body: Partial<StageCreate> & Pick<StageCreate, 'name'>): Promise<Stage>;
  updateStage(stageId: string, patch: StageUpdate): Promise<Stage>;
  reorderStages(pipelineId: string, stageIds: string[]): Promise<Pipeline>;
  deleteStage(stageId: string): Promise<void>;
}

export function getCustomizationSource(): CustomizationSource {
  return mockCustomizationSource;
}
