'use client';

import { CHIP_TONES, EMPLOYEE_STATUSES, formatInr } from '@vistar/shared';
import { mockLeads, mockPipeline } from '@vistar/shared/fixtures';
import { Moon, Phone, Plus, Sun, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { Avatar } from './avatar';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from './card';
import { Chip, StatusChip } from './chip';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { FormField, Input, Textarea } from './input';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { toast } from './toast';

const leads = mockLeads(8);
const stageName = new Map(mockPipeline().stages.map((s) => [s.id, s.name]));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`kit-${title}`} className="flex flex-col gap-3">
      <h2 id={`kit-${title}`} className="text-xs font-semibold tracking-wide text-muted-strong uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Living reference for the base kit in both themes. Route: /kit */
export function KitShowcase() {
  const theme = useDocumentTheme();
  const [loading, setLoading] = useState(false);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">UI kit</h1>
          <p className="text-sm text-muted-strong">Base components on design tokens. Check both themes before shipping a screen.</p>
        </div>
        <Button variant="secondary" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </Button>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">
            <Plus aria-hidden /> New lead
          </Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button variant="link">View all</Button>
          <Button size="sm">Small</Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
          <Button size="icon" aria-label="Call lead">
            <Phone aria-hidden />
          </Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1200);
            }}
          >
            Save changes
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Chips and avatars">
        <div className="flex flex-wrap items-center gap-2">
          {EMPLOYEE_STATUSES.map((s) => (
            <StatusChip key={s} status={s} />
          ))}
          <Chip tone="red" dot>
            Failed
          </Chip>
          {CHIP_TONES.map((t) => (
            <Chip key={t} tone={t} size="md">
              {t}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Avatar name="Priya Sharma" size="xs" />
          <Avatar name="Rohit Verma" size="sm" status="on_call" />
          <Avatar name="Sneha Iyer" status="busy" />
          <Avatar name="Imran Sheikh" size="lg" status="idle" />
          <Avatar name="Mohit Bansal" size="xl" status="offline" />
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'New leads', value: '128', delta: '+12%' },
            { label: 'Calls today', value: '342', delta: '+4%' },
            { label: 'Answered', value: '71%', delta: '-2%' },
            { label: 'Revenue', value: formatInr(1845000, { compact: true }), delta: '+9%' },
          ].map((k) => (
            <Card key={k.label} interactive>
              <CardHeader>
                <CardDescription>{k.label}</CardDescription>
                <Chip tone={k.delta.startsWith('-') ? 'red' : 'green'}>{k.delta}</Chip>
              </CardHeader>
              <CardContent>
                <p className="tabular text-2xl font-semibold">{k.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Form fields">
        <Card className="max-w-md">
          <CardContent className="flex flex-col gap-4 pt-4">
            <FormField label="Lead name" required hint="As it appears on the enquiry">
              <Input placeholder="Rakesh Gupta" />
            </FormField>
            <FormField label="Phone" error="Enter a 10-digit Indian mobile number">
              <Input defaultValue="98765" inputMode="tel" />
            </FormField>
            <FormField label="Note">
              <Textarea placeholder="Asked for price on 2 inch SS pipes" />
            </FormField>
          </CardContent>
          <CardFooter className="justify-end">
            <Button>Cancel</Button>
            <Button variant="primary" onClick={() => toast.success('Lead created')}>
              Create lead
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Table">
        <Card className="overflow-hidden">
          <Table containerClassName="max-h-80">
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l, i) => (
                <TableRow key={l.id} data-new={i === 0 ? 'true' : undefined}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-fg-secondary">{l.companyName}</TableCell>
                  <TableCell>
                    <Chip>{stageName.get(l.stageId)}</Chip>
                  </TableCell>
                  <TableCell>
                    {l.owner ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={l.owner.name} size="xs" />
                        {l.owner.name}
                      </span>
                    ) : (
                      <span className="text-muted">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatInr(l.valueInr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="Dialog, toast, skeleton">
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reassign lead</DialogTitle>
                <DialogDescription>Rakesh Gupta will move to the selected rep with full history.</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <FormField label="New owner">
                  <Input placeholder="Search team" />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <Button variant="primary" onClick={() => toast.success('Lead reassigned to Priya Sharma')}>
                  Reassign
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={() => toast('New IndiaMART lead', { description: 'Shree Ganesh Traders · SS pipes', action: { label: 'Open', onClick: () => undefined } })}>
            Info toast
          </Button>
          <Button onClick={() => toast.error('WhatsApp window closed. Send an approved template instead.')}>Error toast</Button>
        </div>
        <div className="flex max-w-md flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </Section>
    </main>
  );
}
