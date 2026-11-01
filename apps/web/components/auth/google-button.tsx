'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormAlert } from './auth-frame';

const isDev = process.env.NODE_ENV !== 'production';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.98-4.32 2.98-7.33ZM12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.81-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22Zm-5.6-8.1a6 6 0 0 1 0-3.8V7.52H3.07a10 10 0 0 0 0 8.96L6.4 13.9ZM12 5.98c1.47 0 2.79.5 3.83 1.5l2.86-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.52L6.4 10.1C7.19 7.74 9.4 5.98 12 5.98Z"
      />
    </svg>
  );
}

/**
 * Google sign-in entry point. Google Identity Services needs a client ID on the API
 * (GOOGLE_CLIENT_ID); until it is configured the button explains that instead of failing silently.
 */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" className="w-full" onClick={() => setExplained(true)} aria-expanded={explained}>
        <GoogleMark />
        {label}
      </Button>
      {explained && (
        <FormAlert tone="info">
          Google sign-in is not set up yet. Use your email and password for now.
          {isDev && <span className="mt-1 block text-xs">Developers: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the API environment.</span>}
        </FormAlert>
      )}
    </div>
  );
}
