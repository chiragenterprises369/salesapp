import {
  LayoutDashboard,
  Users,
  History,
  BarChart3,
  Puzzle,
} from 'lucide-react';

const features = [
  {
    icon: LayoutDashboard,
    title: 'Centralized Control Panel',
    description:
      'Get a 360° view of every customer, deal and task from a single dashboard. Track revenue, manage contacts, and monitor your pipeline in real time.',
    span: 'lg:col-span-3',
    preview: 'dashboard',
  },
  {
    icon: Users,
    title: 'Seamless Teamwork',
    description:
      'Assign leads, share notes, mention teammates, and manage activities, stages and deal cards. Everyone stays on the same page.',
    span: 'lg:col-span-3',
    preview: 'team',
  },
  {
    icon: History,
    title: 'History Deals',
    description:
      'Full audit trail of customer interactions, deal changes and closed-won history so no context is ever lost.',
    span: 'lg:col-span-2',
    preview: 'history',
  },
  {
    icon: BarChart3,
    title: 'Actionable Insights',
    description:
      'Track lead-to-deal conversion, forecast revenue, and monitor team performance with easy-to-read charts and KPIs.',
    span: 'lg:col-span-2',
    preview: 'insights',
  },
  {
    icon: Puzzle,
    title: 'Integrations',
    description:
      'Seamlessly connect with WhatsApp, email, calendars, accounting tools and custom webhooks.',
    span: 'lg:col-span-2',
    preview: 'integrations',
  },
];

function FeaturePreview({ type }: { type: string }) {
  switch (type) {
    case 'dashboard':
      return (
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex size-5 items-center justify-center rounded-md bg-indigo-600">
              <svg viewBox="0 0 32 32" className="size-3">
                <path d="M9 10.5 16 22l7-11.5" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-[11px] font-bold text-gray-700">Tootodo</span>
          </div>
          <p className="text-[10px] text-gray-400">Let&apos;s see your sales today</p>
          <p className="text-[13px] font-bold text-gray-800">Hello, Esther Howard</p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {['₹6L', '₹200', '₹2.5L', '₹2.5K'].map((v, i) => (
              <div key={i} className="rounded-lg bg-gradient-to-br from-indigo-50 to-violet-50 p-2 text-center">
                <p className="text-[12px] font-bold text-indigo-700">{v}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case 'team':
      return (
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="mb-2 text-[11px] font-semibold text-gray-500">Recent Activity</p>
          <div className="space-y-2">
            {[
              { name: 'Rahul S.', action: 'moved deal to Stage 3', color: 'bg-blue-400' },
              { name: 'Priya K.', action: 'added a new lead', color: 'bg-emerald-400' },
              { name: 'Amit J.', action: 'closed ₹45K deal', color: 'bg-amber-400' },
            ].map((item) => (
              <div key={item.name} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <div className={`size-6 rounded-full ${item.color} flex items-center justify-center text-[9px] font-bold text-white`}>
                  {item.name[0]}
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-700">{item.name}</p>
                  <p className="text-[10px] text-gray-400">{item.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case 'history':
      return (
        <div className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="mb-1 text-[11px] font-semibold text-gray-500">Total Revenue</p>
          <p className="text-[22px] font-bold text-gray-900">₹ 1,60,000,00</p>
          <div className="mt-3 flex items-end gap-1">
            {[30, 50, 35, 65, 55, 80, 70, 90].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-gradient-to-t from-yellow-400 to-yellow-300"
                style={{ height: `${h * 0.6}px` }}
              />
            ))}
          </div>
          <p className="mt-2 text-[18px] font-bold text-gray-800">₹ 1,60,000,00 <span className="text-[11px] font-normal text-emerald-500">+12%</span></p>
        </div>
      );
    case 'insights':
      return (
        <div className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[11px] font-semibold text-gray-500">Avg. Deal Value</p>
          <div className="relative mx-auto size-20">
            <svg viewBox="0 0 80 80" className="size-full -rotate-90">
              <circle cx="40" cy="40" r="32" fill="none" stroke="#E5E7EB" strokeWidth="8" />
              <circle cx="40" cy="40" r="32" fill="none" stroke="url(#donut-grad)" strokeWidth="8" strokeDasharray="160" strokeDashoffset="40" strokeLinecap="round" />
              <defs>
                <linearGradient id="donut-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop stopColor="#818CF8" />
                  <stop offset="1" stopColor="#F472B6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[14px] font-bold text-gray-900">₹2,500</span>
            </div>
          </div>
        </div>
      );
    case 'integrations':
      return (
        <div className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'WhatsApp', color: 'bg-green-50 text-green-600' },
              { label: 'Gmail', color: 'bg-red-50 text-red-500' },
              { label: 'Calendar', color: 'bg-blue-50 text-blue-600' },
              { label: 'Slack', color: 'bg-purple-50 text-purple-600' },
              { label: 'Webhook', color: 'bg-amber-50 text-amber-600' },
              { label: 'Tally', color: 'bg-teal-50 text-teal-600' },
            ].map((i) => (
              <div key={i.label} className={`rounded-lg ${i.color} p-2 text-center text-[10px] font-semibold`}>
                {i.label}
              </div>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export function FeaturesSection() {
  return (
    <section id="features" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        {/* Section heading */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[14px] font-semibold text-indigo-600">Everything you need to</p>
          <h2 className="mt-2 text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
            stay{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text italic text-transparent">
              organized
            </span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
            Your data under one roof—collect, analyze, and automate so your team stays focused on closing.
          </p>
        </div>

        {/* Feature cards */}
        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-6">
          {features.map((feat) => (
            <div
              key={feat.title}
              className={`group rounded-2xl border border-gray-100 bg-gray-50/50 p-6 transition-all hover:border-gray-200 hover:shadow-lg ${feat.span}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <feat.icon className="size-5" />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-gray-900">{feat.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{feat.description}</p>
                </div>
              </div>
              <FeaturePreview type={feat.preview} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
