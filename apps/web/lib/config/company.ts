'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPANY_EMAIL_TEMPLATE_KEYS,
  emailTemplateDefault,
  emailTemplateVariables,
  renderEmail,
  sampleVariables,
  type CompanyEmailTemplateKey,
  type EmailSendResult,
  type EmailTemplate,
  type EmailTemplateSummary,
  type RouteBody,
  type SetupChecklist,
  type SetupItemKey,
  type WhatsAppTemplate,
  type WhatsAppTemplateSyncResult,
} from '@vistar/shared';
import { api } from '../api/client';
import { isMockData, noteMockUse } from '../api/data-source';
import { configKeys } from './keys';

/**
 * Company > Settings data (change #20, SPEC 30): the setup checklist (and the dashboard banner), company
 * e-mail templates and WhatsApp message templates synced with Meta. Keys start with the SYNC_SCOPES
 * values 'setup' and 'templates' so events and resyncs refresh them. Mock data mode (tests only)
 * keeps an in-memory store seeded from the shipped defaults; it never invents setup progress.
 */

const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- setup checklist

export function useSetupChecklist(enabled = true) {
  return useQuery({
    queryKey: configKeys.setup,
    queryFn: async ({ signal }): Promise<SetupChecklist> => {
      if (isMockData()) {
        noteMockUse('settings.setup');
        await pause();
        return { items: [], done: 0, total: 0, percent: 100, complete: true, bannerDismissed: true };
      }
      return api.call('setupChecklist', { signal });
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useSetupMutations() {
  const qc = useQueryClient();
  const put = (data: SetupChecklist) => qc.setQueryData(configKeys.setup, data);
  return {
    acknowledge: useMutation({
      mutationFn: ({ key, acknowledged }: { key: SetupItemKey; acknowledged: boolean }) => api.call('setupItemAcknowledge', { params: { key }, body: { acknowledged } }),
      onSuccess: put,
    }),
    banner: useMutation({
      mutationFn: (dismissed: boolean) => api.call('setupBanner', { body: { dismissed } }),
      onSuccess: put,
    }),
  };
}

// ---------------------------------------------------------------- company e-mail templates

const mockSaved: Partial<Record<CompanyEmailTemplateKey, { subject: string; html: string; updatedAt: string }>> = {};

function mockCompanyTemplate(key: CompanyEmailTemplateKey): EmailTemplate {
  const def = emailTemplateDefault('company', key)!;
  const saved = mockSaved[key];
  const subject = saved?.subject ?? def.subject;
  const html = saved?.html ?? def.html;
  const variables = emailTemplateVariables('company', key);
  return {
    key,
    scope: 'company',
    label: def.label,
    description: def.description,
    subject,
    html,
    text: renderEmail({ subject, html }, sampleVariables('company', key), { brand: { name: 'Company' }, variables }).text,
    variables,
    isCustom: !!saved,
    defaultSubject: def.subject,
    defaultHtml: def.html,
    updatedAt: saved?.updatedAt ?? null,
    updatedBy: saved ? { id: 'mock', name: 'You' } : null,
  };
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: configKeys.emailTemplates,
    queryFn: async ({ signal }): Promise<EmailTemplateSummary[]> => {
      if (isMockData()) {
        noteMockUse('settings.email-templates');
        await pause();
        return COMPANY_EMAIL_TEMPLATE_KEYS.map((k) => mockCompanyTemplate(k));
      }
      return (await api.call('emailTemplateList', { signal })).items;
    },
    staleTime: 60_000,
  });
}

export function useEmailTemplate(key: CompanyEmailTemplateKey | null) {
  return useQuery({
    queryKey: configKeys.emailTemplate(key ?? ''),
    queryFn: async ({ signal }): Promise<EmailTemplate> => {
      if (isMockData()) {
        await pause();
        return mockCompanyTemplate(key!);
      }
      return api.call('emailTemplateGet', { params: { key: key! }, signal });
    },
    enabled: !!key,
    staleTime: 60_000,
  });
}

export function useEmailTemplateMutations(key: CompanyEmailTemplateKey) {
  const qc = useQueryClient();
  const put = (t: EmailTemplate) => {
    qc.setQueryData(configKeys.emailTemplate(key), t);
    void qc.invalidateQueries({ queryKey: configKeys.emailTemplates, exact: true });
    void qc.invalidateQueries({ queryKey: configKeys.setup });
  };
  return {
    save: useMutation({
      mutationFn: async (body: RouteBody<'emailTemplateUpdate'>): Promise<EmailTemplate> => {
        if (isMockData()) {
          await pause(300);
          mockSaved[key] = { subject: body.subject, html: body.html, updatedAt: new Date().toISOString() };
          return mockCompanyTemplate(key);
        }
        return api.call('emailTemplateUpdate', { params: { key }, body });
      },
      onSuccess: put,
    }),
    reset: useMutation({
      mutationFn: async (): Promise<EmailTemplate> => {
        if (isMockData()) {
          await pause(300);
          delete mockSaved[key];
          return mockCompanyTemplate(key);
        }
        return api.call('emailTemplateReset', { params: { key } });
      },
      onSuccess: put,
    }),
    test: useMutation({
      mutationFn: async (body: RouteBody<'emailTemplateTest'>): Promise<EmailSendResult> => {
        if (isMockData()) {
          await pause(500);
          return { ok: true, message: `Mock data mode: the e-mail to ${body.to ?? 'you'} was built but not sent.`, messageId: null, via: 'dev_log' };
        }
        return api.call('emailTemplateTest', { params: { key }, body });
      },
    }),
  };
}

// ---------------------------------------------------------------- WhatsApp message templates

export function useWhatsAppTemplates() {
  return useQuery({
    queryKey: configKeys.whatsappTemplates,
    queryFn: async ({ signal }): Promise<WhatsAppTemplate[]> => {
      if (isMockData()) {
        noteMockUse('settings.whatsapp-templates');
        await pause();
        return [];
      }
      return (await api.call('whatsappTemplateList', { signal })).items;
    },
    staleTime: 30_000,
  });
}

export function useWhatsAppTemplateMutations() {
  const qc = useQueryClient();
  const putOne = (t: WhatsAppTemplate) => {
    qc.setQueryData<WhatsAppTemplate[]>(configKeys.whatsappTemplates, (list) => (list ? (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list]) : [t]));
    void qc.invalidateQueries({ queryKey: configKeys.setup });
  };
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'whatsappTemplateCreate'>) => api.call('whatsappTemplateCreate', { body }), onSuccess: putOne }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: RouteBody<'whatsappTemplateUpdate'> }) => api.call('whatsappTemplateUpdate', { params: { id }, body }), onSuccess: putOne }),
    submit: useMutation({ mutationFn: (id: string) => api.call('whatsappTemplateSubmit', { params: { id } }), onSuccess: putOne }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        await api.call('whatsappTemplateDelete', { params: { id } });
        return id;
      },
      onSuccess: (id) => {
        qc.setQueryData<WhatsAppTemplate[]>(configKeys.whatsappTemplates, (list) => list?.filter((x) => x.id !== id));
        void qc.invalidateQueries({ queryKey: configKeys.setup });
      },
    }),
    sync: useMutation({
      mutationFn: (): Promise<WhatsAppTemplateSyncResult> => api.call('whatsappTemplateSync'),
      onSuccess: (r) => {
        qc.setQueryData(configKeys.whatsappTemplates, r.items);
        void qc.invalidateQueries({ queryKey: configKeys.setup });
      },
    }),
  };
}
