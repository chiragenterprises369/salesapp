import type { Metadata } from 'next';
import LandingPage, { metadata as landingMetadata } from './(marketing)/landing/page';

export const metadata: Metadata = {
  ...landingMetadata,
  title: 'Tootodo – A CRM that helps your team stay in flow',
  description:
    'Organize leads, track deals, and close faster. Tootodo is the modern CRM built for fast-moving sales teams.',
};

/**
 * Root page ("/"): Displays the Tootodo marketing landing page.
 * Users can also access it directly at "/landing".
 */
export default function RootPage() {
  return <LandingPage />;
}
