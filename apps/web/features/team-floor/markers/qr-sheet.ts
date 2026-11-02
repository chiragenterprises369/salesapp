import { encodeQr, qrPath } from '@/components/common/qr/qr-encode';

/**
 * Printable QR sheet for a zone marker: the code, the room name and how to use it, on an A4 page of
 * its own (new window, then the browser print dialog). Dark modules on white, as scanners expect.
 */

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function qrSvg(value: string, sizePx: number): string {
  const m = encodeQr(value);
  const dim = m.size + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#FFFFFF"/><path d="${qrPath(m, 4)}" fill="#0F172A"/></svg>`;
}

/** Opens the print dialog with one sheet; returns false when the browser blocked the window. */
export function printQrSheet(input: {
  token: string;
  roomName: string;
  label: string;
  company: string | null;
}): boolean {
  const win = window.open('', '_blank', 'width=820,height=1100');
  if (!win) return false;
  const title = `${input.roomName} - Vistar office marker`;
  win.document
    .write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; margin: 0; }
  .sheet { display: flex; flex-direction: column; align-items: center; gap: 18px; padding-top: 24px; text-align: center; }
  h1 { font-size: 34px; margin: 0; letter-spacing: -0.01em; }
  .sub { font-size: 16px; color: #334155; margin: 0; }
  .code { border: 2px solid #0f172a; border-radius: 16px; padding: 18px; }
  ol { text-align: left; font-size: 15px; line-height: 1.6; color: #1e293b; max-width: 520px; }
  .foot { font-size: 11px; color: #475569; margin-top: 8px; word-break: break-all; max-width: 520px; }
</style></head><body><div class="sheet">
  <h1>${esc(input.roomName)}</h1>
  <p class="sub">${esc(input.company ? `${input.company} · ` : '')}Scan when you enter this room</p>
  <div class="code">${qrSvg(input.token, 360)}</div>
  <ol>
    <li>Open the Vistar app on your phone and go to <strong>More</strong>.</li>
    <li>Tap <strong>Scan a door or desk QR code</strong>.</li>
    <li>Point the camera at this code. The Team Floor shows you in ${esc(input.roomName)}.</li>
  </ol>
  <p class="foot">${esc(input.label)} · Vistar office marker. Do not share a photo of this code outside the office.</p>
</div><script>window.onload = function () { window.focus(); window.print(); };</script></body></html>`);
  win.document.close();
  return true;
}
