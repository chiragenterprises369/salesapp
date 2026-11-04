export function StatsSection() {
  const stats = [
    { value: '20K+', label: 'Active users managing pipelines and deals every day' },
    { value: '98%', label: 'Customer satisfaction rate across all regions' },
    { value: '35%', label: 'Average increase in deal close rate after 90 days' },
    { value: '10M+', label: 'Customer interactions tracked and organized' },
  ];

  return (
    <section className="bg-gray-50/80 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          {/* Left: chart visual */}
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-gray-200/60 bg-white p-6 shadow-xl">
              <p className="mb-1 text-[12px] font-semibold text-gray-500">Leads Conversion Rate</p>
              <div className="mt-4 flex items-end gap-2">
                {[45, 60, 40, 75, 50, 85, 65, 90, 70, 80, 55, 95].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t transition-all"
                    style={{
                      height: `${h * 1.2}px`,
                      background: `linear-gradient(to top, ${i % 2 === 0 ? '#818CF8' : '#A78BFA'}, ${i % 2 === 0 ? '#C4B5FD' : '#DDD6FE'})`,
                    }}
                  />
                ))}
              </div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5">
                <div className="size-4 rounded bg-amber-400" />
                <span className="text-[11px] font-medium text-amber-700">Integration App</span>
              </div>
            </div>

            {/* Decorative blob */}
            <div className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full bg-gradient-to-br from-yellow-200/40 to-amber-100/30 blur-3xl" />
          </div>

          {/* Right: stats */}
          <div>
            <h2 className="text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
              Trusted Numbers That
              <br />
              <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text italic text-transparent">
                Show Real Impact
              </span>
            </h2>

            <div className="mt-10 grid grid-cols-2 gap-8">
              {stats.map((stat) => (
                <div key={stat.value}>
                  <p className="text-[36px] font-bold tracking-tight text-gray-900 sm:text-[44px]">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
