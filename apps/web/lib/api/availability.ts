import type { ApiRouteId } from '@vistar/shared';
import { ApiRequestError } from '../api-error';

/**
 * Routes that are in the shared contract but not served by the API this web build targets yet
 * (wave A: REALTIME builds presence, calls, conversations and the Team Floor snapshot; workflows,
 * integrations, audit and the Super Admin companies arrive later). In API mode the hooks for these
 * return honest empty results WITHOUT a request, so pages show their empty states and the browser
 * console stays free of 404s. Remove a route from this set when its endpoint ships.
 */
export const PENDING_ROUTES: ReadonlySet<ApiRouteId> = new Set<ApiRouteId>([
  // presence and live status (REALTIME)
  'myStatusUpdate',
  'myPresenceGet',
  'myPresenceHeartbeat',
  'teamFloorSnapshot',
  'attendanceRegister',
  'myAttendanceToday',
  // calls and WhatsApp (REALTIME)
  'callList',
  'callGet',
  'callCreate',
  'callUpdate',
  'callRecording',
  'conversationList',
  'conversationGet',
  'messageList',
  'messageSend',
  'conversationAssign',
  'conversationRead',
  'templateList',
  'quickReplyList',
  // automation and integrations (later waves)
  'workflowList',
  'workflowGet',
  'workflowRunList',
  'workflowRunGet',
  'leadRunWorkflow',
  'integrationList',
  'webhookEndpointList',
  'webhookDeliveryList',
  'auditList',
  'attentionResolve',
  // Super Admin console (PLATFORM, this wave)
  'superOverview',
  'superCompanyList',
  'superCompanyGet',
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

/** Empty cursor page (what a list route returns for a new company). */
export const emptyPage = <T>() => ({ items: [] as T[], nextCursor: null as string | null, total: 0 });
