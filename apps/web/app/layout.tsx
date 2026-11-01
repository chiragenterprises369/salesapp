import { getThemeBootScript } from '@vistar/shared';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui';
import { AppProviders } from '@/lib/providers';
import { ThemeProvider } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Vistar', template: '%s · Vistar' },
  description: 'Sales management for Indian SMEs: leads, pipeline, automation and a live team floor.',
  applicationName: 'Vistar',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F7F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1115' },
  ],
  viewportFit: 'cover',
};

/**
 * Root layout. The boot script stays FIRST in <head>: it applies data-theme from the `vistar_theme`
 * cookie before first paint (no flash). ThemeProvider (inside AppProviders, so it can read the session)
 * keeps the attribute, the cookie and the user's saved preference in sync afterwards.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeBootScript() }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <AppProviders>
          <ThemeProvider>{children}</ThemeProvider>
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
}
