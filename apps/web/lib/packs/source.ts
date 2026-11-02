import type {
  PackCompanyUsage,
  PackInstallLog,
  PackInstallRequest,
  PackInstallResult,
  PackListItem,
  PackPlanResponse,
  PackRuntime,
  PackUsage,
  SuperPack,
  SuperPackVersion,
} from '@vistar/shared';
import type { z } from 'zod';
import type { SuperPackCompanyUpdateSchema, SuperPackPlansUpdateSchema } from '@vistar/shared';
import { isMockData } from '../api/data-source';
import { httpPacksSource } from './http-source';
import { mockPacksSource } from './mock-source';

/**
 * Industry Packs client. OWNER: orchestrator. Mirrors API_ROUTES packList ... packLog and
 * superPack*. HTTP by default; the mock source (real planner over lib/mock-db) only in the test-only mock data mode.
 */
export interface PacksSource {
  list(): Promise<PackListItem[]>;
  runtime(): Promise<PackRuntime>;
  plan(key: string, action: 'install' | 'upgrade' | 'uninstall', modes?: string[]): Promise<PackPlanResponse>;
  install(key: string, body?: PackInstallRequest): Promise<PackInstallResult>;
  upgrade(key: string): Promise<PackInstallResult>;
  uninstall(key: string): Promise<PackInstallResult>;
  log(key: string): Promise<PackInstallLog[]>;
  super: {
    list(): Promise<SuperPack[]>;
    version(key: string, version: string): Promise<SuperPackVersion>;
    setPlans(key: string, body: z.input<typeof SuperPackPlansUpdateSchema>): Promise<SuperPack>;
    setCompany(key: string, workspaceId: string, body: z.input<typeof SuperPackCompanyUpdateSchema>): Promise<PackCompanyUsage>;
    usage(key: string): Promise<PackUsage>;
  };
}

export function getPacksSource(): PacksSource {
  return isMockData() ? mockPacksSource : httpPacksSource;
}
