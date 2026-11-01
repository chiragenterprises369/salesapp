'use client';

import { labelOf } from '@vistar/shared';
import { useMemo } from 'react';
import { useLabels } from '@/lib/customization';

export interface LeadWords {
  /** "Lead" / "Enquiry" */
  Lead: string;
  /** "Leads" / "Enquiries" */
  Leads: string;
  /** "lead" / "enquiry" (mid-sentence) */
  lead: string;
  /** "leads" / "enquiries" (mid-sentence) */
  leads: string;
  /** "1 enquiry", "3 enquiries" */
  count: (n: number) => string;
}

/** The workspace's display words for leads (Settings > Labels). Display text only; URLs stay /leads. */
export function useLeadWords(): LeadWords {
  const labels = useLabels();
  return useMemo(() => {
    const lead = labelOf(labels, 'lead', { lower: true });
    const leads = labelOf(labels, 'lead', { plural: true, lower: true });
    return {
      Lead: labelOf(labels, 'lead'),
      Leads: labelOf(labels, 'lead', { plural: true }),
      lead,
      leads,
      count: (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? lead : leads}`,
    };
  }, [labels]);
}
