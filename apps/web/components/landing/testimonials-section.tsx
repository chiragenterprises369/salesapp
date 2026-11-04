import { Star } from 'lucide-react';

const testimonials = [
  {
    quote:
      'Tootodo completely transformed how our sales team operates. We went from tracking deals in spreadsheets to fully organized pipeline management.',
    author: 'Priya Sharma',
    role: 'Sales Director, TechStart India',
    avatar: 'PS',
    color: 'bg-violet-100 text-violet-700',
  },
  {
    quote:
      'We switched from a legacy CRM to Tootodo and the simplicity and speed made our team 10x more productive. Close deals faster with better visibility.',
    author: 'Esther Howard',
    role: 'VP Sales, GrowthCo',
    avatar: 'EH',
    color: 'bg-blue-100 text-blue-700',
  },
  {
    quote:
      'Tootodo is the most intuitive CRM for Indian teams. The WhatsApp integration and custom pipelines make it a no-brainer for SMEs.',
    author: 'Rajesh Kumar',
    role: 'Founder, ScaleUp Solutions',
    avatar: 'RK',
    color: 'bg-emerald-100 text-emerald-700',
  },
  {
    quote:
      'Our team tried four CRMs before settling on Tootodo. It offers the right balance of simplicity and power. Plus, the automation saves us 8 hours a week!',
    author: 'Amita Deshpande',
    role: 'Operations Head, RetailHub',
    avatar: 'AD',
    color: 'bg-amber-100 text-amber-700',
  },
  {
    quote:
      'The team floor feature is incredible—seeing everyone\'s activities live has boosted accountability and coordination across our 25-person sales team.',
    author: 'Arun R.',
    role: 'Sales Manager, InfoEdge',
    avatar: 'AR',
    color: 'bg-rose-100 text-rose-700',
  },
  {
    quote:
      'We started as a small team of 5. Tootodo helped us grow to 40+ without ever feeling messy. It scales with you perfectly.',
    author: 'Gurpreet K.',
    role: 'CEO, CloudFirst',
    avatar: 'GK',
    color: 'bg-indigo-100 text-indigo-700',
  },
];

export function TestimonialsSection() {
  return (
    <section className="bg-gradient-to-b from-gray-50/80 to-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[34px] leading-tight font-bold tracking-tight text-gray-900 sm:text-[42px]">
            What Teams Say About
            <br />
            <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text italic text-transparent">
              Staying Organized
            </span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
            Hear how real teams use Tootodo to streamline their sales process and close more deals.
          </p>
        </div>

        {/* Testimonial grid */}
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t) => (
            <div
              key={t.author}
              className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:border-gray-200 hover:shadow-lg"
            >
              {/* Stars */}
              <div className="mb-3 flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="size-4 fill-amber-400 text-amber-400" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-[14px] leading-relaxed text-gray-600">
                &ldquo;{t.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="mt-5 flex items-center gap-3">
                <div className={`flex size-10 items-center justify-center rounded-full text-[13px] font-bold ${t.color}`}>
                  {t.avatar}
                </div>
                <div>
                  <p className="text-[13px] font-bold text-gray-900">{t.author}</p>
                  <p className="text-[12px] text-gray-400">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
