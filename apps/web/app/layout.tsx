import { getThemeBootScript } from '@vistar/shared';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui';
import { AppProviders } from '@/lib/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Vistar', template: '%s · Vistar' },
  description: 'Sales management for Indian SMEs: leads, pipeline, automation and a live team floor.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F7F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1115' },
  ],
};

/**
 * Root layout. The boot script applies data-theme before first paint (no flash).
 * frontend-app owns this file from Wave 1 (theme provider etc.); keep the boot script first in
 * <head> and keep <AppProviders> (query client + session) around the app.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeBootScript() }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <AppProviders>{children}</AppProviders>
        <Toaster />
      </body>
    </html>
  );
}
