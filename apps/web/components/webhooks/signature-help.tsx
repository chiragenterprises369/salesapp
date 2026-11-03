'use client';

import { WEBHOOK_TOLERANCE_SEC } from '@vistar/shared';
import { useState } from 'react';
import { Segmented } from '@/components/dashboard/segmented';
import { inboundCurl, inboundNode, inboundTokenCurl, outboundVerifyNode } from '@/lib/hub/snippets';
import { CodeBlock } from '@/lib/hub/ui/copy';

/** How to sign a request to an inbound source, with copyable curl and Node examples. */
export function InboundSignatureHelp({ url, sample, verification = 'hmac' }: { url: string; sample?: unknown; verification?: 'hmac' | 'token' | null }) {
  const [lang, setLang] = useState<'curl' | 'node'>('curl');
  if (verification === 'token')
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-fg-secondary">
          This source checks a token instead of a signature: send the source&apos;s secret in the <code className="font-mono text-xs">X-Vistar-Token</code> header (or as <code className="font-mono text-xs">?token=</code> for tools that cannot set headers). Use a signed source whenever the sender can compute HMAC-SHA256.
        </p>
        <CodeBlock title="Send a test request" language="bash" code={inboundTokenCurl(url, sample)} what="curl example" />
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="text-sm text-fg-secondary">
        <p>
          Sign every request with the source&apos;s secret: HMAC-SHA256 over <code className="font-mono text-xs">{'<unix seconds>.<raw body>'}</code>, sent as{' '}
          <code className="font-mono text-xs">X-Vistar-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>.
        </p>
        <ul className="mt-1.5 list-disc pl-5 text-xs text-muted-strong">
          <li>Requests older than {WEBHOOK_TOLERANCE_SEC / 60} minutes are refused, so a captured request cannot be replayed later.</li>
          <li>Send an Idempotency-Key header: a retry with the same key is answered without creating a second lead.</li>
          <li>Vistar answers 202 when it accepted the request, 401 for a bad or old signature.</li>
        </ul>
      </div>
      <Segmented
        label="Example language"
        value={lang}
        onChange={setLang}
        options={[
          { value: 'curl', label: 'curl' },
          { value: 'node', label: 'Node.js' },
        ]}
      />
      {lang === 'curl' ? <CodeBlock title="Send a signed test request" language="bash" code={inboundCurl(url, sample)} what="curl example" /> : <CodeBlock title="Send a signed request" language="Node.js 18+" code={inboundNode(url, sample)} what="Node example" />}
    </div>
  );
}

/** How a receiver verifies Vistar's outbound signature. */
export function OutboundSignatureHelp() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-fg-secondary">
        Each delivery carries <code className="font-mono text-xs">X-Vistar-Signature</code> (HMAC-SHA256 of <code className="font-mono text-xs">{'<t>.<raw body>'}</code> with the subscription secret),{' '}
        <code className="font-mono text-xs">X-Vistar-Event</code> and <code className="font-mono text-xs">X-Vistar-Delivery</code>. Answer with any 2xx within 10 seconds; anything else is retried.
      </p>
      <CodeBlock title="Verify a delivery" language="Node.js + Express" code={outboundVerifyNode()} what="Verification example" />
    </div>
  );
}
