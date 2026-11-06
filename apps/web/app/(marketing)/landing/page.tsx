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
    'Organize leads, track deals, and close faster. Tootodo is the modern sales CRM built for Indian sales teams.',
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

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Do I need a credit card?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. Tootodo offers a free plan with no credit card required. You can upgrade anytime.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I migrate from another CRM?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes! We support CSV imports and have dedicated migration guides for popular CRMs. Our team can also help with data transfer.',
      },
    },
    {
      '@type': 'Question',
      name: 'Manage Members, Workspaces, and Billing...',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You can manage team members, create multiple workspaces, and handle billing all from the admin panel. Role-based access ensures the right people have the right permissions.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is this suitable for small teams?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Absolutely. Tootodo is built for teams of all sizes—from solo founders to 500+ person sales organizations. Start small and scale as you grow.',
      },
    },
    {
      '@type': 'Question',
      name: 'What about data security?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'We use enterprise-grade encryption, SOC 2 compliant infrastructure, and your data is stored in Indian data centers for compliance and speed.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does it integrate with other tools?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes—WhatsApp, Gmail, Google Calendar, Slack, Tally, custom webhooks, and more. We are constantly adding new integrations.',
      },
    },
  ],
};

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-gray-900 antialiased" data-theme="light">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
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
