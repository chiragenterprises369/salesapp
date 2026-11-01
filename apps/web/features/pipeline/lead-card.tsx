'use client';

import { animated, useSpringValue } from '@react-spring/web';
import { formatInr, type LeadListItem, type Stage } from '@vistar/shared';
import { CalendarClock, Check, UserRound } from 'lucide-react';
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LeadQuickActions, useLeadActions } from '@/components/leads-shared/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useLeadsViewState } from '@/lib/leads/state';
import { useBoardController, useDragState } from './drag/context';
import type { CardHandle, DragState } from './drag/types';
import { followUpLabel } from './hooks';
import { MoveMenu } from './move-menu';
import { TEMPERATURE_DOT, TEMPERATURE_NAME } from './tones';
import { useBoardWords } from './words';

/** Width one touch action takes in compact cards (44 px button + 2 px gap). */
const TOUCH_ACTION_WIDTH = 46;

/** Card face shared by the real card and the drag ghost. */
export function cardSurface(compact: boolean): string {
  return cn('relative flex flex-col rounded-lg border border-border bg-surface text-left', compact ? 'gap-1 p-2.5' : 'gap-1.5 p-3');
}

export interface LeadCardBodyProps {
  lead: LeadListItem;
  compact: boolean;
  now: number;
  selectMode?: boolean;
  selected?: boolean;
  /** Compact cards reserve room on the meta row for always-visible touch actions. */
  reserveActions?: number;
  nameId?: string;
  detailsId?: string;
}

function Owner({ lead }: { lead: LeadListItem }) {
  if (lead.owner) {
    return (
      <span className="flex shrink-0 items-center" title={`Owner: ${lead.owner.name}`}>
        <span className="sr-only">Owner</span>
        <Avatar name={lead.owner.name} size="xs" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted" title="Unassigned">
      <UserRound aria-hidden className="size-3" />
      <span className="sr-only">Unassigned</span>
    </span>
  );
}

function Tags({ tags, max }: { tags: readonly string[]; max: number }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const more = tags.length - shown.length;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      <span className="sr-only">Tags:</span>
      {shown.map((t) => (
        <Chip key={t} className="max-w-36 min-w-0 shrink">
          <span className="truncate">{t}</span>
        </Chip>
      ))}
      {more > 0 && (
        <Chip>
          <span aria-hidden>+{more}</span>
          <span className="sr-only">and {more} more</span>
        </Chip>
      )}
    </span>
  );
}

/** Card content (name, company, value, owner, tags, follow-up, temperature). Presentational. */
export function LeadCardBody({ lead, compact, now, selectMode = false, selected = false, reserveActions = 0, nameId, detailsId }: LeadCardBodyProps) {
  const words = useBoardWords();
  const temperature = `${TEMPERATURE_NAME[lead.temperature]} ${words.oneLower}`;
  const followUp = lead.nextFollowUpAt ? followUpLabel(lead.nextFollowUpAt, now) : null;
  const followUpEl = followUp && (
    <span className={cn('flex min-w-0 items-center gap-1 text-xs', followUp.overdue ? 'font-medium text-danger-text' : 'text-muted')}>
      <CalendarClock aria-hidden className="size-3.5 shrink-0" />
      <span aria-hidden className="truncate">
        {followUp.text}
      </span>
      <span className="sr-only">{followUp.spoken}</span>
    </span>
  );
  return (
    <>
      <div className="relative flex items-start gap-2">
        {selectMode && (
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border',
              selected ? 'border-accent bg-accent text-accent-fg' : 'border-input bg-surface',
            )}
          >
            {selected && <Check className="size-3" strokeWidth={3} />}
          </span>
        )}
        <span aria-hidden title={temperature} className={cn('mt-1.5 size-2 shrink-0 rounded-full', TEMPERATURE_DOT[lead.temperature])} />
        <span id={nameId} className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
          {lead.name}
        </span>
        <span className="shrink-0 text-sm font-semibold text-fg tabular">{formatInr(lead.valueInr, { compact: true })}</span>
      </div>
      <div id={detailsId} className={cn('relative flex min-w-0 flex-col', compact ? 'gap-1' : 'gap-1.5')}>
        <span className="sr-only">{temperature}.</span>
        {compact ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{lead.companyName}</span>
            {followUpEl}
          </div>
        ) : (
          lead.companyName && <p className="truncate text-xs text-muted">{lead.companyName}</p>
        )}
        {!compact && lead.tags.length > 0 && <Tags tags={lead.tags} max={2} />}
        <div
          className={cn('flex min-w-0 items-center gap-1.5', compact ? (reserveActions ? 'h-11' : 'h-6') : 'h-7')}
          style={reserveActions ? { paddingRight: reserveActions * TOUCH_ACTION_WIDTH } : undefined}
        >
          <Owner lead={lead} />
          {compact ? <Tags tags={lead.tags} max={1} /> : followUpEl}
        </div>
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
  /** Pointer and keyboard drag (leads.update; in select mode, pointer drags carry the selection). */
  canDrag: boolean;
  /** "Move to stage..." menu (leads.update). */
  canMove: boolean;
  selectMode: boolean;
  /** Call / WhatsApp / note quick actions. */
  showQuick: boolean;
  /** Compact or coarse pointer: actions always visible (no hover to reveal them). */
  alwaysShowActions: boolean;
  stages: readonly Stage[];
  now: number;
  /** Id of the hidden instructions for this mode (aria-describedby). */
  instructionsId?: string;
  /** Entrance animation delay (ms), first load only. */
  enterDelay?: number;
  /** Virtual lists only. */
  virtualStart?: number;
  measure?: (el: Element | null) => void;
  setSize?: number;
}

/**
 * Board card: a thick card (thickness edge, layered shadows, 1 px top highlight, pointer sheen)
 * that lifts slightly on hover. Memoised: during a drag it never re-renders (neighbour nudges are
 * springs on `y`); only the dragged card re-renders to become a placeholder.
 */
export const BoardCard = memo(function BoardCard({
  lead,
  stageId,
  index,
  compact,
  canDrag,
  canMove,
  selectMode,
  showQuick,
  alwaysShowActions,
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
  const y = useSpringValue(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const liRef = useRef<HTMLLIElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const nameId = useId();
  const detailsId = useId();

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
    const list = li?.parentElement;
    if (!li || !card || !list) return;
    const h: CardHandle = { id: lead.id, stageId, li, card, list, ring: ringRef.current, y, restTop: 0, height: 0, shift: 0, shiftTimer: 0 };
    ctrl.registerCard(h);
    return () => ctrl.unregisterCard(h);
  }, [ctrl, lead.id, stageId, y]);

  // Virtual rows: keep the rest position fresh (used when the card leaves this column).
  useLayoutEffect(() => {
    if (virtualStart !== undefined && liRef.current) ctrl.setRestTop(lead.id, liRef.current, virtualStart);
  }, [ctrl, lead.id, virtualStart]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => ctrl.pointerDown(e, lead, stageId);
  const onClick = () => {
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
  // Desktop hover actions mount on demand (hover, focus, open menu): hidden-but-mounted buttons on
  // every card cost real paint/layerize time while dragging. Touch layouts always show them.
  const engaged = alwaysShowActions || hovered || focused || menuOpen;
  const showActions = engaged && !selectMode && !isPlaceholder && (showQuick || canMove);
  const actionCount = (showQuick ? 3 : 0) + (canMove ? 1 : 0);
  const virtual = virtualStart !== undefined;
  const transform = useMemo(() => y.to((v) => (v === 0 ? 'none' : `translateY(${v}px)`)), [y]);

  return (
    <li
      ref={setLi}
      data-index={index}
      data-lead-id={lead.id}
      aria-setsize={virtual ? setSize : undefined}
      aria-posinset={virtual ? index + 1 : undefined}
      className={cn('vb-li relative', virtual && 'absolute inset-x-0 top-0')}
      style={virtual ? { transform: `translateY(${virtualStart}px)` } : undefined}
      onPointerEnter={alwaysShowActions ? undefined : () => setHovered(true)}
      onPointerLeave={alwaysShowActions ? undefined : () => setHovered(false)}
      onFocus={alwaysShowActions ? undefined : () => setFocused(true)}
      onBlur={
        alwaysShowActions
          ? undefined
          : (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
            }
      }
    >
      {/* 2D translate on purpose: translate3d would promote every nudged card to its own layer. */}
      <animated.div style={{ transform }} className="relative">
        <div
          className={cn('vb-lift relative', enterDelay !== undefined && 'vb-enter')}
          data-placeholder={isPlaceholder ? placeholder : undefined}
          style={enterDelay !== undefined ? { animationDelay: `${enterDelay}ms` } : undefined}
        >
          <div aria-hidden className="vb-lip" />
          <div
            ref={cardRef}
            role={selectMode ? 'checkbox' : 'button'}
            tabIndex={0}
            aria-checked={selectMode ? selected : undefined}
            aria-roledescription={canDrag ? 'draggable card' : undefined}
            aria-labelledby={nameId}
            aria-describedby={instructionsId ? `${detailsId} ${instructionsId}` : detailsId}
            data-placeholder={isPlaceholder ? placeholder : undefined}
            onPointerDown={canDrag ? onPointerDown : undefined}
            onPointerMove={trackSheen}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onBlur={() => ctrl.blur(lead.id)}
            className={cn(
              cardSurface(compact),
              'vb-face outline-none select-none [-webkit-touch-callout:none]',
              canDrag ? 'cursor-grab touch-manipulation' : 'cursor-pointer',
              !isPlaceholder && 'focus-ring',
              !isPlaceholder && (selected ? 'border-accent ring-1 ring-accent' : 'hover:border-border-strong'),
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
              reserveActions={compact && !selectMode ? actionCount : 0}
              nameId={nameId}
              detailsId={detailsId}
            />
          </div>
          <span ref={ringRef} aria-hidden className="vb-ring" />
          {showActions && (
            <div
              className={cn(
                'absolute flex items-center gap-0.5 rounded-md bg-surface',
                compact ? 'right-2.5 bottom-2.5' : 'right-2 bottom-2',
                !alwaysShowActions && 'vb-actions-in',
              )}
            >
              {showQuick && <LeadQuickActions lead={lead} size={compact ? 'touch' : 'sm'} />}
              {canMove && (
                <MoveMenu
                  leadName={lead.name}
                  stageId={stageId}
                  stages={stages}
                  touch={compact}
                  onOpenChange={setMenuOpen}
                  onMove={(to) => ctrl.moveToStage(lead, stageId, to)}
                />
              )}
            </div>
          )}
        </div>
      </animated.div>
    </li>
  );
});
