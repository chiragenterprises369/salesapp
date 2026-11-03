/**
 * Query keys for the change #20 config screens.
 * - Super Admin keys start with 'platform' (platform sessions get no socket events: mutations refresh them).
 * - Company keys start with a SYNC_SCOPES value ('setup', 'templates') so events and resyncs refresh them.
 */
export const configKeys = {
  // Super Admin
  company: (id: string) => ['platform', 'company', id] as const,
  companyUsers: (id: string) => ['platform', 'company', id, 'users'] as const,
  companyAudit: (id: string) => ['platform', 'company', id, 'audit'] as const,
  companySetup: (id: string) => ['platform', 'company', id, 'setup'] as const,
  companies: ['platform', 'companies'] as const,
  switches: ['platform', 'config', 'switches'] as const,
  billingProfile: ['platform', 'config', 'billing-profile'] as const,
  registry: ['platform', 'config', 'registry'] as const,
  registryGroup: (key: string) => ['platform', 'config', 'registry', key] as const,
  registryAudit: (key: string) => ['platform', 'config', 'registry', key, 'audit'] as const,
  platformTemplates: ['platform', 'config', 'email-templates'] as const,
  platformTemplate: (key: string) => ['platform', 'config', 'email-templates', key] as const,
  goLive: ['platform', 'config', 'go-live'] as const,
  // Company ('setup' and 'templates' are SYNC_SCOPES since change #20)
  setup: ['setup'] as const,
  emailTemplates: ['templates', 'email'] as const,
  emailTemplate: (key: string) => ['templates', 'email', key] as const,
  whatsappTemplates: ['templates', 'whatsapp'] as const,
  whatsappTemplate: (id: string) => ['templates', 'whatsapp', id] as const,
};
