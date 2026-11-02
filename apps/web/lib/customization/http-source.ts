import { api } from '../api/client';
import type { CustomizationSource } from './source';

/** Flexible data layer over HTTP (API_ROUTES fieldList ... labelsUpdate, pipelineList, stage*). */
export const httpCustomizationSource: CustomizationSource = {
  listFields: async (query = {}) => (await api.call('fieldList', { query })).items,
  createField: (body) => api.call('fieldCreate', { body }),
  updateField: (id, patch) => api.call('fieldUpdate', { params: { id }, body: patch }),
  archiveField: (id) => api.call('fieldArchive', { params: { id } }),
  restoreField: (id) => api.call('fieldRestore', { params: { id } }),
  reorderFields: async (target, fieldIds) => (await api.call('fieldReorder', { body: { target, fieldIds } })).items,

  listObjects: async (query = {}) => (await api.call('objectList', { query })).items,
  getObject: (key) => api.call('objectGet', { params: { key } }),
  createObject: (body) => api.call('objectCreate', { body }),
  updateObject: (key, patch) => api.call('objectUpdate', { params: { key }, body: patch }),
  archiveObject: (key) => api.call('objectArchive', { params: { key } }),
  restoreObject: (key) => api.call('objectRestore', { params: { key } }),

  listRecords: (objectKey, query = {}) => api.call('recordList', { params: { key: objectKey }, query }),
  getRecord: (objectKey, id) => api.call('recordGet', { params: { key: objectKey, id } }),
  createRecord: (objectKey, body) => api.call('recordCreate', { params: { key: objectKey }, body }),
  updateRecord: (objectKey, id, patch) => api.call('recordUpdate', { params: { key: objectKey, id }, body: patch }),
  deleteRecord: async (objectKey, id) => {
    await api.call('recordDelete', { params: { key: objectKey, id } });
  },

  getLabels: () => api.call('labelsGet'),
  updateLabels: (overrides) => api.call('labelsUpdate', { body: { overrides } }),

  listPipelines: async () => (await api.call('pipelineList')).items,
  createStage: (pipelineId, body) => api.call('stageCreate', { params: { id: pipelineId }, body }),
  updateStage: (stageId, patch) => api.call('stageUpdate', { params: { id: stageId }, body: patch }),
  reorderStages: (pipelineId, stageIds) => api.call('stageReorder', { params: { id: pipelineId }, body: { stageIds } }),
  deleteStage: async (stageId) => {
    await api.call('stageDelete', { params: { id: stageId } });
  },
};
