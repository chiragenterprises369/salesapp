import { formatPaise } from '@vistar/shared';

/**
 * Built-in e-mail for a sent quotation or invoice (change #20). Used when the company has no own template for
 * `quotation_sent` / `invoice_sent` in the template engine (CONFIG-API) or the engine is not available. Every
 * value is HTML-escaped; the plain text part is written separately (not derived by stripping tags).
 */
export interface DocumentEmailVars {
  kind: 'quotation' | 'invoice';
  buyerName: string;
  sellerName: string;
  number: string;
  totalPaise: number;
  /** Quotation: valid until; invoice: due date (YYYY-MM-DD). */
  due: string | null;
  link: string;
  pdfLink: string;
  message: string | null;
  senderName: string | null;
  brandColor: string | null;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Template variables for the template engine (`{{name}}`, `{{number}}`, ...). */
export function documentTemplateVars(v: DocumentEmailVars): Record<string, string> {
  return {
    name: v.buyerName,
    workspace: v.sellerName,
    number: v.number,
    total: formatPaise(v.totalPaise),
    due: v.due ?? '',
    link: v.link,
    pdfLink: v.pdfLink,
    message: v.message ?? '',
    sender: v.senderName ?? v.sellerName,
    documentType: v.kind === 'quotation' ? 'quotation' : 'invoice',
  };
}

export function defaultDocumentEmail(v: DocumentEmailVars): { subject: string; html: string; text: string } {
  const what = v.kind === 'quotation' ? 'Quotation' : 'Invoice';
  const subject = `${what} ${v.number} from ${v.sellerName}`.slice(0, 200);
  const dueLine = v.due ? (v.kind === 'quotation' ? `It is valid until ${v.due}.` : `Payment is due by ${v.due}.`) : '';
  const color = v.brandColor && /^#[0-9a-fA-F]{6}$/.test(v.brandColor) ? v.brandColor : '#4F46E5';
  const sign = v.senderName ? `${v.senderName}, ${v.sellerName}` : v.sellerName;
  const text = [
    `Dear ${v.buyerName},`,
    '',
    v.message ?? `Please find our ${what.toLowerCase()} ${v.number} for ${formatPaise(v.totalPaise)} attached. ${dueLine}`.trim(),
    '',
    `View it online: ${v.link}`,
    `Download the PDF: ${v.pdfLink}`,
    '',
    'Regards,',
    sign,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Segoe UI,Arial,sans-serif;color:#171a21">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e3e6eb">
<tr><td style="padding:24px 28px">
<p style="margin:0 0 16px;font-size:15px">Dear ${escapeHtml(v.buyerName)},</p>
${v.message ? `<p style="margin:0 0 16px;font-size:15px;white-space:pre-line">${escapeHtml(v.message)}</p>` : `<p style="margin:0 0 16px;font-size:15px">Please find our ${what.toLowerCase()} <strong>${escapeHtml(v.number)}</strong> for <strong>${escapeHtml(formatPaise(v.totalPaise))}</strong> attached. ${escapeHtml(dueLine)}</p>`}
<p style="margin:24px 0"><a href="${escapeHtml(v.link)}" style="background:${color};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View ${what.toLowerCase()}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#5b6170">Or download the PDF: <a href="${escapeHtml(v.pdfLink)}" style="color:${color}">${escapeHtml(v.pdfLink)}</a></p>
<p style="margin:24px 0 0;font-size:15px">Regards,<br>${escapeHtml(sign)}</p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}
