'use client';

import { useSpringValue } from '@react-spring/web';
import { formatInr, type LeadListItem, type Stage } from '@vistar/shared';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  MessageCircle,
  MoreHorizontal,
  Phone,
  UserRound,
  Zap,
} from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useLeadActions } from '@/components/leads-shared/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { useBoardController, useDragState } from './drag/context';
import { writeNudge } from './drag/controller';
import type { CardHandle, DragState } from './drag/types';
import { followUpLabel } from './hooks';
import { MoveMenu } from './move-menu';
import { isOverdue } from './skins/skin-model';
import { getTavolaTheme, type TavolaTone } from './tones';

/** Formats a relative time string (e.g. 12 min, 2h, 3d) */
function formatAge(dateStr: string, now: number): string {
  const ms = Math.max(0, now - new Date(dateStr).getTime());
  const mins = Math.floor(ms / (1000 * 60));
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = Math.floor(mins / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / (1000 * 60 * 60 * 24));
  return `${days}d`;
}

/** Card face shared by the real card and the drag ghost. */
export function cardSurface(compact: boolean, themeClass: string = 'ob-t--amber'): string {
  return cn(
    'relative flex flex-col rounded-[18px] text-left',
    themeClass,
    compact ? 'gap-1.5 p-3' : 'gap-2.5 p-3.5',
  );
}

export interface LeadCardBodyProps {
  lead: LeadListItem;
  compact: boolean;
  now: number;
  selectMode?: boolean;
  selected?: boolean;
  theme?: TavolaTone;
  stageIndex?: number;
  stage?: Stage;
  stages?: readonly Stage[];
  onQuickAction?: () => void;
  onMove?: (toStageId: string) => void;
  onOpenChange?: (open: boolean) => void;
  reserveActions?: number;
  nameId?: string;
  detailsId?: string;
}

/** Card content styled identically to Tavola Kitchen Orders */
export function LeadCardBody({
  lead,
  compact,
  now,
  selectMode = false,
  selected = false,
  theme = 'amber',
  stageIndex = 0,
  stage,
  stages,
  onQuickAction,
  onMove,
  onOpenChange,
  nameId,
  detailsId,
}: LeadCardBodyProps) {
  // Tavola ticket ID sequence: #1070 style
  const leadSeq = lead.id.replace(/\D/g, '').slice(-4).padStart(4, '0') || lead.id.slice(0, 4).toUpperCase();
  const followUp = lead.nextFollowUpAt ? followUpLabel(lead.nextFollowUpAt, now) : null;

  // Decide action icon and label depending on stage and tone
  let ActionIcon = ArrowRight;
  let actionLabel = 'Advance';
  if (stageIndex === 0) {
    ActionIcon = Zap;
    actionLabel = lead.phone ? 'Quick Call' : 'Contact';
  } else if (stageIndex === 1) {
    ActionIcon = MessageCircle;
    actionLabel = lead.phone ? 'WhatsApp' : 'Follow Up';
  } else if (stage?.type === 'won') {
    ActionIcon = CheckCircle2;
    actionLabel = 'Won';
  } else if (stage?.type === 'lost') {
    ActionIcon = CheckCircle2;
    actionLabel = 'Archived';
  } else if (stages && stageIndex < stages.length - 1) {
    ActionIcon = ArrowRight;
    actionLabel = 'Advance';
  } else {
    ActionIcon = CheckCircle2;
    actionLabel = 'Done';
  }

  return (
    <>
      {/* TOP ROW: #ID badge, Time pill, Selection / More actions menu */}
      <div className="flex items-center gap-2">
        {selectMode ? (
          <span
            aria-hidden
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition-all',
              selected ? 'border-white bg-white text-slate-900 shadow-sm' : 'border-current/30 bg-[var(--well-on)] text-transparent',
            )}
          >
            {selected && <Check className="size-3.5 stroke-[3]" />}
          </span>
        ) : (
          <span className="ob-chip tabular-nums">#{leadSeq}</span>
        )}

        {followUp ? (
          <span className={cn('ob-chip', followUp.overdue && 'is-late')}>
            <CalendarClock className="size-3.5" />
            <span>{followUp.text}</span>
          </span>
        ) : (
          <span className="ob-chip">
            <span>⏱ {formatAge(lead.createdAt, now)}</span>
          </span>
        )}

        {/* Three-dots menu for Move to Stage and other actions */}
        {stages && stages.length > 0 && onMove && !selectMode && (
          <div className="ml-auto flex items-center">
            <MoveMenu
              leadName={lead.name}
              stageId={stage?.id ?? lead.stageId}
              stages={stages}
              touch={compact}
              onMove={onMove}
              onOpenChange={onOpenChange}
              trigger={
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="ob-face__more flex size-7 shrink-0 items-center justify-center rounded-full border border-current/25 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                  aria-label={`Options for ${lead.name}`}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* SUBJECT / TITLE ROW: Left Squircle pill with icon + Large bold Contact Name */}
      <div className="flex items-center gap-2.5">
        <div className="ob-ch">
          {lead.companyName ? <Building2 className="size-4" /> : <UserRound className="size-4" />}
        </div>
        <span id={nameId} data-lead-name="" className="ob-where truncate">
          {lead.name}
        </span>
      </div>

      {/* INNER ITEMS BOX (.ob-lines): Company, Phone, Tags, Notes */}
      <div id={detailsId} className="ob-lines">
        {lead.companyName && (
          <div className="flex items-center gap-1.5 truncate opacity-90">
            <Building2 className="size-3.5 shrink-0 opacity-70" />
            <span data-lead-company="" className="truncate font-semibold">
              {lead.companyName}
            </span>
          </div>
        )}
        {lead.phone && (
          <div className="flex items-center gap-1.5 truncate opacity-85">
            <Phone className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate tabular font-medium">{lead.phone}</span>
          </div>
        )}
        {lead.tags && lead.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {lead.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-black/10 dark:bg-white/10 text-[11px] font-bold"
              >
                {tag}
              </span>
            ))}
            {lead.tags.length > 2 && (
              <span className="text-[11px] font-bold opacity-75">+{lead.tags.length - 2}</span>
            )}
          </div>
        )}
      </div>

      {/* FOOTER ROW: Owner Avatar + Bold INR Amount on Left; Quick Action Pill (.ob-go) on Right */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          {lead.owner ? (
            <Avatar name={lead.owner.name} size="xs" className="ring-2 ring-white/60 shrink-0" />
          ) : (
            <span className="size-6 shrink-0 rounded-full border border-dashed border-current/40 flex items-center justify-center text-2xs opacity-75">
              ?
            </span>
          )}
          <span data-lead-value="" className="ob-amt truncate tabular-nums">
            {formatInr(lead.valueInr, { compact: true })}
          </span>
        </div>

        {onQuickAction && !selectMode && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onQuickAction();
            }}
            style={{
              backgroundColor: 'var(--pill-bg, #2b2110)',
              color: 'var(--pill-fg, #ffffff)',
            }}
            className={cn(
              'ob-go flex items-center gap-1.5 rounded-full font-bold transition-transform hover:scale-105 active:scale-95 shadow-sm',
              compact ? 'h-7 px-3 text-[11px]' : 'h-8 px-3.5 text-xs',
            )}
            title={actionLabel}
          >
            <ActionIcon className="size-3.5 stroke-[2.5]" />
            <span>{actionLabel}</span>
          </button>
        )}
      </div>
    </>
  );
}

type PlaceholderKind = 'none' | 'origin' | 'target' | 'deck';

function placeholderOf(s: DragState, id: string, stageId: string): PlaceholderKind {
  const a = s.active;
  if (!a) return 'none';
  if (a.lead.id !== id) return s.phase === 'dragging' && a.deckIds.has(id) ? 'deck' : 'none';
  if (s.phase === 'dropping') return 'target';
  if (s.over && s.over.stageId === stageId && stageId === a.fromStageId && s.over.index === a.originIndex) return 'target';
  return 'origin';
}

/** Specular sheen follows a fine pointer (CSS shows it only when the board allows sheen). */
function trackSheen(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--vb-sx', `${Math.round(e.clientX - r.left)}px`);
  el.style.setProperty('--vb-sy', `${Math.round(e.clientY - r.top)}px`);
}

export interface BoardCardProps {
  lead: LeadListItem;
  stageId: string;
  index: number;
  compact: boolean;
  canDrag: boolean;
  canMove: boolean;
  selectMode: boolean;
  showQuick: boolean;
  alwaysShowActions: boolean;
  stages: readonly Stage[];
  now: number;
  instructionsId?: string;
  enterDelay?: number;
  virtualStart?: number;
  measure?: (el: Element | null) => void;
  setSize?: number;
}

/**
 * Board card: Tavola Order style card with ambient glow, hover elevation, and interactive action button.
 */
export const BoardCard = memo(function BoardCard({
  lead,
  stageId,
  index,
  compact,
  canDrag,
  canMove: _canMove,
  selectMode,
  showQuick: _showQuick,
  alwaysShowActions: _alwaysShowActions,
  stages,
  now,
  instructionsId,
  enterDelay,
  virtualStart,
  measure,
  setSize,
}: BoardCardProps) {
  const ctrl = useBoardController();
  const actions = useLeadActions();
  const placeholder = useDragState((s) => placeholderOf(s, lead.id, stageId));
  const selected = useLeadsViewState((s) => s.selectedIds.has(lead.id));
  const toggleSelected = useLeadsViewState((s) => s.toggleSelected);
  const nudgeRef = useRef<HTMLDivElement>(null);
  const y = useSpringValue(0, {
    onChange: (r: { value: number }) => writeNudge(nudgeRef.current, r.value),
    onRest: (r: { value: number }) => writeNudge(nudgeRef.current, r.value),
  });
  const [_hovered, setHovered] = useState(false);
  const [_focused, setFocused] = useState(false);
  const [_menuOpen, setMenuOpen] = useState(false);
  const liRef = useRef<HTMLLIElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  const setLi = useCallback(
    (el: HTMLLIElement | null) => {
      liRef.current = el;
      measure?.(el);
    },
    [measure],
  );

  useLayoutEffect(() => {
    const li = liRef.current;
    const card = cardRef.current;
    const nudge = nudgeRef.current;
    const list = li?.parentElement;
    if (!li || !card || !nudge || !list) return;
    const h: CardHandle = { id: lead.id, stageId, li, card, list, ring: ringRef.current, y, nudge, restTop: 0, height: 0, shift: 0, shiftTimer: 0 };
    ctrl.registerCard(h);
    return () => ctrl.unregisterCard(h);
  }, [ctrl, lead.id, stageId, y]);

  useLayoutEffect(() => {
    if (virtualStart !== undefined && liRef.current) ctrl.setRestTop(lead.id, liRef.current, virtualStart);
  }, [ctrl, lead.id, virtualStart]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // If the press started inside a button, link, or dropdown, don't initiate a card drag
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, [role="button"], [role="menuitem"], a, input, select, textarea, [data-radix-collection-item]')) {
      return;
    }
    ctrl.pointerDown(e, lead, stageId);
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    // If click was on a button, dropdown menu, or interactive control, NEVER open the lead drawer!
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, [role="button"], [role="menuitem"], a, input, select, textarea, [data-radix-collection-item]')) {
      return;
    }
    if (ctrl.consumeClick()) return;
    if (selectMode) toggleSelected(lead.id);
    else actions.open(lead);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (selectMode && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      toggleSelected(lead.id);
      return;
    }
    if (ctrl.keyDown(e, lead, stageId)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      actions.open(lead);
    }
  };

  const isPlaceholder = placeholder !== 'none';
  const virtual = virtualStart !== undefined;
  const hot = lead.temperature === 'hot';
  const overdue = isOverdue(lead, stages.find((s) => s.id === stageId)?.type, now);

  const stageIndex = stages.findIndex((s) => s.id === stageId);
  const currentStage = stages[stageIndex];
  const tavolaTheme = getTavolaTheme(stageIndex, currentStage);

  const onQuickAction = () => {
    if (stageIndex === 0 && lead.phone) {
      actions.call(lead);
    } else if (stageIndex === 1 && lead.phone) {
      actions.whatsapp(lead);
    } else if (stageIndex < stages.length - 1) {
      const nextStage = stages[stageIndex + 1];
      if (nextStage) {
        ctrl.moveToStage(lead, stageId, nextStage.id);
      }
    }
  };

  return (
    <li
      ref={setLi}
      data-index={index}
      data-lead-id={lead.id}
      aria-setsize={virtual ? setSize : undefined}
      aria-posinset={virtual ? index + 1 : undefined}
      className={cn('vb-li relative', virtual && 'absolute inset-x-0 top-0')}
      style={virtual ? { transform: `translateY(${virtualStart}px)` } : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div ref={nudgeRef} className="relative">
        <div
          className={cn('vb-lift relative', enterDelay !== undefined && 'vb-enter')}
          data-placeholder={isPlaceholder ? placeholder : undefined}
          style={enterDelay !== undefined ? { animationDelay: `${enterDelay}ms` } : undefined}
        >
          <div aria-hidden className="vb-lip" />
          {hot && <span aria-hidden className="vb-aura" data-hot="" />}
          <div
            ref={cardRef}
            role={selectMode ? 'checkbox' : 'button'}
            tabIndex={0}
            aria-checked={selectMode ? selected : undefined}
            aria-roledescription={canDrag ? 'draggable card' : undefined}
            aria-describedby={instructionsId}
            data-placeholder={isPlaceholder ? placeholder : undefined}
            onPointerDown={canDrag ? onPointerDown : undefined}
            onPointerMove={trackSheen}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onBlur={() => ctrl.blur(lead.id)}
            className={cn(
              cardSurface(compact, tavolaTheme.cardClass),
              'vb-face outline-none select-none [-webkit-touch-callout:none]',
              canDrag ? 'cursor-grab touch-manipulation' : 'cursor-pointer',
              !isPlaceholder && 'focus-ring',
              !isPlaceholder && (selected ? 'ring-2 ring-white shadow-lg' : ''),
              isPlaceholder && 'border-transparent bg-transparent outline-2 -outline-offset-2 outline-dashed [&>*]:invisible',
              (placeholder === 'origin' || placeholder === 'deck') && 'outline-border-strong',
              placeholder === 'target' && 'bg-accent-soft/50 outline-accent',
            )}
          >
            <span aria-hidden className="vb-sheen" />
            <LeadCardBody
              lead={lead}
              compact={compact}
              now={now}
              selectMode={selectMode}
              selected={selected}
              theme={tavolaTheme.tone}
              stageIndex={stageIndex}
              stage={currentStage}
              stages={stages}
              onQuickAction={onQuickAction}
              onMove={(to) => ctrl.moveToStage(lead, stageId, to)}
              onOpenChange={setMenuOpen}
            />
          </div>
          {overdue && <span aria-hidden className="vb-overdue-edge" data-overdue="" />}
          <span ref={ringRef} aria-hidden className="vb-ring" />
        </div>
      </div>
    </li>
  );
});
