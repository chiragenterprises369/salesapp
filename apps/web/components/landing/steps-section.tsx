import { Check } from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Create your workspace',
    description: 'Set up your company profile and invite your team members. Takes under 2 minutes.',
  },
  {
    number: '02',
    title: 'Build your pipeline',
    description: 'Configure custom deal stages, add fields, and define your workflow to match your sales process.',
  },
  {
    number: '03',
    title: 'Add customers and deals',
    description: 'Import contacts from spreadsheets or add them manually. Start tracking leads immediately.',
  },
  {
    number: '04',
    title: 'Close and grow',
    description: 'Use automations, insights, and integrations to close deals faster and scale your revenue.',
  },
];

export function StepsSection() {
  return (
    <section className="bg-gradient-to-b from-white to-gray-50/80 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* Left: content */}
          <div>
            <h2 className="text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
              Get Organized in Just
              <br />
              a Few{' '}
              <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text italic text-transparent">
                Simple Steps
              </span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
              Setting up Tootodo is straightforward. Follow these steps to get
              your team selling smarter in no time.
            </p>

            {/* Steps list */}
            <div className="mt-10 space-y-6">
              {steps.map((step, i) => (
                <div key={step.number} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[13px] font-bold text-white">
                      <Check className="size-4" />
                    </div>
                    {i < steps.length - 1 && (
                      <div className="mt-1 h-full w-px bg-gradient-to-b from-indigo-200 to-transparent" />
                    )}
                  </div>
                  <div className="pb-6">
                    <h3 className="text-[16px] font-bold text-gray-900">{step.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: visual */}
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-gray-200/70 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/50 p-8 shadow-xl">
              {/* Data discovery card */}
              <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <div className="size-3 rounded-full bg-emerald-400" />
                  <span className="text-[12px] font-semibold text-gray-700">Automated Data Discovery</span>
                </div>
                <div className="space-y-2">
                  {['Contact Info Enrichment', 'Social Profile Sync', 'Deal Size Estimation', 'Priority Scoring'].map((item) => (
                    <div key={item} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
                      <Check className="size-3.5 text-emerald-500" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              {/* Mini cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 p-4 text-white">
                  <p className="text-[10px] font-medium opacity-70">Active Pipelines</p>
                  <p className="mt-1 text-[22px] font-bold">12</p>
                  <p className="text-[10px] opacity-60">Across 3 teams</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-medium text-gray-400">Conversion Rate</p>
                  <p className="mt-1 text-[22px] font-bold text-gray-900">68%</p>
                  <p className="text-[10px] text-emerald-500">↑ 12% vs last month</p>
                </div>
              </div>

              {/* Integration App tag */}
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5">
                <div className="size-4 rounded bg-amber-400" />
                <span className="text-[11px] font-medium text-amber-700">Integration App</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
