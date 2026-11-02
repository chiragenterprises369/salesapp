'use client';

import type { BoardSkin } from '@vistar/shared';
import { Check, ChevronDown, Layers, Sparkles, Square, type LucideIcon } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { TOUCH_BUTTON } from '../touch';
import { BOARD_SKIN_HINT, BOARD_SKIN_LABEL, BOARD_SKINS } from './skin-model';

const SKIN_ICON: Record<BoardSkin, LucideIcon> = { flat: Square, depth: Layers, neon: Sparkles };

/**
 * Board skin picker in the board toolbar (replaces the old Flat mode toggle): Flat, Depth, Neon
 * Space, saved per person (`leads.boardSkin`). Shows what the person asked for; the toolbar note
 * explains when the device paints something else.
 */
export function SkinPicker({
  requested,
  userChoice,
  workspaceDefault,
  touch,
  onChange,
}: {
  requested: BoardSkin;
  userChoice: BoardSkin | null;
  workspaceDefault: BoardSkin;
  /** 44 px targets. */
  touch: boolean;
  onChange: (skin: BoardSkin | null) => void;
}) {
  const Icon = SKIN_ICON[requested];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          size={touch ? 'touch' : 'sm'}
          variant="ghost"
          aria-label={`Board skin: ${BOARD_SKIN_LABEL[requested]}`}
          title="Board skin"
          data-board-skin-picker=""
          className={cn(touch && TOUCH_BUTTON)}
        >
          <Icon aria-hidden />
          <span className={cn(touch && 'sr-only sm:not-sr-only')}>{BOARD_SKIN_LABEL[requested]}</span>
          <ChevronDown aria-hidden className="text-muted-strong" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-64 rounded-md border border-border bg-surface p-1 text-fg shadow-overlay data-[state=open]:animate-fade-in"
        >
          <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-strong">Board skin</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={requested} onValueChange={(v) => onChange(v as BoardSkin)}>
            {BOARD_SKINS.map((skin) => {
              const ItemIcon = SKIN_ICON[skin];
              return (
                <DropdownMenu.RadioItem
                  key={skin}
                  value={skin}
                  data-skin={skin}
                  className={cn(
                    'flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 outline-none select-none',
                    touch ? 'min-h-[44px]' : 'min-h-9',
                    'data-[highlighted]:bg-surface-3',
                  )}
                >
                  <ItemIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-secondary" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">
                      {BOARD_SKIN_LABEL[skin]}
                      {skin === workspaceDefault && <span className="font-normal text-muted-strong"> · workspace default</span>}
                    </span>
                    <span className="text-xs text-muted-strong">{BOARD_SKIN_HINT[skin]}</span>
                  </span>
                  <DropdownMenu.ItemIndicator className="mt-0.5">
                    <Check aria-hidden className="size-4 text-accent-text" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
          {userChoice !== null && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                onSelect={() => onChange(null)}
                className={cn('flex cursor-default items-center rounded-sm px-2 text-sm outline-none select-none', touch ? 'min-h-[44px]' : 'min-h-8', 'data-[highlighted]:bg-surface-3')}
              >
                Use the workspace default ({BOARD_SKIN_LABEL[workspaceDefault]})
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
