import type { LeadsSource } from './data';
import { api } from '../api/client';

/**
 * Leads over HTTP (API_ROUTES leadList ... leadMove). The API applies the caller's data scope
 * (own / team / all) to every list, board and detail query, so the hooks need no scoping logic.
 */
export const httpLeadsSource: LeadsSource = {
  list: (query) => api.call('leadList', { query }),
  board: (pipelineId, filters, perColumn) => api.call('pipelineBoard', { params: { id: pipelineId }, query: { ...filters, ...(perColumn ? { perColumn } : {}) } }),
  columnPage: (pipelineId, stageId, filters, cursor, limit) =>
    api.call('boardColumnPage', { params: { id: pipelineId, stageId }, query: { ...filters, cursor, ...(limit ? { limit } : {}) } }),
  get: (id) => api.call('leadGet', { params: { id } }),
  create: (input) => api.call('leadCreate', { body: input }),
  update: (id, patch) => api.call('leadUpdate', { params: { id }, body: patch }),
  bulk: (action) => api.call('leadBulk', { body: action }),
  move: (leadId, move) => api.call('leadMove', { params: { id: leadId }, body: move }),
};
