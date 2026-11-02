import type { ApiRouteId } from '@vistar/shared';
import { ApiRequestError } from '../api-error';

/**
 * Routes that are in the shared contract but not served by the API this web build targets yet.
 * In API mode the hooks for these return honest empty results WITHOUT a request, so pages show their
 * empty states and the browser console stays free of 404s. Remove a route from this set when its
 * endpoint ships (`git grep "ApiRoute(API_ROUTES.<id>"` in apps/api shows the served ones).
 *
 * Served since change #19 wave A (REALTIME): presence and PUT /me/status, the Team Floor snapshot,
 * calls list/get/update, attendance, conversations, messages, templates and quick replies.
 * Super Admin companies (PLATFORM, this wave) are called directly and treat a 404 as "not yet".
 */
export const PENDING_ROUTES: ReadonlySet<ApiRouteId> = new Set<ApiRouteId>([
  // calls: click-to-call through a provider and recording URLs (later waves; SIM calls come from the app)
  'callCreate',
  'callRecording',
  // office zones (REALTIME, after wave A)
  'myZoneSignal',
  'officeMarkerList',
  'officeMarkerCreate',
  'officeMarkerDelete',
  // automation and integrations (later waves)
  'workflowList',
  'workflowGet',
  'workflowRunList',
  'workflowRunGet',
  'leadRunWorkflow',
  'integrationList',
  'webhookEndpointList',
  'webhookDeliveryList',
  'apiKeyList',
  'templateSync',
  'auditList',
  'attentionResolve',
  // Super Admin console parts not in this wave
  'superOverview',
  'superPlanList',
  'superAuditList',
  'superImpersonateStart',
  'superImpersonateEnd',
]);

export const isRouteLive = (id: ApiRouteId): boolean => !PENDING_ROUTES.has(id);

/** Thrown by actions whose endpoint has not shipped (the UI shows the message). */
export function notAvailableYet(what: string): ApiRequestError {
  return new ApiRequestError('SERVICE_UNAVAILABLE', `${what} is not available yet. It arrives with the next Vistar update.`, [], { status: 0 });
}

/** True for the 404 an API answers when a route is in the contract but its module is not deployed. */
export function isRouteMissing(e: unknown): boolean {
  return e instanceof ApiRequestError && e.status === 404;
}

/** Empty cursor page (what a list route returns for a new company). */
export const emptyPage = <T>() => ({ items: [] as T[], nextCursor: null as string | null, total: 0 });
