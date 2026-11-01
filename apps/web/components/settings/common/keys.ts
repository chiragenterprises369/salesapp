/**
 * Key suggestions from labels ("GST number" -> "gst_number"). The result is only a suggestion: the
 * shared schemas (FieldKeySchema, ObjectKeySchema, SelectOptionSchema) still validate it.
 */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const clip = (s: string, max: number) => s.slice(0, max).replace(/_+$/, '');

/** Field and object keys: start with a letter, lowercase letters, digits and _, max 40. */
export function toKey(label: string): string {
  const s = slugify(label);
  if (!s) return '';
  return clip(/^[a-z]/.test(s) ? s : `f_${s}`, 40);
}

/** Select option values: lowercase letters, digits and _, max 40. */
export function toOptionValue(label: string): string {
  return clip(slugify(label), 40);
}

/** "Supplier" -> "Suppliers", "Enquiry" -> "Enquiries", "Branch" -> "Branches". */
export function pluralize(word: string): string {
  const w = word.trim();
  if (!w) return '';
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  return `${w}s`;
}
