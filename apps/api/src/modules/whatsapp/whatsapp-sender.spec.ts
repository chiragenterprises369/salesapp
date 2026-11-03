import { describe, expect, it } from 'vitest';
import { mediaKind, placeholdersOf, templateParams, whatsappTemplatePayload } from './whatsapp-sender.service.js';

// change #20 (PROD-HUB), D-075. Pure template and media helpers. Written for the Kiro Crew run; not executed here.

describe('WhatsApp template parameters', () => {
  it('finds numbered placeholders in order', () => {
    expect(placeholdersOf('Hi {{1}}, your {{2}} is ready: {{3}} ({{1}})')).toEqual(['1', '2', '3']);
    expect(placeholdersOf(null)).toEqual([]);
  });

  it('takes values by number, then by declared name', () => {
    expect(templateParams('Hi {{1}}, {{2}}', ['name', 'number'], { '1': 'Asha', number: 'QT/1' })).toEqual({ params: ['Asha', 'QT/1'], missing: [] });
    expect(templateParams('Hi {{1}}, {{2}}', [], { '1': 'Asha' })).toEqual({ params: ['Asha', ''], missing: ['2'] });
    expect(templateParams('Offer {{1}}', [], { 'header.1': 'Diwali' }, 'header.')).toEqual({ params: ['Diwali'], missing: [] });
  });

  it('builds the Cloud API template payload with header, body and URL button parameters', () => {
    const p = whatsappTemplatePayload(
      { name: 'document_share', language: 'en', body: 'Dear {{1}}, {{2}}: {{3}}', header: 'Quotation {{1}}', variables: [] },
      { '1': 'Asha', '2': 'Quotation QT/2026-27/0004', '3': 'https://app.vistar.in/d/tok', 'header.1': 'QT/2026-27/0004', 'button.0': 'tok' },
    );
    expect(p).toEqual({ kind: 'template', name: 'document_share', language: 'en', bodyParams: ['Asha', 'Quotation QT/2026-27/0004', 'https://app.vistar.in/d/tok'], headerParams: ['QT/2026-27/0004'], buttonParams: [{ index: 0, text: 'tok' }] });
  });

  it('refuses missing values with the variable paths', () => {
    expect(() => whatsappTemplatePayload({ name: 't', language: 'hi', body: '{{1}} {{2}}', header: null, variables: [] }, { '1': 'x' })).toThrow(/Fill in every template variable/);
  });
});

describe('media kinds', () => {
  it('maps MIME types to Meta media types', () => {
    expect(mediaKind('image/jpeg')).toBe('image');
    expect(mediaKind('image/svg+xml')).toBe('document');
    expect(mediaKind('video/mp4')).toBe('video');
    expect(mediaKind('audio/ogg')).toBe('audio');
    expect(mediaKind('application/pdf')).toBe('document');
  });
});
