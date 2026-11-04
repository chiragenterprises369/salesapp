import Link from 'next/link';

const footerLinks = {
  Product: ['Features', 'Pricing', 'Integrations', 'Changelog', 'Roadmap'],
  Category: ['Sales CRM', 'Pipeline Management', 'Automation', 'Analytics'],
  Resources: ['Blog', 'Documentation', 'API Reference', 'Help Center'],
  Company: ['About', 'Careers', 'Contact', 'Press Kit'],
};

export function LandingFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white py-16">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        {/* Top section */}
        <div className="mb-12">
          <h2 className="text-[28px] font-bold tracking-tight text-gray-900 sm:text-[34px]">
            Stay in the{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text italic text-transparent">
              loop
            </span>
          </h2>
          <p className="mt-2 max-w-md text-[14px] leading-relaxed text-gray-500">
            Updates, releases, resources for sales teams and the latest from Tootodo—delivered to your inbox.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-5">
          {/* Logo column */}
          <div className="col-span-2 sm:col-span-4 lg:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 shadow-sm">
                <svg viewBox="0 0 32 32" className="size-4">
                  <path d="M9 10.5 16 22l7-11.5" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="23" cy="10.5" r="2" fill="#FFF" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[16px] font-bold text-gray-900 leading-none">Tootodo</span>
                <span className="text-[10px] font-semibold text-indigo-600 tracking-wider uppercase mt-1 leading-none">Sales CRM</span>
              </div>
            </Link>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <p className="text-[13px] font-semibold text-gray-900">{title}</p>
              <ul className="mt-3 space-y-2.5">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-[13px] text-gray-500 transition-colors hover:text-gray-900"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-8 sm:flex-row">
          <p className="text-[12px] text-gray-400">
            © {new Date().getFullYear()} Tootodo. All rights reserved.
          </p>
          <div className="flex gap-6">
            {['Terms', 'Privacy', 'Cookies'].map((link) => (
              <a key={link} href="#" className="text-[12px] text-gray-400 transition-colors hover:text-gray-600">
                {link}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
