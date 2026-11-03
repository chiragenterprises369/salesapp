/**
 * Optional plan-limit check for API key creation (requests-19c B1). The billing module (BILLING-PDF, agent/crm-api)
 * owns PlanLimitsService; this branch cannot import it, so ApiKeysService takes it through a global symbol:
 *   billing module providers: { provide: PLAN_LIMIT_CHECK, useExisting: PlanLimitsService }, and export PLAN_LIMIT_CHECK.
 * Without that provider (this branch alone) the check is skipped.
 */
export const PLAN_LIMIT_CHECK = Symbol.for('vistar.planLimitCheck');

export interface PlanLimitCheck {
  /** Throws AppException PLAN_LIMIT_REACHED (402) when one more `metric` would exceed the plan. */
  assertCanAdd(workspaceId: string, metric: 'api_keys'): Promise<void>;
}
