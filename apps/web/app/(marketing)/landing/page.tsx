import type { Metadata } from 'next';
import {
  LandingNav,
  HeroSection,
  FeaturesSection,
  StepsSection,
  StatsSection,
  IntegrationsSection,
  TestimonialsSection,
  FaqSection,
  CtaSection,
  LandingFooter,
} from '@/components/landing';

export const metadata: Metadata = {
  title: 'Tootodo – A CRM that helps your team stay in flow',
  description:
    'Organize leads, track deals, and close faster. Tootodo is the CRM built for Indian sales teams.',
};

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-gray-900 antialiased" data-theme="light">
      <LandingNav />
      <main>
        <HeroSection />
        <FeaturesSection />
        <StepsSection />
        <StatsSection />
        <IntegrationsSection />
        <TestimonialsSection />
        <FaqSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
