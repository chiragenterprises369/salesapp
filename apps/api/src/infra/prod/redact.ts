/**
 * PII and secret redaction for logs and error reports (change #20). Applied to every log line in production and to
 * error messages sent to monitoring. Conservative: it may mask a harmless number, never the other way round.
 */

const RULES: Array<[RegExp, string]> = [
  // credentials in URLs: scheme://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1***:***@'],
  // bearer tokens, API keys, JWTs
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\bvst_(live|test)_[A-Za-z0-9_-]{6,}/g, 'vst_$1_***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  // key=value secrets in query strings, form bodies and messages
  [/\b(password|passwd|pass|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|key|code|signature|otp|totp)=([^&\s"']+)/gi, '$1=***'],
  [/"(password|secret|token|apiKey|accessToken|refreshToken|appSecret|apiToken|crmKey|privateKey)"\s*:\s*"[^"]*"/g, '"$1":"***"'],
  // e-mail addresses: keep the domain
  [/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '***@$1'],
  // GSTIN and PAN
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, '[gstin]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],
];

/** Indian and international phone numbers (+91 98765 43210, 9876543210, 919876543210): 10 to 15 digits. */
const PHONE = /(?<![\w-])\+?\d[\d\s-]{8,16}\d(?![\w-])/g;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$/;

export function redact(text: string): string {
  let out = text;
  for (const [re, by] of RULES) out = out.replace(re, by);
  return out.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, '').length;
    return digits >= 10 && digits <= 15 && !DATE_LIKE.test(m) ? '[phone]' : m;
  });
}

/** Path segments that carry a secret token: /files/d/<token>, /public/documents/<token>, /invites/<token>. */
const TOKEN_PATHS = /(\/files\/d\/|\/public\/documents\/|\/invites?\/|\/auth\/invite\/|\/d\/)([^/?#]+)/g;

/** The request path for logs: no query string, token segments masked. */
export function redactPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path.replace(TOKEN_PATHS, '$1***').slice(0, 300);
}
