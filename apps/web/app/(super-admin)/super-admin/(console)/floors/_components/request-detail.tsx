'use client';

import { ArrowLeft, Ban, Hammer, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { usePermissions } from '@/lib/session/session';
import { useSetRequestStatus, useSuperFloorRequest } from './data';
import { PhotoGallery, PromptCard, UploadCard, VersionsCard } from './request-parts';
import { RequestStatusChip, TZ } from './status';

/** One floor request: photos, the AI prompt, upload, versions (seat tool and publish per version). */
export function FloorRequestDetail({ id }: { id: string }) {
  const query = useSuperFloorRequest(id);
  const canManage = usePermissions().includes('platform.companies.manage');
  const [rejecting, setRejecting] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const setStatus = useSetRequestStatus(id);
  const router = useRouter();
  const r = query.data;

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/super-admin/floors">
        <ArrowLeft aria-hidden />
        All requests
      </Link>
    </Button>
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the floor request">
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    );
  }
  if (query.isError || !r) {
    const missing = isApiRequestError(query.error) && query.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <div>{back}</div>
        <EmptyState
          title={missing ? 'This floor request was not found' : 'The floor request did not load'}
          description={
            missing
              ? 'It may belong to a deleted company. Go back to the list.'
              : 'Check your connection, then try again.'
          }
          action={
            missing ? undefined : (
              <Button onClick={() => void query.refetch()}>
                <RefreshCw aria-hidden />
                Try again
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <RequirePermission anyOf={['platform.companies.read']}>
      <div className="flex flex-col gap-4">
        <div>{back}</div>
        <PageHeader
          title={r.workspaceName || 'Company'}
          meta={<RequestStatusChip status={r.status} />}
          description={`Seats for ${r.headcount} ${r.headcount === 1 ? 'person' : 'people'} · ${r.images.length} photos · sent ${formatDateTimeIn(r.submittedAt, TZ)}${r.createdBy ? ` by ${r.createdBy.name}` : ''}`}
          actions={
            canManage && r.status !== 'published' ? (
              <>
                {r.status !== 'in_progress' && (
                  <Button
                    loading={setStatus.isPending && setStatus.variables?.status === 'in_progress'}
                    onClick={() =>
                      setStatus.mutate(
                        { status: 'in_progress' },
                        {
                          onSuccess: () =>
                            toast.success('The company now sees "your office is being prepared".'),
                          onError: (e) =>
                            toast.error(
                              isApiRequestError(e)
                                ? e.message
                                : 'The status did not change. Try again.',
                            ),
                        },
                      )
                    }
                  >
                    <Hammer aria-hidden />
                    Mark in progress
                  </Button>
                )}
                {r.status !== 'rejected' && (
                  <Button variant="ghost" onClick={() => setRejecting(true)}>
                    <Ban aria-hidden />
                    Ask for other photos
                  </Button>
                )}
              </>
            ) : undefined
          }
          className="mb-0"
        />
        {r.statusNote && (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg-secondary">
            Message to the company: {r.statusNote}
          </p>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <PhotoGallery request={r} />
          <div className="flex min-w-0 flex-col gap-4">
            <PromptCard request={r} />
            {canManage && (
              <UploadCard
                request={r}
                onUploaded={(asset) => {
                  setHighlight(asset.id);
                  router.push(`/super-admin/floors/versions/${asset.id}`);
                }}
              />
            )}
          </div>
        </div>
        <VersionsCard workspaceId={r.workspaceId} highlight={highlight} />
      </div>
      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        pending={setStatus.isPending}
        onReject={(note) =>
          setStatus.mutate(
            { status: 'rejected', note },
            {
              onSuccess: () => {
                setRejecting(false);
                toast.success('The company was asked for other photos.');
              },
              onError: (e) =>
                toast.error(
                  isApiRequestError(e) ? e.message : 'The request was not updated. Try again.',
                ),
            },
          )
        }
      />
    </RequirePermission>
  );
}

function RejectDialog({
  open,
  onOpenChange,
  onReject,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReject: (note: string) => void;
  pending: boolean;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) {
              setError(
                'Tell the company what is missing, for example "Add a photo of the cabins from the door".',
              );
              return;
            }
            onReject(note.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Ask for other photos</DialogTitle>
            <DialogDescription>
              The company admin sees this message on the Team Floor tab and can send new photos.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Message to the company" required error={error ?? undefined}>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={4}
                placeholder="The work area photos are too dark. Please add two wide photos from the corners."
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Send message
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
