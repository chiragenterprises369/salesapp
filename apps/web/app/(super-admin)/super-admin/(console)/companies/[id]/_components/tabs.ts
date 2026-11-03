/** Tabs of the Super Admin company detail page (server-safe: the page reads `?tab=` before rendering). */
export const COMPANY_TABS = ['overview', 'users', 'billing', 'switches', 'floor', 'audit'] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

export function isCompanyTab(v: string | undefined): v is CompanyTab {
  return !!v && (COMPANY_TABS as readonly string[]).includes(v);
}
