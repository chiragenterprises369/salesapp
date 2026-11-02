'use client';

import { UTM_PARAMS, type PublicCaptureForm, type Utm } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Clock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/api-error';
import { uuid4 } from '@/lib/crm/ids';
import { hostedBrandCss } from '@/lib/crm/public-brand';
import { getCrmSource } from '@/lib/crm/source';
import { CaptureFormRenderer, type FormValue } from './form-renderer';

/** Tell the embedding page (iframe snippet) how tall the form is. */
function usePostHeight() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    const send = () => window.parent.postMessage({ type: 'vistar-form-height', height: Math.ceil(document.documentElement.scrollHeight) }, '*');
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, []);
}

function Message({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center shadow-card">
      <span aria-hidden className="text-muted-strong [&_svg]:size-8">
        {icon}
      </span>
      <h1 className="text-base font-semibold text-fg">{title}</h1>
      <p className="max-w-sm text-sm text-muted-strong">{body}</p>
    </div>
  );
}

/**
 * Public hosted page of a lead capture form (/f/<key>), also loaded inside the embed iframe. No sign-in.
 * Reads utm_* / gclid / fbclid and hidden-field parameters from its URL, sends one clientSubmissionId
 * per page view (retries are idempotent), and keeps the honeypot off-screen.
 */
export function HostedFormPage({ formKey }: { formKey: string }) {
  const params = useSearchParams();
  const sid = useRef<string | null>(null);
  usePostHeight();
  const q = useQuery({ queryKey: ['public', 'capture-form', formKey], queryFn: () => getCrmSource().public.form(formKey), retry: false, staleTime: 5 * 60_000 });

  const utm = useMemo(() => {
    const out: Utm = {};
    for (const [param, key] of Object.entries(UTM_PARAMS)) {
      const v = params.get(param);
      if (v) out[key as keyof Utm] = v.slice(0, key === 'gclid' || key === 'fbclid' ? 300 : 200);
    }
    return out;
  }, [params]);

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading the form" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    const closed = isApiRequestError(q.error) && (q.error.status === 410 || q.error.code === 'CAPTURE_FORM_CLOSED');
    const missing = isApiRequestError(q.error) && q.error.status === 404;
    return closed ? (
      <Message icon={<Clock />} title="This form is closed" body="It is not taking new enquiries right now. Please contact the company directly." />
    ) : missing ? (
      <Message icon={<AlertCircle />} title="Form not found" body="Check the link you were given." />
    ) : (
      <Message icon={<AlertCircle />} title="The form did not load" body="Check your connection and reload the page." />
    );
  }
  const form: PublicCaptureForm = q.data;
  const hidden: Record<string, FormValue> = {};
  for (const f of form.fields) if (f.type === 'hidden') hidden[f.id] = (f.param ? params.get(f.param) : null) ?? f.defaultValue ?? null;
  const css = hostedBrandCss(form.branding);
  const logo = form.branding.logoLight?.url ?? null;

  return (
    <div data-hosted>
      {css && <style>{css}</style>}
      <CaptureFormRenderer
        form={form}
        logoUrl={logo}
        workspaceName={form.branding.displayName ?? form.workspaceName}
        initialValues={hidden}
        onSubmit={async ({ values, consent, hp }) => {
          sid.current ??= uuid4();
          try {
            const r = await getCrmSource().public.submit(formKey, {
              values: values as Record<string, string | number | boolean | string[] | null>,
              consent,
              utm,
              pageUrl: window.location.href.slice(0, 2000),
              referrer: document.referrer ? document.referrer.slice(0, 2000) : null,
              hp,
              clientSubmissionId: sid.current,
            });
            return { message: r.message, redirectUrl: r.redirectUrl };
          } catch (e) {
            if (isApiRequestError(e) && e.status === 429) throw new Error('Too many tries from this network. Wait a minute and send again.');
            if (isApiRequestError(e) && e.status === 410) throw new Error('This form was closed a moment ago. Please contact the company directly.');
            if (isApiRequestError(e)) throw new Error(e.details[0]?.message ?? e.message);
            throw new Error('Your answers were not sent. Check your connection and try again.');
          }
        }}
      />
      <p className="mt-3 text-center text-2xs text-muted-strong">Powered by Vistar</p>
    </div>
  );
}
