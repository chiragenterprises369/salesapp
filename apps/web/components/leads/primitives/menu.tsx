'use client';

import { Check, ChevronRight } from 'lucide-react';
import { DropdownMenu as Menu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Token-styled dropdown menu (Radix). Local to the Leads stream until the kit ships one
 * (see CONTRACT-REQUEST in the stream summary). Keyboard: arrows, type-ahead, Esc.
 */
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;
export const DropdownMenuSub = Menu.Sub;

const contentClass =
  'z-50 min-w-44 overflow-y-auto rounded-md border border-border bg-surface p-1 text-sm text-fg shadow-overlay outline-none data-[state=open]:animate-fade-in max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]';

const itemClass =
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 outline-none data-[highlighted]:bg-surface-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-strong';

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'start',
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(contentClass, className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        itemClass,
        destructive && 'text-danger-text [&_svg]:text-danger-text',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(itemClass, 'pl-7', className)} {...props}>
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check aria-hidden className="!text-accent-text" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemClass, 'pl-7', className)} {...props}>
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check aria-hidden className="!text-accent-text" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn(
        'px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-muted-strong uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger
      className={cn(itemClass, 'data-[state=open]:bg-surface-3', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </Menu.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent className={cn(contentClass, className)} {...props} />
    </Menu.Portal>
  );
}
