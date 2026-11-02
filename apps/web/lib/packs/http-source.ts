import { api, superApi } from '../api/client';
import type { PacksSource } from './source';

/** Industry Packs over HTTP (company: packList ... packLog; Super Admin registry: superPack*). */
export const httpPacksSource: PacksSource = {
  list: async () => (await api.call('packList')).items,
  runtime: () => api.call('packRuntime'),
  plan: (key, action, modes) => api.call('packPlan', { params: { key }, query: { action, ...(modes?.length ? { modes } : {}) } }),
  install: (key, body = {}) => api.call('packInstall', { params: { key }, body }),
  upgrade: (key) => api.call('packUpgrade', { params: { key } }),
  uninstall: (key) => api.call('packUninstall', { params: { key } }),
  log: async (key) => (await api.call('packLog', { params: { key } })).items,
  super: {
    list: async () => (await superApi.call('superPackList')).items,
    version: (key, version) => superApi.call('superPackVersion', { params: { key, version } }),
    setPlans: (key, body) => superApi.call('superPackPlans', { params: { key }, body }),
    setCompany: (key, workspaceId, body) => superApi.call('superPackCompany', { params: { key, workspaceId }, body }),
    usage: (key) => superApi.call('superPackUsage', { params: { key } }),
  },
};
