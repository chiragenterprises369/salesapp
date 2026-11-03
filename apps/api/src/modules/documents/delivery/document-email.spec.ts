import { describe, expect, it } from 'vitest';
import { defaultDocumentEmail, documentTemplateVars, escapeHtml } from './document-email.js';

// change #20 (PROD-HUB), D-075. Written for the Kiro Crew run; not executed in this wave.

const vars = {
  kind: 'quotation' as const,
  buyerName: 'Ravi <script>alert(1)</script>',
  sellerName: 'Shakti & Sons',
  number: 'QT/2026-27/0004',
  totalPaise: 1_18_000_00,
  due: '2026-11-30',
  link: 'https://app.vistar.in/d/tok',
  pdfLink: 'https://api.vistar.in/api/v1/public/documents/tok/pdf',
  message: null,
  senderName: 'Asha',
  brandColor: '#0F766E',
};

describe('document e-mail', () => {
  it('escapes every value in the HTML part', () => {
    const mail = defaultDocumentEmail(vars);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Ravi &lt;script&gt;');
    expect(mail.html).toContain('Shakti &amp; Sons');
    expect(mail.subject).toBe('Quotation QT/2026-27/0004 from Shakti & Sons');
    expect(mail.text).toContain('View it online: https://app.vistar.in/d/tok');
    expect(mail.text).toContain('valid until 2026-11-30');
  });

  it('uses the sender message instead of the default line', () => {
    const mail = defaultDocumentEmail({ ...vars, message: 'As discussed on the call' });
    expect(mail.text).toContain('As discussed on the call');
    expect(mail.html).toContain('As discussed on the call');
  });

  it('ignores a bad brand colour', () => {
    expect(defaultDocumentEmail({ ...vars, brandColor: 'red;background:url(x)' }).html).toContain('#4F46E5');
  });

  it('template variables for the company template engine', () => {
    const v = documentTemplateVars(vars);
    expect(v).toMatchObject({ number: 'QT/2026-27/0004', link: 'https://app.vistar.in/d/tok', workspace: 'Shakti & Sons', documentType: 'quotation' });
    expect(v.total).toContain('1,18,000');
    expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
  });
});
