import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function CtaSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-violet-50 py-20 lg:py-28">
      {/* Background blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 right-1/4 size-[400px] rounded-full bg-gradient-to-br from-violet-200/30 to-indigo-100/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 size-[300px] rounded-full bg-gradient-to-br from-blue-100/20 to-cyan-100/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl px-5 text-center lg:px-8">
        <h2 className="text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
          Stay on top of every
          <br />
          customer,{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text italic text-transparent">
            effortlessly
          </span>
        </h2>

        {/* Mini dashboard preview */}
        <div className="mx-auto mt-10 max-w-md overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-4 py-2.5">
            <div className="flex size-5 items-center justify-center rounded-md bg-indigo-600">
              <svg viewBox="0 0 32 32" className="size-3">
                <path d="M9 10.5 16 22l7-11.5" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="23" cy="10.5" r="2" fill="#FFF" />
              </svg>
            </div>
            <span className="text-[11px] font-bold text-gray-700">Tootodo</span>
          </div>
          <div className="p-5">
            <p className="text-[11px] text-gray-400">Let&apos;s see your sales today</p>
            <p className="text-[15px] font-bold text-gray-900">Hello, Esther Howard</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: 'Leads', value: '142', color: 'bg-blue-50 text-blue-700' },
                { label: 'Deals', value: '38', color: 'bg-emerald-50 text-emerald-700' },
                { label: 'Won', value: '₹4.2L', color: 'bg-amber-50 text-amber-700' },
              ].map((s) => (
                <div key={s.label} className={`rounded-lg ${s.color} p-2.5 text-center`}>
                  <p className="text-[10px] opacity-60">{s.label}</p>
                  <p className="text-[15px] font-bold">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10">
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 rounded-full bg-gray-900 px-8 py-4 text-[15px] font-semibold text-white shadow-lg transition-all hover:bg-gray-800 hover:shadow-xl"
          >
            Get Started for Free
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
