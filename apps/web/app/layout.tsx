import { getThemeBootScript } from '@vistar/shared';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui';
import { AppProviders } from '@/lib/providers';
import { getInterfaceBootScript, InterfaceProvider, ThemeProvider } from '@/lib/theme';
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
 * Root layout. The theme boot script stays FIRST in <head>: it applies data-theme from the `vistar_theme`
 * cookie before first paint (no flash). The interface boot script follows it and applies
 * data-interface-style / data-motion from the `vistar_ui` cookie and the device (SPEC 28.2).
 * ThemeProvider and InterfaceProvider (inside AppProviders, so they can read the session) keep the
 * attributes, the cookies and the user's saved preferences in sync afterwards.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: getInterfaceBootScript() }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <AppProviders>
          <ThemeProvider>
            <InterfaceProvider />
            {children}
          </ThemeProvider>
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
}
