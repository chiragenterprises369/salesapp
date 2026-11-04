'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'Do I need a credit card?',
    a: 'No. Tootodo offers a free plan with no credit card required. You can upgrade anytime.',
  },
  {
    q: 'Can I migrate from another CRM?',
    a: 'Yes! We support CSV imports and have dedicated migration guides for popular CRMs. Our team can also help with data transfer.',
  },
  {
    q: 'Manage Members, Workspaces, and Billing...',
    a: 'You can manage team members, create multiple workspaces, and handle billing all from the admin panel. Role-based access ensures the right people have the right permissions.',
  },
  {
    q: 'Is this suitable for small teams?',
    a: 'Absolutely. Tootodo is built for teams of all sizes—from solo founders to 500+ person sales organizations. Start small and scale as you grow.',
  },
  {
    q: 'What about data security?',
    a: 'We use enterprise-grade encryption, SOC 2 compliant infrastructure, and your data is stored in Indian data centers for compliance and speed.',
  },
  {
    q: 'Does it integrate with other tools?',
    a: 'Yes—WhatsApp, Gmail, Google Calendar, Slack, Tally, custom webhooks, and more. We are constantly adding new integrations.',
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-3xl px-5 lg:px-8">
        <div className="text-center">
          <h2 className="text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
            Frequently Asked
            <br />
            <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text italic text-transparent">
              Questions
            </span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
            Can&apos;t find what you&apos;re looking for? Don&apos;t hesitate to reach out to our team.
          </p>
        </div>

        <div className="mt-12 divide-y divide-gray-100">
          {faqs.map((faq, i) => (
            <div key={i} className="py-5">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 text-left"
              >
                <span className="text-[15px] font-semibold text-gray-900">{faq.q}</span>
                <ChevronDown
                  className={`size-5 shrink-0 text-gray-400 transition-transform ${openIndex === i ? 'rotate-180' : ''}`}
                />
              </button>
              {openIndex === i && (
                <p className="mt-3 text-[14px] leading-relaxed text-gray-500 pr-8">
                  {faq.a}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
