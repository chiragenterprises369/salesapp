'use client';

import { OFFICE_MARKER_KINDS, type OfficeMarker, type OfficeMarkerKind } from '@vistar/shared';
import {
  Bluetooth,
  Check,
  ClipboardCopy,
  Info,
  Nfc,
  Plus,
  Printer,
  QrCode as QrIcon,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/native-select';
import { QrCode } from '@/components/common/qr/qr-code';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { fieldErrorMap, isApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { useTeamFloorLayout } from '../state/layout/published';
import {
  MARKER_KIND_LABEL,
  markerProblems,
  normalizeBssid,
  useCreateMarker,
  useDeleteMarker,
  useOfficeMarkers,
  zoneIdFrom,
} from './data';
import { printQrSheet } from './qr-sheet';

/**
 * Settings > Office markers (SPEC 29.11, company admin): what tells the Android app which room of the
 * published floor someone is in. BLE beacons (best, one per room), the office Wi-Fi (in the office or
 * not), QR codes and NFC tags at doors and desks (exact, scanned). QR / NFC codes are shown once.
 */

const KIND_ICON: Record<OfficeMarkerKind, ReactNode> = {
  ble_beacon: <Bluetooth aria-hidden />,
  wifi_ap: <Wifi aria-hidden />,
  qr: <QrIcon aria-hidden />,
  nfc: <Nfc aria-hidden />,
};
const KIND_HINT: Record<OfficeMarkerKind, string> = {
  ble_beacon:
    'Most accurate for rooms (about 1 to 3 m). Stick one beacon per room; phones detect it automatically.',
  wifi_ap:
    'Tells whether someone is in the office, sometimes which part. Android scans Wi-Fi only a few times a minute.',
  qr: 'Exact: people scan the printed code at a door or desk with the app.',
  nfc: 'Exact: people tap the tag with their phone. Write the code to an NFC sticker with any NFC writer app.',
};

const COLUMNS: DataColumn[] = [
  { key: 'marker', label: 'Marker' },
  { key: 'zone', label: 'Room' },
  { key: 'details', label: 'Details', hideBelow: 'md' },
  { key: 'created', label: 'Added', hideBelow: 'lg' },
  { key: 'actions', label: 'Actions', align: 'right' },
];

export function OfficeMarkersSettings() {
  const layout = useTeamFloorLayout();
  const markers = useOfficeMarkers();
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const zones = useMemo(() => layout.data?.floor?.seatMap.zones ?? [], [layout.data]);
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
  const [created, setCreated] = useState<OfficeMarker | null>(null);
  const [removing, setRemoving] = useState<OfficeMarker | null>(null);
  const [zoneFilter, setZoneFilter] = useState('');
  const remove = useDeleteMarker();

  const rows = (markers.data ?? []).filter((m) => !zoneFilter || m.zoneId === zoneFilter);
  const state = markers.isPending
    ? 'loading'
    : markers.isError
      ? 'error'
      : (markers.data?.length ?? 0) === 0
        ? 'empty'
        : 'ready';
  const published = !!layout.data?.floor;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex items-start gap-3 pt-4">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-secondary" />
          <div className="flex flex-col gap-1 text-sm text-fg-secondary">
            <p>
              Markers place people in a room on the Live Team Floor. The Android app reads them; the
              web panel only reports which screen is open. Rooms come from your published floor
              {published
                ? '.'
                : ' (none yet: you can still add markers by room name, and pick the floor rooms once Vistar publishes your office).'}
            </p>
            <p className="text-xs text-muted-strong">
              Limits: Vistar cannot see whether someone sits at their desk, and rooms are not
              tracked outside your working hours.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <CreateMarker
          zones={zones}
          layoutLoading={layout.isPending}
          onCreated={(m) =>
            m.token
              ? setCreated(m)
              : toast.success(`${MARKER_KIND_LABEL[m.kind]} added to ${zoneName(m.zoneId)}.`)
          }
        />

        <DataTable
          label="Office markers"
          columns={COLUMNS}
          status={state}
          onRetry={() => void markers.refetch()}
          toolbar={
            <>
              <label className="w-full max-w-56">
                <span className="sr-only">Filter by room</span>
                <NativeSelect
                  size="sm"
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                >
                  <option value="">All rooms</option>
                  {[...new Set((markers.data ?? []).map((m) => m.zoneId))].map((id) => (
                    <option key={id} value={id}>
                      {zoneName(id)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              {state === 'ready' && (
                <span className="ml-auto text-xs text-muted tabular" aria-live="polite">
                  {rows.length} {rows.length === 1 ? 'marker' : 'markers'}
                </span>
              )}
            </>
          }
          empty={{
            icon: <Bluetooth />,
            title: 'No office markers yet',
            description:
              'Add a beacon or a QR code for each room. People then show up in that room on the Team Floor.',
          }}
        >
          {rows.length === 0 && (
            <TableRow className="hover:bg-surface">
              <TableCell colSpan={COLUMNS.length} className="py-6 text-center text-sm text-muted">
                No markers in this room yet.
              </TableCell>
            </TableRow>
          )}
          {rows.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="py-2">
                <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-fg-secondary">
                  {KIND_ICON[m.kind]}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{m.label}</span>
                    <span className="block text-xs text-muted">{MARKER_KIND_LABEL[m.kind]}</span>
                  </span>
                </span>
              </TableCell>
              <TableCell className="py-2">
                <span className="flex items-center gap-1.5">
                  {zoneName(m.zoneId)}
                  {published && !zones.some((z) => z.id === m.zoneId) && (
                    <Chip tone="amber">Not on the floor</Chip>
                  )}
                </span>
              </TableCell>
              <TableCell
                className={cn(columnClass(COLUMNS[2]!), 'py-2 font-mono text-xs text-fg-secondary')}
              >
                {m.beacon ? (
                  `${m.beacon.uuid} · ${m.beacon.major}/${m.beacon.minor}`
                ) : m.bssid ? (
                  m.bssid
                ) : (
                  <span className="font-sans">Code shown once when added</span>
                )}
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[3]!), 'py-2 text-fg-secondary')}>
                {formatDateTimeIn(m.createdAt, tz)}
              </TableCell>
              <TableCell className="py-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger-text"
                  onClick={() => setRemoving(m)}
                  aria-label={`Delete ${m.label}`}
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </div>

      <TokenDialog
        marker={created}
        roomName={created ? zoneName(created.zoneId) : ''}
        company={me?.workspace.name ?? null}
        onClose={() => setCreated(null)}
      />

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {removing?.label}?</DialogTitle>
            <DialogDescription>
              Phones stop using it at once.
              {removing && (removing.kind === 'qr' || removing.kind === 'nfc')
                ? ' Printed codes and written tags stop working; remove them from the room.'
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                removing &&
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    toast.success(`${removing.label} deleted.`);
                    setRemoving(null);
                  },
                  onError: (e) =>
                    toast.error(
                      isApiRequestError(e) ? e.message : 'The marker was not deleted. Try again.',
                    ),
                })
              }
            >
              Delete marker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateMarker({
  zones,
  layoutLoading,
  onCreated,
}: {
  zones: { id: string; name: string }[];
  layoutLoading: boolean;
  onCreated: (m: OfficeMarker) => void;
}) {
  const create = useCreateMarker();
  const [kind, setKind] = useState<OfficeMarkerKind>('ble_beacon');
  const [zoneId, setZoneId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [label, setLabel] = useState('');
  const [uuid, setUuid] = useState('');
  const [major, setMajor] = useState('');
  const [minor, setMinor] = useState('');
  const [bssid, setBssid] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hasZones = zones.length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const zone = hasZones ? zoneId : zoneIdFrom(roomName);
    const errs = markerProblems({ kind, zoneId: zone, label, uuid, major, minor, bssid });
    if (!hasZones && !roomName.trim()) errs.zoneId = 'Enter the room name.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const m = await create.mutateAsync({
        kind,
        zoneId: zone,
        label: label.trim(),
        ...(kind === 'ble_beacon'
          ? {
              beacon: {
                uuid: uuid.trim().toLowerCase(),
                major: Number(major),
                minor: Number(minor),
              },
            }
          : {}),
        ...(kind === 'wifi_ap' ? { bssid: normalizeBssid(bssid) } : {}),
      });
      onCreated(m);
      setLabel('');
      setUuid('');
      setMajor('');
      setMinor('');
      setBssid('');
    } catch (err) {
      const map = fieldErrorMap(err);
      setErrors({
        ...map,
        form: isApiRequestError(err) ? err.message : 'The marker was not added. Try again.',
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Add a marker</CardTitle>
          <CardDescription>{KIND_HINT[kind]}</CardDescription>
        </div>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Marker type" className="grid grid-cols-2 gap-1.5">
            {OFFICE_MARKER_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setErrors({});
                }}
                className="focus-ring flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-fg-secondary hover:bg-surface-2 aria-checked:border-ring aria-checked:bg-accent-soft aria-checked:text-accent-soft-fg [&_svg]:size-4"
              >
                {KIND_ICON[k]}
                {MARKER_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {hasZones || layoutLoading ? (
            <FormField label="Room" required error={errors.zoneId}>
              <NativeSelect
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                disabled={layoutLoading}
              >
                <option value="">
                  {layoutLoading ? 'Loading rooms…' : 'Pick a room of your floor'}
                </option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : (
            <FormField
              label="Room name"
              required
              error={errors.zoneId}
              hint="Your floor is not published yet, so type the room name"
            >
              <Input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={40}
                placeholder="Conference room"
              />
            </FormField>
          )}
          <FormField
            label={kind === 'wifi_ap' ? 'Network name (SSID)' : 'Name'}
            required
            error={errors.label}
            hint={
              kind === 'wifi_ap'
                ? 'As phones show it, e.g. Sharma-Office-5G'
                : 'Where it is, e.g. "Conference room door"'
            }
          >
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </FormField>
          {kind === 'ble_beacon' && (
            <>
              <FormField
                label="Beacon UUID"
                required
                error={errors.uuid}
                hint="From the beacon's box or its setup app (iBeacon)"
              >
                <Input
                  value={uuid}
                  onChange={(e) => setUuid(e.target.value)}
                  placeholder="f7826da6-4fa2-4e98-8024-bc5b71e0893e"
                  spellCheck={false}
                  className="font-mono"
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Major" required error={errors.major}>
                  <Input
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                    inputMode="numeric"
                    placeholder="1"
                  />
                </FormField>
                <FormField label="Minor" required error={errors.minor}>
                  <Input
                    value={minor}
                    onChange={(e) => setMinor(e.target.value)}
                    inputMode="numeric"
                    placeholder="12"
                  />
                </FormField>
              </div>
            </>
          )}
          {kind === 'wifi_ap' && (
            <FormField
              label="Access point address (BSSID)"
              required
              error={errors.bssid}
              hint="One per access point; add each router or extender separately"
            >
              <Input
                value={bssid}
                onChange={(e) => setBssid(e.target.value)}
                onBlur={() => bssid && setBssid(normalizeBssid(bssid))}
                placeholder="3c:84:6a:12:9f:20"
                spellCheck={false}
                className="font-mono"
              />
            </FormField>
          )}
          {(kind === 'qr' || kind === 'nfc') && (
            <p className="text-xs text-muted-strong">
              Vistar makes a secret code for this {kind === 'qr' ? 'QR code' : 'tag'}. You see it
              once, right after adding, with a printable sheet.
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          {errors.form && (
            <p role="alert" className="mr-auto text-xs text-danger-text">
              {errors.form}
            </p>
          )}
          <Button type="submit" variant="primary" loading={create.isPending}>
            <Plus aria-hidden />
            Add marker
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function TokenDialog({
  marker,
  roomName,
  company,
  onClose,
}: {
  marker: OfficeMarker | null;
  roomName: string;
  company: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const token = marker?.token ?? '';
  return (
    <Dialog open={!!marker} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {marker && (
          <>
            <DialogHeader>
              <DialogTitle>
                Save this {marker.kind === 'qr' ? 'QR code' : 'NFC code'} now
              </DialogTitle>
              <DialogDescription>
                It is shown only once. Vistar keeps a fingerprint of it, not the code itself.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col items-center gap-3">
              {marker.kind === 'qr' && (
                <QrCode value={token} label={`QR code for ${roomName}`} size={200} />
              )}
              <p className="text-sm font-medium text-fg">{roomName}</p>
              <code
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs break-all text-fg"
                data-marker-token=""
              >
                {token}
              </code>
              {marker.kind === 'nfc' && (
                <p className="text-xs text-muted-strong">
                  Write this text to an NFC sticker (NDEF text record) with an NFC writer app, then
                  stick it at the door.
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(token)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() =>
                      toast.error('Copy did not work. Select the code and press Ctrl+C.'),
                    )
                }
              >
                {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              {marker.kind === 'qr' && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    !printQrSheet({ token, roomName, label: marker.label, company }) &&
                    toast.error('Allow pop-ups for Vistar to print the sheet.')
                  }
                >
                  <Printer aria-hidden />
                  Print QR sheet
                </Button>
              )}
              <Button variant="primary" onClick={onClose}>
                I saved it
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
