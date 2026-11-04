'use client';

import { CheckSquare, FileText, Plus, Receipt, Sparkles, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/menu';

/**
 * Rivet signature "+ New" neon button in top bar with quick actions.
 */
export function QuickCreateButton() {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="primary"
          size="md"
          className="gap-1.5 font-bold shadow-[var(--glow)] text-xs h-9 px-3.5"
          aria-label="Create new item"
        >
          <Plus aria-hidden className="size-4" strokeWidth={2.5} />
          <span>New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 p-1.5">
        <DropdownMenuLabel className="text-2xs font-bold tracking-wider uppercase text-faint px-2 py-1">
          Quick Create
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => router.push('/app/leads')} className="gap-2.5 font-medium cursor-pointer">
          <UserPlus aria-hidden className="size-4 text-accent" />
          <span>New Lead</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/app/deals')} className="gap-2.5 font-medium cursor-pointer">
          <Sparkles aria-hidden className="size-4 text-info" />
          <span>New Deal</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/app/contacts')} className="gap-2.5 font-medium cursor-pointer">
          <Users aria-hidden className="size-4 text-dim" />
          <span>New Contact</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/app/quotations/new')} className="gap-2.5 font-medium cursor-pointer">
          <FileText aria-hidden className="size-4 text-dim" />
          <span>New Quotation</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/app/invoices/new')} className="gap-2.5 font-medium cursor-pointer">
          <Receipt aria-hidden className="size-4 text-dim" />
          <span>New Invoice</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/app/tasks')} className="gap-2.5 font-medium cursor-pointer">
          <CheckSquare aria-hidden className="size-4 text-dim" />
          <span>New Task</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
