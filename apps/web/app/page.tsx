import type { Metadata } from 'next';
import LandingPage, { metadata as landingMetadata } from './(marketing)/landing/page';

export const metadata: Metadata = {
  ...landingMetadata,
  title: 'Tootodo – A CRM that helps your team stay in flow',
  description:
    'Organize leads, automate WhatsApp follow-ups, and close deals faster. Tootodo is the modern sales CRM built for Indian businesses.',
  alternates: {
    canonical: 'https://tootodo.com',
  },
  openGraph: {
    title: 'Tootodo – A CRM that helps your team stay in flow',
    description:
      'Organize leads, track deals, and close faster without the chaos. Built for Indian sales teams.',
    url: 'https://tootodo.com',
    siteName: 'Tootodo',
    locale: 'en_IN',
    type: 'website',
  },
};

/**
 * Root page ("/"): Displays the Tootodo marketing landing page.
 * Users can also access it directly at "/landing".
 */
export default function RootPage() {
  return <LandingPage />;
}
