'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';
import { useSessionStatus } from '@/lib/session/session';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Resources', href: '#resources' },
  { label: 'Company', href: '#company' },
];

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const status = useSessionStatus();
  const isAuthenticated = status === 'authenticated';

  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-b border-transparent bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600">
            <svg viewBox="0 0 32 32" className="size-5">
              <path d="M9 10.5 16 22l7-11.5" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="23" cy="10.5" r="2" fill="#FFFFFF" />
            </svg>
          </div>
          <span className="text-[18px] font-bold tracking-tight text-gray-900">Tootodo</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="flex items-center gap-1 rounded-lg px-3.5 py-2 text-[14px] font-medium text-gray-600 transition-colors hover:text-gray-900"
            >
              {link.label}
              <ChevronDown className="size-3.5 opacity-50" />
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden items-center gap-3 md:flex">
          {isAuthenticated ? (
            <Link
              href="/app"
              className="rounded-full bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md"
            >
              Go to Dashboard →
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-4 py-2 text-[14px] font-medium text-gray-600 transition-colors hover:text-gray-900"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-gray-900 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md"
              >
                Sign Up Free
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="rounded-lg p-2 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-5 py-4 md:hidden">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3">
            {isAuthenticated ? (
              <Link
                href="/app"
                className="rounded-full bg-indigo-600 px-5 py-2.5 text-center text-[14px] font-semibold text-white"
              >
                Go to Dashboard →
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-lg px-3 py-2.5 text-center text-[15px] font-medium text-gray-700">
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-full bg-gray-900 px-5 py-2.5 text-center text-[14px] font-semibold text-white"
                >
                  Sign Up Free
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
