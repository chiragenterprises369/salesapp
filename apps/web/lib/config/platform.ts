'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  configFieldActive,
  emailTemplateDefault,
  emailTemplateVariables,
  evaluateConfigGroup,
  maskSecretHint,
  PLATFORM_CONFIG_GROUPS,
  PLATFORM_EMAIL_TEMPLATE_KEYS,
  renderEmail,
  resolveConfigField,
  sampleVariables,
  type ConfigAuditEntry,
  type ConfigGroup,
  type ConfigGroupDef,
  type ConfigGroupKey,
  type ConfigRegistry,
  type ConfigTestResult,
  type ConfigValue,
  type EmailSendResult,
  type EmailTemplate,
  type EmailTemplateSummary,
  type GoLiveChecklist,
  type PlatformBillingProfileResponse,
  type PlatformEmailTemplateKey,
  type RegistryGroupKey,
  type ResolvedConfigField,
  type RouteBody,
} from '@vistar/shared';
import { ApiRequestError } from '../api-error';
import { superApi } from '../api/client';
import { isMockData, noteMockUse } from '../api/data-source';
import { configKeys } from './keys';

/**
 * Super Admin > Config data (change #20, SPEC 30): the platform config registry (groups, fields, status,
 * tests, audit), the go-live checklist, platform e-mail templates and the Vistar billing profile.
 * API mode: /api/super/* through the typed client. Mock data mode (tests only): an in-memory store built
 * from the shared registry definitions, so the page works without an API and never shows invented values.
 */

const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- mock store (mock data mode only)

interface MockState {
  panel: Partial<Record<RegistryGroupKey, Record<string, ConfigValue>>>;
  tests: Partial<Record<ConfigGroupKey, ConfigTestResult>>;
  audit: Partial<Record<ConfigGroupKey, ConfigAuditEntry[]>>;
  templates: Partial<Record<PlatformEmailTemplateKey, { subject: string; html: string; updatedAt: string }>>;
}
const mock: MockState = { panel: {}, tests: {}, audit: {}, templates: {} };

function mockGroup(key: ConfigGroupKey): ConfigGroup {
  const def: ConfigGroupDef = PLATFORM_CONFIG_GROUPS[key];
  const fields = def.fields;
  const panel = (def.kind === 'registry' ? mock.panel[key as RegistryGroupKey] : undefined) ?? {};
  const resolved: Record<string, ResolvedConfigField> = Object.fromEntries(fields.map((f) => [f.key, resolveConfigField(f, panel[f.key], null, false)]));
  const values = Object.fromEntries(Object.entries(resolved).map(([k, r]) => [k, r.value]));
  const evaluation = def.kind === 'registry' ? evaluateConfigGroup(key, resolved) : { status: 'missing' as const, missing: [] };
  return {
    key,
    label: def.label,
    description: def.description,
    icon: def.icon,
    kind: def.kind,
    status: evaluation.status,
    statusNote: def.kind === 'card' ? 'Status comes from the API.' : null,
    requiredInProduction: def.requiredInProduction,
    testable: def.testable,
    testLabel: def.testLabel ?? null,
    testNeedsRecipient: !!def.testNeedsRecipient,
    cardAnchor: def.cardAnchor ?? null,
    fields: fields.map((f) => {
      const r = resolved[f.key]!;
      const secret = f.type === 'secret';
      const stored = panel[f.key];
      return {
        key: f.key,
        label: f.label,
        type: f.type,
        secret,
        help: f.help ?? null,
        placeholder: f.placeholder ?? null,
        required: !!f.required,
        active: configFieldActive(f, values),
        when: f.when ? { field: f.when.field, in: [...f.when.in] } : null,
        options: f.options ? f.options.map((o) => ({ value: o.value, label: o.label })) : null,
        min: f.min ?? null,
        max: f.max ?? null,
        value: secret ? null : r.value,
        panelValue: secret ? null : (stored ?? null),
        source: r.source,
        envVar: f.env ?? null,
        defaultValue: f.default ?? null,
        secretSet: secret && typeof stored === 'string' && stored.length > 0,
        secretHint: secret && typeof stored === 'string' ? maskSecretHint(stored) : null,
      };
    }),
    missing: evaluation.missing,
    lastTest: mock.tests[key] ?? null,
    updatedAt: null,
    updatedBy: null,
  };
}

const mockRegistry = (): ConfigRegistry => ({ environment: 'development', groups: (Object.keys(PLATFORM_CONFIG_GROUPS) as ConfigGroupKey[]).map(mockGroup) });

function mockAudit(key: ConfigGroupKey, entry: Omit<ConfigAuditEntry, 'id' | 'at' | 'adminName' | 'ip'>) {
  const list = mock.audit[key] ?? [];
  mock.audit[key] = [{ ...entry, id: crypto.randomUUID(), at: new Date().toISOString(), adminName: 'You', ip: null }, ...list].slice(0, 50);
}

// ---------------------------------------------------------------- registry

export function useConfigRegistry() {
  return useQuery({
    queryKey: configKeys.registry,
    queryFn: async ({ signal }): Promise<ConfigRegistry> => {
      if (isMockData()) {
        noteMockUse('super.config.registry');
        await pause();
        return mockRegistry();
      }
      return superApi.call('superConfigRegistry', { signal });
    },
    staleTime: 30_000,
  });
}

/** Replace one group inside the cached registry (after save, reset or test). */
function usePutGroup() {
  const qc = useQueryClient();
  return (group: ConfigGroup) => {
    qc.setQueryData<ConfigRegistry>(configKeys.registry, (r) => (r ? { ...r, groups: r.groups.map((g) => (g.key === group.key ? group : g)) } : r));
    void qc.invalidateQueries({ queryKey: configKeys.registryAudit(group.key) });
    void qc.invalidateQueries({ queryKey: configKeys.goLive });
  };
}

/** Refresh a card group's status after its own card changed (Firebase, releases, Razorpay, billing profile). */
export function useRefreshRegistry() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: configKeys.registry });
    void qc.invalidateQueries({ queryKey: configKeys.goLive });
  };
}

export function useSaveConfigGroup(group: RegistryGroupKey) {
  const put = usePutGroup();
  return useMutation({
    mutationFn: async (values: Record<string, ConfigValue | null>): Promise<ConfigGroup> => {
      if (isMockData()) {
        await pause(300);
        const current = { ...(mock.panel[group] ?? {}) };
        const changed: string[] = [];
        const cleared: string[] = [];
        for (const [k, v] of Object.entries(values)) {
          if (v === null) {
            delete current[k];
            cleared.push(k);
          } else {
            current[k] = v;
            changed.push(k);
          }
        }
        mock.panel[group] = current;
        mockAudit(group, { action: `config.${group}.update`, changed, cleared, ok: null });
        return mockGroup(group);
      }
      return superApi.call('superConfigGroupUpdate', { params: { group }, body: { values } });
    },
    onSuccess: put,
  });
}

export function useResetConfigGroup(group: RegistryGroupKey) {
  const put = usePutGroup();
  return useMutation({
    mutationFn: async (): Promise<ConfigGroup> => {
      if (isMockData()) {
        await pause(300);
        const cleared = Object.keys(mock.panel[group] ?? {});
        delete mock.panel[group];
        mockAudit(group, { action: `config.${group}.reset`, changed: [], cleared, ok: null });
        return mockGroup(group);
      }
      return superApi.call('superConfigGroupReset', { params: { group } });
    },
    onSuccess: put,
  });
}

export function useTestConfigGroup(group: RegistryGroupKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RouteBody<'superConfigGroupTest'>): Promise<ConfigTestResult> => {
      if (isMockData()) {
        await pause(600);
        const g = mockGroup(group);
        const ok = g.status !== 'missing';
        const result: ConfigTestResult = {
          ok,
          message: ok ? 'Mock data mode: the test passed without contacting any service.' : `Add ${g.missing.join(', ')} first.`,
          latencyMs: ok ? 42 : null,
          at: new Date().toISOString(),
          details: null,
        };
        mock.tests[group] = result;
        mockAudit(group, { action: `config.${group}.test`, changed: [], cleared: [], ok });
        return result;
      }
      return superApi.call('superConfigGroupTest', { params: { group }, body });
    },
    onSuccess: (result) => {
      qc.setQueryData<ConfigRegistry>(configKeys.registry, (r) => (r ? { ...r, groups: r.groups.map((g) => (g.key === group ? { ...g, lastTest: result } : g)) } : r));
      void qc.invalidateQueries({ queryKey: configKeys.registryAudit(group) });
      void qc.invalidateQueries({ queryKey: configKeys.goLive });
    },
  });
}

export function useConfigGroupAudit(group: ConfigGroupKey, enabled = true) {
  return useQuery({
    queryKey: configKeys.registryAudit(group),
    queryFn: async ({ signal }): Promise<ConfigAuditEntry[]> => {
      if (isMockData()) {
        await pause();
        return mock.audit[group] ?? [];
      }
      return (await superApi.call('superConfigGroupAudit', { params: { group }, signal })).items;
    },
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------- go-live checklist

export function useGoLive() {
  return useQuery({
    queryKey: configKeys.goLive,
    queryFn: async ({ signal }): Promise<GoLiveChecklist> => {
      if (isMockData()) {
        noteMockUse('super.config.go-live');
        await pause();
        return { items: [], passed: 0, total: 0, ready: false, environment: 'development', checkedAt: new Date().toISOString() };
      }
      return superApi.call('superGoLive', { signal });
    },
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------- platform e-mail templates

function mockPlatformTemplate(key: PlatformEmailTemplateKey): EmailTemplate {
  const def = emailTemplateDefault('platform', key)!;
  const saved = mock.templates[key];
  const subject = saved?.subject ?? def.subject;
  const html = saved?.html ?? def.html;
  const text = renderEmail({ subject, html }, sampleVariables('platform', key), { brand: { name: 'Vistar' }, variables: emailTemplateVariables('platform', key) }).text;
  return {
    key,
    scope: 'platform',
    label: def.label,
    description: def.description,
    subject,
    html,
    text,
    variables: emailTemplateVariables('platform', key),
    isCustom: !!saved,
    defaultSubject: def.subject,
    defaultHtml: def.html,
    updatedAt: saved?.updatedAt ?? null,
    updatedBy: saved ? { id: 'mock', name: 'You' } : null,
  };
}

export function useSuperEmailTemplates() {
  return useQuery({
    queryKey: configKeys.platformTemplates,
    queryFn: async ({ signal }): Promise<EmailTemplateSummary[]> => {
      if (isMockData()) {
        noteMockUse('super.email-templates');
        await pause();
        return PLATFORM_EMAIL_TEMPLATE_KEYS.map((k) => mockPlatformTemplate(k));
      }
      return (await superApi.call('superEmailTemplateList', { signal })).items;
    },
    staleTime: 60_000,
  });
}

export function useSuperEmailTemplate(key: PlatformEmailTemplateKey | null) {
  return useQuery({
    queryKey: configKeys.platformTemplate(key ?? ''),
    queryFn: async ({ signal }): Promise<EmailTemplate> => {
      if (isMockData()) {
        await pause();
        return mockPlatformTemplate(key!);
      }
      return superApi.call('superEmailTemplateGet', { params: { key: key! }, signal });
    },
    enabled: !!key,
    staleTime: 60_000,
  });
}

export function useSuperEmailTemplateMutations(key: PlatformEmailTemplateKey) {
  const qc = useQueryClient();
  const put = (t: EmailTemplate) => {
    qc.setQueryData(configKeys.platformTemplate(key), t);
    void qc.invalidateQueries({ queryKey: configKeys.platformTemplates, exact: true });
  };
  return {
    save: useMutation({
      mutationFn: async (body: RouteBody<'superEmailTemplateUpdate'>): Promise<EmailTemplate> => {
        if (isMockData()) {
          await pause(300);
          mock.templates[key] = { subject: body.subject, html: body.html, updatedAt: new Date().toISOString() };
          return mockPlatformTemplate(key);
        }
        return superApi.call('superEmailTemplateUpdate', { params: { key }, body });
      },
      onSuccess: put,
    }),
    reset: useMutation({
      mutationFn: async (): Promise<EmailTemplate> => {
        if (isMockData()) {
          await pause(300);
          delete mock.templates[key];
          return mockPlatformTemplate(key);
        }
        return superApi.call('superEmailTemplateReset', { params: { key } });
      },
      onSuccess: put,
    }),
    test: useMutation({
      mutationFn: async (body: RouteBody<'superEmailTemplateTest'>): Promise<EmailSendResult> => {
        if (isMockData()) {
          await pause(500);
          return { ok: true, message: `Mock data mode: the e-mail to ${body.to ?? 'you'} was built but not sent.`, messageId: null, via: 'dev_log' };
        }
        return superApi.call('superEmailTemplateTest', { params: { key }, body });
      },
    }),
  };
}

// ---------------------------------------------------------------- Vistar billing profile

let mockProfile: PlatformBillingProfileResponse = { profile: null, complete: false };

export function useVistarBillingProfile() {
  return useQuery({
    queryKey: configKeys.billingProfile,
    queryFn: async ({ signal }): Promise<PlatformBillingProfileResponse> => {
      if (isMockData()) {
        noteMockUse('super.billing-profile');
        await pause();
        return mockProfile;
      }
      return superApi.call('superBillingProfileGet', { signal });
    },
    staleTime: 60_000,
  });
}

export function useSaveVistarBillingProfile() {
  const qc = useQueryClient();
  const refresh = useRefreshRegistry();
  return useMutation({
    mutationFn: async (body: RouteBody<'superBillingProfileUpdate'>): Promise<PlatformBillingProfileResponse> => {
      if (isMockData()) {
        await pause(300);
        const legalName = body.legalName?.trim();
        if (!legalName) throw new ApiRequestError('VALIDATION_FAILED', 'Enter the legal name.', [{ path: 'legalName', message: 'Enter the legal name.' }], { status: 400 });
        mockProfile = { profile: body as PlatformBillingProfileResponse['profile'], complete: !!body.address?.stateCode };
        return mockProfile;
      }
      return superApi.call('superBillingProfileUpdate', { body });
    },
    onSuccess: (data) => {
      qc.setQueryData(configKeys.billingProfile, data);
      refresh();
    },
  });
}
