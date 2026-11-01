'use client';

import { DEFAULT_LABELS, labelOf, type ResolvedLabels } from '@vistar/shared';
import { createContext, useContext } from 'react';

/** The workspace's word for "lead" (configurable labels, e.g. "Enquiry"), in the forms the Board uses. */
export interface BoardWords {
  one: string;
  many: string;
  oneLower: string;
  manyLower: string;
}

export function boardWordsFrom(labels: ResolvedLabels): BoardWords {
  return {
    one: labelOf(labels, 'lead'),
    many: labelOf(labels, 'lead', { plural: true }),
    oneLower: labelOf(labels, 'lead', { lower: true }),
    manyLower: labelOf(labels, 'lead', { plural: true, lower: true }),
  };
}

const BoardWordsContext = createContext<BoardWords>(boardWordsFrom(DEFAULT_LABELS));

export const BoardWordsProvider = BoardWordsContext.Provider;

export function useBoardWords(): BoardWords {
  return useContext(BoardWordsContext);
}

/** "1 lead" / "3 leads" with the configured word. */
export function countOf(n: number, w: BoardWords): string {
  return n === 1 ? w.oneLower : w.manyLower;
}
