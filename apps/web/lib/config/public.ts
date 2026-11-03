'use client';

import { useQuery } from '@tanstack/react-query';
import type { PublicPlatformInfo } from '@vistar/shared';
import { api } from '../api/client';
import { isMockData } from '../api/data-source';

/**
 * Vistar's public platform info (GET /public/platform, no auth): product name, support contacts, legal
 * links, the password rule and whether Google sign-in is configured (Super Admin > Config). Used by
 * the sign-in, sign-up and invite pages. Mock data mode: Google sign-in off, no links.
 */
export function usePublicPlatformInfo() {
  return useQuery({
    queryKey: ['public', 'platform'],
    queryFn: async ({ signal }): Promise<PublicPlatformInfo> => {
      if (isMockData())
        return { productName: 'Vistar', supportEmail: null, supportPhone: null, websiteUrl: null, termsUrl: null, privacyUrl: null, passwordMinLength: 8, monitoring: null, googleSignIn: false, googleClientId: null };
      return api.call('publicPlatformInfo', { signal });
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
