import { getThemeBootScript } from '@vistar/shared';
import type { Metadata, Viewport } from 'next';
import { Inter, Urbanist } from 'next/font/google';
import type { ReactNode } from 'react';
import { RivetMotionProvider } from '@/components/shell/rivet-motion-provider';
import { Toaster } from '@/components/ui';
import { BrandingProvider, getBrandingBootScript } from '@/lib/branding';
import { AppProviders } from '@/lib/providers';
import { getInterfaceBootScript, InterfaceProvider, ThemeProvider } from '@/lib/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const urbanist = Urbanist({
  subsets: ['latin'],
  variable: '--font-urbanist',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://tootodo.com'),
  title: {
    default: 'Tootodo – Best Sales CRM & Lead Management Software for Indian Sales Teams',
    template: '%s · Tootodo',
  },
  description:
    'Organize leads, automate WhatsApp follow-ups, manage sales pipelines, and track team performance with zero chaos. Tootodo is the modern CRM designed for Indian SMEs and sales organizations.',
  applicationName: 'Tootodo',
  authors: [{ name: 'Tootodo Team', url: 'https://tootodo.com' }],
  creator: 'Tootodo',
  publisher: 'Tootodo',
  category: 'Business & Productivity Software',
  keywords: [
    'sales crm',
    'crm software india',
    'lead management software',
    'whatsapp crm',
    'pipeline management',
    'indian sales crm',
    'indiamart lead manager',
    'b2b sales tracking',
    'field sales crm',
    'crm for smes',
    'tootodo',
  ],
  alternates: {
    canonical: 'https://tootodo.com',
  },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: 'https://tootodo.com',
    siteName: 'Tootodo',
    title: 'Tootodo – A CRM that helps your team stay in flow',
    description:
      'Organize leads, track deals, and close faster without the chaos. Tootodo is the CRM designed for Indian sales teams.',
    images: [
      {
        url: '/icon.svg',
        width: 1200,
        height: 630,
        alt: 'Tootodo Sales CRM',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tootodo – A CRM that helps your team stay in flow',
    description:
      'Organize leads, track deals, and close faster without the chaos. Built for Indian sales teams.',
    images: ['/icon.svg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#050507' },
  ],
  viewportFit: 'cover',
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Tootodo',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'All (Web, iOS, Android)',
      url: 'https://tootodo.com',
      description:
        'Tootodo is a modern sales CRM built for Indian sales teams. Organize leads, automate WhatsApp follow-ups, manage sales pipelines, and track field teams in real-time.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'INR',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.9',
        ratingCount: '320',
      },
      featureList: [
        'Lead Management & Pipeline Tracking',
        'IndiaMART & TradeIndia Integrations',
        '1-Click WhatsApp Follow-ups',
        'Live Virtual Sales Floor',
        'Invoicing & Quotation Generation',
        'Role-Based Team Permissions',
      ],
    },
    {
      '@type': 'Organization',
      name: 'Tootodo',
      url: 'https://tootodo.com',
      logo: 'https://tootodo.com/icon.svg',
    },
    {
      '@type': 'WebSite',
      name: 'Tootodo',
      url: 'https://tootodo.com',
    },
  ],
};

/**
 * Root layout. The theme boot script stays FIRST in <head>: it applies data-theme from the `vistar_theme`
 * cookie before first paint (no flash). The interface boot script follows it and applies
 * data-interface-style / data-motion from the `vistar_ui` cookie and the device (SPEC 28.2).
 * ThemeProvider and InterfaceProvider (inside AppProviders, so they can read the session) keep the
 * attributes, the cookies and the user's saved preferences in sync afterwards. The branding boot script
 * applies data-ui (Standard or Premium components, D-059) and the cached brand colours (D-060);
 * BrandingProvider keeps them, the favicon and the tab title in sync with the company settings.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${urbanist.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: getInterfaceBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: getBrandingBootScript() }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <AppProviders>
          <ThemeProvider>
            <InterfaceProvider />
            <BrandingProvider />
            <RivetMotionProvider>
              {children}
            </RivetMotionProvider>
          </ThemeProvider>
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
}
