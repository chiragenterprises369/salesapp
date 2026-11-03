import { describe, expect, it } from 'vitest';
import { clusters, pdfSafe, scriptOf, shapeText, splitRuns, type IndicScript } from './fonts.js';
import { PdfDocument } from './pdf-writer.js';

// change #20 (PROD-HUB): Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada and Malayalam next to Devanagari.
// Written for the Kiro Crew run; not executed in this wave (no runtime tests on the low-memory machine).

const SAMPLES: Record<IndicScript, { name: string; conjunct: string; preBase?: { text: string; matra: number } }> = {
  devanagari: { name: 'नमस्ते', conjunct: 'क्ष', preBase: { text: 'कि', matra: 0x093f } },
  bengali: { name: 'কলকাতা', conjunct: 'ক্ষ', preBase: { text: 'কি', matra: 0x09bf } },
  gurmukhi: { name: 'ਪੰਜਾਬ', conjunct: 'ਪ੍ਰ', preBase: { text: 'ਕਿ', matra: 0x0a3f } },
  gujarati: { name: 'અમદાવાદ', conjunct: 'ક્ષ', preBase: { text: 'કિ', matra: 0x0abf } },
  tamil: { name: 'சென்னை', conjunct: 'க்ஷ', preBase: { text: 'கெ', matra: 0x0bc6 } },
  telugu: { name: 'హైదరాబాద్', conjunct: 'క్ష' },
  kannada: { name: 'ಬೆಂಗಳೂರು', conjunct: 'ಕ್ಷ' },
  malayalam: { name: 'കൊച്ചി', conjunct: 'ക്ഷ', preBase: { text: 'കെ', matra: 0x0d46 } },
};

describe('Indian scripts in PDFs', () => {
  for (const [script, sample] of Object.entries(SAMPLES) as Array<[IndicScript, (typeof SAMPLES)[IndicScript]]>) {
    describe(script, () => {
      it('detects the script and keeps every character', () => {
        expect(scriptOf(sample.name.codePointAt(0)!)).toBe(script);
        expect(pdfSafe(sample.name)).toBe(sample.name.normalize('NFC'));
        expect(pdfSafe(sample.name, 'bold')).toBe(sample.name.normalize('NFC'));
      });

      it('uses its own face in a mixed line, Latin around it', () => {
        const runs = splitRuns(`Ship to ${sample.name} ₹500`);
        expect(runs.map((r) => r.face.key)).toEqual(['latin-regular', `${script}-regular`, 'latin-regular']);
        expect(runs[1]!.text.trim()).toBe(sample.name.normalize('NFC'));
        expect(splitRuns(sample.name, 'bold')[0]!.face.key).toBe(`${script}-bold`);
      });

      it('shapes without missing glyphs (no .notdef)', () => {
        for (const style of ['regular', 'bold'] as const) {
          for (const run of shapeText(sample.name, style)) expect(run.glyphs.every((g) => g.id > 0)).toBe(true);
        }
      });

      it('forms the conjunct (fewer glyphs than code points)', () => {
        const run = shapeText(sample.conjunct)[0]!;
        expect(run.glyphs.length).toBeLessThan(Array.from(sample.conjunct).length);
        expect(run.glyphs.every((g) => g.id > 0)).toBe(true);
      });

      if (sample.preBase) {
        const pre = sample.preBase;
        it('draws the pre-base vowel sign before its consonant', () => {
          const run = shapeText(pre.text)[0]!;
          expect(run.glyphs[0]!.codePoints).toContain(pre.matra);
        });
      }

      it('never splits a conjunct when wrapping', () => {
        expect(clusters(sample.conjunct)).toHaveLength(1);
      });
    });
  }

  it('keeps the danda in the surrounding script run', () => {
    const runs = splitRuns('ধন্যবাদ।');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.face.key).toBe('bengali-regular');
  });

  it('embeds one subset font per script used and writes ActualText for reordered glyphs', () => {
    const doc = new PdfDocument();
    let y = 40;
    for (const sample of Object.values(SAMPLES)) {
      doc.text(40, y, `${sample.name} ${sample.preBase?.text ?? ''}`, { size: 11 });
      y += 18;
    }
    const pdf = doc.toBuffer().toString('latin1');
    for (const stem of ['NotoSansDevanagari', 'NotoSansBengali', 'NotoSansGurmukhi', 'NotoSansGujarati', 'NotoSansTamil', 'NotoSansTelugu', 'NotoSansKannada', 'NotoSansMalayalam']) {
      expect(pdf).toMatch(new RegExp(`/BaseFont /[A-Z]{6}\\+${stem}`));
    }
    expect(pdf).toContain('/ActualText');
  });
});
