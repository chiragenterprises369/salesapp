import { MessageSquare, Mail, Calendar, Webhook, FileText, Phone } from 'lucide-react';

const integrations = [
  { icon: MessageSquare, label: 'WhatsApp', color: 'bg-green-50 text-green-600 border-green-100' },
  { icon: Mail, label: 'Gmail', color: 'bg-red-50 text-red-500 border-red-100' },
  { icon: Calendar, label: 'Google Calendar', color: 'bg-blue-50 text-blue-600 border-blue-100' },
  { icon: FileText, label: 'Tally', color: 'bg-teal-50 text-teal-600 border-teal-100' },
  { icon: Webhook, label: 'Webhooks', color: 'bg-purple-50 text-purple-600 border-purple-100' },
  { icon: Phone, label: 'Telephony', color: 'bg-amber-50 text-amber-600 border-amber-100' },
];

export function IntegrationsSection() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
            Connect Your Favorite
            <br />
            Tools{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text italic text-transparent">
              Seamlessly
            </span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
            Sync your CRM with essential apps to streamline communication, automate processes,
            and drive productivity.
          </p>
        </div>

        {/* Integration icons grid */}
        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-3 gap-4 sm:grid-cols-6">
          {integrations.map((int) => (
            <div
              key={int.label}
              className={`flex flex-col items-center gap-2.5 rounded-2xl border p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md ${int.color}`}
            >
              <int.icon className="size-7" />
              <span className="text-[12px] font-semibold">{int.label}</span>
            </div>
          ))}
        </div>

        {/* Connection lines visualization */}
        <div className="relative mx-auto mt-10 flex justify-center">
          <div className="relative">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-200">
              <svg viewBox="0 0 32 32" className="size-8">
                <path d="M9 10.5 16 22l7-11.5" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="23" cy="10.5" r="2" fill="#FFF" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
