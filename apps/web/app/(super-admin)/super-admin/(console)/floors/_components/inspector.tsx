'use client';

import {
  FLOOR_SEAT_KINDS,
  FLOOR_ZONE_KINDS,
  type FloorSeatKind,
  type SeatMap,
} from '@vistar/shared';
import { Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, Input } from '@/components/ui/input';
import {
  addCorner,
  removeCorner,
  removeSeat,
  removeZone,
  SEAT_KIND_LABEL,
  snapAngle,
  updateSeat,
  updateZone,
  ZONE_KIND_LABEL,
  type Selection,
  type Zone,
} from './seat-model';

/** Numbers and names of the selected seat or zone (the keyboard path of the seat tool), or the overview. */
export function Inspector({
  map,
  onChange,
  selection,
  onSelect,
  readOnly,
  model,
  headcount,
}: {
  map: SeatMap;
  onChange: (next: SeatMap) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  readOnly: boolean;
  /** GLB / glTF floors: model placement (scale and origin) and its raw size. */
  model: { raw: { min: [number, number, number]; max: [number, number, number] } | null } | null;
  headcount: number | null;
}) {
  const seat =
    selection?.kind === 'seat' ? map.seats.find((s) => s.id === selection.id) : undefined;
  const zone =
    selection?.kind === 'zone' ? map.zones.find((z) => z.id === selection.id) : undefined;

  if (seat) {
    return (
      <Card data-inspector="seat">
        <CardHeader>
          <CardTitle>Seat {seat.label ?? seat.id}</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Done
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <IdField
            key={seat.id}
            value={seat.id}
            taken={map.seats.map((s) => s.id)}
            disabled={readOnly}
            onCommit={(id) => {
              onChange({
                ...map,
                seats: map.seats.map((s) => (s.id === seat.id ? { ...s, id } : s)),
              });
              onSelect({ kind: 'seat', id });
            }}
          />
          <FormField label="Label" hint="Shown in the seat list, e.g. Desk 4">
            <Input
              value={seat.label ?? ''}
              maxLength={60}
              disabled={readOnly}
              onChange={(e) =>
                onChange(updateSeat(map, seat.id, { label: e.target.value || null }))
              }
            />
          </FormField>
          <FormField label="Kind" hint="Desks are given out in desk order; cabins to fixed people">
            <NativeSelect
              value={seat.kind}
              disabled={readOnly}
              onChange={(e) =>
                onChange(updateSeat(map, seat.id, { kind: e.target.value as FloorSeatKind }))
              }
            >
              {FLOOR_SEAT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SEAT_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Zone">
            <NativeSelect
              value={seat.zoneId ?? ''}
              disabled={readOnly}
              onChange={(e) =>
                onChange(updateSeat(map, seat.id, { zoneId: e.target.value || null }))
              }
            >
              <option value="">No zone</option>
              {map.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <NumberField
            label="Across (x, m)"
            value={seat.position[0]}
            step={0.05}
            disabled={readOnly}
            onChange={(v) =>
              onChange(updateSeat(map, seat.id, { position: [v, 0, seat.position[2]] }, true))
            }
          />
          <NumberField
            label="Down (z, m)"
            value={seat.position[2]}
            step={0.05}
            disabled={readOnly}
            onChange={(v) =>
              onChange(updateSeat(map, seat.id, { position: [seat.position[0], 0, v] }, true))
            }
          />
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <NumberField
              label="Faces (degrees, 0 = down the plan, 90 = right)"
              value={seat.rotation}
              step={15}
              min={-360}
              max={360}
              disabled={readOnly}
              onChange={(v) => onChange(updateSeat(map, seat.id, { rotation: v }))}
            />
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={readOnly}
                onClick={() =>
                  onChange(updateSeat(map, seat.id, { rotation: snapAngle(seat.rotation - 15) }))
                }
              >
                <RotateCcw aria-hidden />
                15°
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={readOnly}
                onClick={() =>
                  onChange(updateSeat(map, seat.id, { rotation: snapAngle(seat.rotation + 15) }))
                }
              >
                <RotateCw aria-hidden />
                15°
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={readOnly}
                onClick={() =>
                  onChange(updateSeat(map, seat.id, { rotation: snapAngle(seat.rotation + 90) }))
                }
              >
                <RotateCw aria-hidden />
                90°
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-danger-text"
                disabled={readOnly}
                onClick={() => {
                  onChange(removeSeat(map, seat.id));
                  onSelect(null);
                }}
              >
                <Trash2 aria-hidden />
                Delete seat
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (zone) {
    const vertex = selection?.kind === 'zone' ? selection.vertex : undefined;
    const inside = map.seats.filter((s) => s.zoneId === zone.id).length;
    return (
      <Card data-inspector="zone">
        <CardHeader>
          <CardTitle>Zone {zone.name}</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Done
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" hint="Shown on the Team Floor and in the office markers">
            <Input
              value={zone.name}
              maxLength={60}
              disabled={readOnly}
              onChange={(e) =>
                onChange(updateZone(map, zone.id, { name: e.target.value || zone.name }))
              }
            />
          </FormField>
          <FormField label="Kind">
            <NativeSelect
              value={zone.kind}
              disabled={readOnly}
              onChange={(e) =>
                onChange(updateZone(map, zone.id, { kind: e.target.value as Zone['kind'] }))
              }
            >
              {FLOOR_ZONE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ZONE_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <p className="text-xs text-muted-strong sm:col-span-2">
            Id <span className="font-mono">{zone.id}</span> · {zone.polygon.length} corners ·{' '}
            {inside} {inside === 1 ? 'seat' : 'seats'}. Office markers (beacons, QR codes) point to
            this id.
          </p>
          <div className="flex flex-wrap gap-1 sm:col-span-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={readOnly || zone.polygon.length >= 64}
              onClick={() => onChange(addCorner(map, zone.id))}
            >
              <Plus aria-hidden />
              Add a corner
            </Button>
            {vertex !== undefined && (
              <Button
                size="sm"
                variant="secondary"
                disabled={readOnly || zone.polygon.length <= 3}
                onClick={() => {
                  onChange(removeCorner(map, zone.id, vertex));
                  onSelect({ kind: 'zone', id: zone.id });
                }}
              >
                Remove corner {vertex + 1}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-danger-text"
              disabled={readOnly}
              onClick={() => {
                onChange(removeZone(map, zone.id));
                onSelect(null);
              }}
            >
              <Trash2 aria-hidden />
              Delete zone
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const byKind = FLOOR_SEAT_KINDS.map(
    (k) => [k, map.seats.filter((s) => s.kind === k).length] as const,
  ).filter(([, n]) => n > 0);
  const desks = map.seats.filter((s) => s.kind === 'desk').length;
  return (
    <Card data-inspector="overview">
      <CardHeader>
        <CardTitle>Seats and zones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-fg">
          {map.seats.length} {map.seats.length === 1 ? 'seat' : 'seats'}
          {byKind.length > 0 && (
            <span className="text-muted-strong">
              {' '}
              ({byKind.map(([k, n]) => `${n} ${SEAT_KIND_LABEL[k].toLowerCase()}`).join(', ')})
            </span>
          )}
          {headcount !== null && (
            <span
              className={
                desks + map.seats.filter((s) => s.kind === 'cabin').length < headcount
                  ? ' text-warning-text'
                  : ' text-muted-strong'
              }
            >
              {' '}
              for {headcount} people
            </span>
          )}
          .
        </p>
        <div>
          <p className="mb-1 text-xs font-medium text-fg-secondary">Zones</p>
          {map.zones.length ? (
            <ul className="flex flex-wrap gap-1">
              {map.zones.map((z) => (
                <li key={z.id}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onSelect({ kind: 'zone', id: z.id })}
                  >
                    {z.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">
              No zones yet. Use the zone tool to mark rooms: zone tracking and office markers need
              them.
            </p>
          )}
        </div>
        <details>
          <summary className="focus-ring cursor-pointer rounded-sm text-xs font-medium text-fg-secondary">
            Pick a seat from the list
          </summary>
          <ul className="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {map.seats.map((s) => (
              <li key={s.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onSelect({ kind: 'seat', id: s.id })}
                >
                  {s.label ?? s.id}
                </Button>
              </li>
            ))}
          </ul>
        </details>
        {model && <Placement map={map} onChange={onChange} readOnly={readOnly} raw={model.raw} />}
      </CardContent>
    </Card>
  );
}

const UNITS = [
  { label: 'Metres', scale: 1 },
  { label: 'Centimetres', scale: 0.01 },
  { label: 'Millimetres', scale: 0.001 },
  { label: 'Inches', scale: 0.0254 },
  { label: 'Feet', scale: 0.3048 },
];

function Placement({
  map,
  onChange,
  readOnly,
  raw,
}: {
  map: SeatMap;
  onChange: (next: SeatMap) => void;
  readOnly: boolean;
  raw: { min: [number, number, number]; max: [number, number, number] } | null;
}) {
  const unit = UNITS.find((u) => Math.abs(u.scale - map.scale) < 1e-9);
  const size = raw
    ? [(raw.max[0] - raw.min[0]) * map.scale, (raw.max[2] - raw.min[2]) * map.scale]
    : null;
  return (
    <section
      aria-label="Model placement"
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <p className="text-xs font-semibold text-fg">Model placement</p>
      <p className="text-xs text-muted-strong">
        The model is drawn at (model point - origin) x scale.
        {size && ` Size now: ${size[0]!.toFixed(1)} x ${size[1]!.toFixed(1)} m.`} Offices are
        usually 10 to 60 m wide.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Model units">
          <NativeSelect
            value={unit ? String(unit.scale) : ''}
            disabled={readOnly}
            onChange={(e) => e.target.value && onChange({ ...map, scale: Number(e.target.value) })}
          >
            {!unit && <option value="">Custom scale</option>}
            {UNITS.map((u) => (
              <option key={u.label} value={String(u.scale)}>
                {u.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <NumberField
          label="Scale"
          value={map.scale}
          step={0.01}
          min={0.0001}
          max={1000}
          disabled={readOnly}
          onChange={(v) => v > 0 && onChange({ ...map, scale: v })}
        />
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <NumberField
            key={axis}
            label={`Origin ${axis} (model units)`}
            value={map.origin[i]!}
            step={0.1}
            disabled={readOnly}
            onChange={(v) =>
              onChange({
                ...map,
                origin: map.origin.map((o, j) => (j === i ? v : o)) as [number, number, number],
              })
            }
          />
        ))}
      </div>
      {raw && (
        <Button
          size="sm"
          variant="secondary"
          disabled={readOnly}
          className="self-start"
          onClick={() => onChange({ ...map, origin: [...raw.min] as [number, number, number] })}
        >
          Put the model&apos;s corner at 0, 0 on the floor
        </Button>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <FormField label={label}>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        value={text ?? String(Math.round(value * 1000) / 1000)}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number.parseFloat(e.target.value);
          if (
            Number.isFinite(v) &&
            (min === undefined || v >= min) &&
            (max === undefined || v <= max)
          )
            onChange(v);
        }}
        onBlur={() => setText(null)}
      />
    </FormField>
  );
}

function IdField({
  value,
  taken,
  onCommit,
  disabled,
}: {
  value: string;
  taken: string[];
  onCommit: (id: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(value);
  const error = !/^[A-Za-z0-9_-]{1,40}$/.test(text)
    ? 'Letters, digits, - or _ (up to 40)'
    : text !== value && taken.includes(text)
      ? 'Another seat has this id'
      : null;
  return (
    <FormField
      label="Seat id"
      error={error ?? undefined}
      hint="The server and the Android app refer to the seat by this id"
    >
      <Input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!error && text !== value) onCommit(text);
          else if (error) setText(value);
        }}
        className="font-mono"
      />
    </FormField>
  );
}
