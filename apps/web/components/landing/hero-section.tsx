import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-indigo-50/30 to-white pt-28 pb-16 lg:pt-36 lg:pb-24">
      {/* Background decorative blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 size-[500px] rounded-full bg-gradient-to-br from-violet-200/40 to-indigo-100/30 blur-3xl" />
        <div className="absolute top-20 -left-40 size-[400px] rounded-full bg-gradient-to-br from-blue-100/30 to-cyan-100/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-gradient-to-t from-yellow-100/20 to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        {/* Badge */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/80 px-4 py-1.5 shadow-sm backdrop-blur-sm">
            <Sparkles className="size-4 text-amber-500" />
            <span className="text-[13px] font-medium text-gray-600">
              Say hey to your CRM workflow companion
            </span>
          </div>
        </div>

        {/* Heading */}
        <h1 className="mx-auto mt-8 max-w-3xl text-center text-[42px] leading-[1.15] font-bold tracking-tight text-gray-900 sm:text-[52px] lg:text-[60px]">
          A CRM that helps your
          <br />
          team{' '}
          <span className="relative inline-block">
            <span className="relative z-10 bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text italic text-transparent">
              stay in flow
            </span>
            <svg className="absolute -bottom-1 left-0 w-full" viewBox="0 0 200 12" fill="none">
              <path d="M2 8c40-6 80-6 120-2s56 4 76 0" stroke="url(#hero-underline)" strokeWidth="3" strokeLinecap="round" />
              <defs>
                <linearGradient id="hero-underline" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#818CF8" />
                  <stop offset="1" stopColor="#C084FC" />
                </linearGradient>
              </defs>
            </svg>
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mt-6 max-w-2xl text-center text-[16px] leading-relaxed text-gray-500 sm:text-[18px]">
          Organize leads, track deals, and close faster without the chaos.
          <br className="hidden sm:block" />
          Tootodo is the CRM designed for Indian sales teams.
        </p>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 rounded-full bg-gray-900 px-7 py-3.5 text-[15px] font-semibold text-white shadow-lg transition-all hover:bg-gray-800 hover:shadow-xl"
          >
            Get Started
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#features"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-7 py-3.5 text-[15px] font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
          >
            Learn More
          </a>
        </div>

        {/* Hero Dashboard Preview */}
        <div className="relative mx-auto mt-16 max-w-5xl">
          <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl shadow-gray-900/10">
            {/* Dashboard header bar */}
            <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/50 px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-indigo-600">
                  <svg viewBox="0 0 32 32" className="size-3.5">
                    <path d="M9 10.5 16 22l7-11.5" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="23" cy="10.5" r="2" fill="#FFF" />
                  </svg>
                </div>
                <span className="text-[13px] font-bold text-gray-800">Tootodo</span>
              </div>
              <div className="ml-auto flex gap-2">
                <div className="h-5 w-16 rounded bg-gray-100" />
                <div className="h-5 w-16 rounded bg-gray-100" />
                <div className="h-5 w-16 rounded bg-gray-100" />
              </div>
            </div>

            {/* Dashboard content mockup */}
            <div className="p-6">
              <div className="mb-4">
                <p className="text-[13px] text-gray-400">Let&apos;s see your sales moving today.</p>
                <h3 className="text-[18px] font-bold text-gray-900">Hello, Esther Howard</h3>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Revenue', value: '₹6,00,000', color: 'bg-violet-50', textColor: 'text-violet-700' },
                  { label: 'Active Deals', value: '₹200', color: 'bg-blue-50', textColor: 'text-blue-700' },
                  { label: 'Pipeline Value', value: '₹2,50,000', color: 'bg-emerald-50', textColor: 'text-emerald-700' },
                  { label: 'Avg. Deal', value: '₹2,500', color: 'bg-amber-50', textColor: 'text-amber-700' },
                ].map((stat) => (
                  <div key={stat.label} className={`rounded-xl ${stat.color} p-4`}>
                    <p className="text-[11px] font-medium text-gray-500">{stat.label}</p>
                    <p className={`mt-1 text-[20px] font-bold ${stat.textColor}`}>{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Chart placeholder */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                  <p className="mb-2 text-[12px] font-semibold text-gray-500">Leads Conversion Rate</p>
                  <div className="flex items-end gap-1.5">
                    {[40, 65, 45, 80, 55, 70, 90, 60, 75, 85, 50, 95].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t bg-gradient-to-t from-indigo-400 to-indigo-300"
                        style={{ height: `${h}px` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                  <p className="mb-2 text-[12px] font-semibold text-gray-500">Recent Activity</p>
                  <div className="space-y-2">
                    {[
                      'New lead: Rahul Sharma',
                      'Deal closed: ₹45,000',
                      'Follow-up scheduled',
                      'Pipeline moved: Stage 3',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px] text-gray-600">
                        <div className="size-1.5 rounded-full bg-emerald-400" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Floating decorative elements */}
          <div className="absolute -right-8 -bottom-6 h-28 w-44 rounded-2xl border border-yellow-200/60 bg-gradient-to-br from-yellow-50 to-amber-50 p-4 shadow-lg max-lg:hidden">
            <p className="text-[11px] font-medium text-amber-600">Integration App</p>
            <div className="mt-2 flex gap-1.5">
              <div className="size-6 rounded-lg bg-blue-100" />
              <div className="size-6 rounded-lg bg-green-100" />
              <div className="size-6 rounded-lg bg-purple-100" />
            </div>
          </div>
          <div className="absolute -bottom-4 -left-6 h-24 w-40 rounded-2xl border border-pink-200/60 bg-gradient-to-br from-pink-50 to-rose-50 p-4 shadow-lg max-lg:hidden">
            <p className="text-[11px] font-medium text-pink-600">Quick Stats</p>
            <p className="mt-1 text-[16px] font-bold text-pink-700">+23%</p>
            <p className="text-[10px] text-pink-400">This month</p>
          </div>
        </div>

        {/* Trusted by */}
        <div className="mt-20">
          <p className="mb-6 text-center text-[13px] font-medium text-gray-400">
            Trusted by fast-growing teams and modern Indian businesses
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-50 grayscale">
            {['Razorpay', 'Zoho', 'Freshworks', 'Flipkart', 'Swiggy'].map((brand) => (
              <span key={brand} className="text-[18px] font-bold text-gray-400">{brand}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
