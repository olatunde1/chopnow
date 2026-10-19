import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, X } from 'lucide-react';
import { ReasonDialog, Status, useAction } from './admin';
import { Button } from './ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';

const TYPE = { CAC_CERTIFICATE: 'CAC certificate', FOOD_HANDLER_PERMIT: 'Food handler permit', OWNER_ID: 'Owner ID', DRIVERS_LICENCE: 'Driver’s licence', VEHICLE_PAPERS: 'Vehicle papers', RIDER_ID: 'Government ID', OTHER: 'Other' };

/**
 * Verification documents for one restaurant or rider. Viewing opens a 5-minute signed link (each
 * view is audited); accepting or rejecting is recorded, and rejection notes are shown to the owner.
 */
export function Documents({ owner, ownerId, canReview }) {
  const query = owner === 'restaurant' ? { restaurantId: ownerId } : { riderId: ownerId };
  const docs = useQuery({ queryKey: ['documents', owner, ownerId], queryFn: () => api.documents.list(owner, query), enabled: canReview });
  const { run } = useAction();
  const [rejecting, setRejecting] = useState(null);
  const refresh = [['documents', owner, ownerId], ['dashboard']];

  if (!canReview) return <p className="text-sm text-ink-muted">Only approvers can view documents.</p>;
  if (docs.isPending) return <p className="text-sm text-ink-muted">Loading documents…</p>;
  if (docs.isError) return <p className="text-sm text-bad">{docs.error.message}</p>;
  if (!docs.data.items.length) return <p className="text-sm text-ink-muted">No documents uploaded yet.</p>;

  const view = async (id) => {
    // Open the tab first (popup blockers allow it during the click), then point it at the signed link.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    const res = await run(() => api.documents.link(owner, id));
    if (res.ok && tab) tab.location.href = res.result.url;
    else tab?.close();
  };

  return (
    <>
      <ul className="divide-y divide-line">
        {docs.data.items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
            <FileText className="size-4 text-ink-muted" aria-hidden />
            <span className="font-semibold">{TYPE[d.type] ?? d.type}</span>
            <Status value={d.status} kind="document" />
            <span className="basis-full truncate text-ink-muted">
              {d.originalName} · {Math.ceil(d.sizeBytes / 1024)} KB · {dateTime(d.uploadedAt)}
            </span>
            {d.reviewNote ? <span className="basis-full text-bad">{d.reviewNote}</span> : null}
            <div className="flex basis-full gap-2">
              <Button variant="outline" size="sm" icon={ExternalLink} onClick={() => view(d.id)}>
                View
              </Button>
              {d.status !== 'ACCEPTED' ? (
                <Button size="sm" icon={Check} onClick={() => run(() => api.documents.review(owner, d.id, 'ACCEPTED'), { success: 'Document accepted', invalidate: refresh })}>
                  Accept
                </Button>
              ) : null}
              {d.status !== 'REJECTED' ? (
                <Button variant="ghost" size="sm" icon={X} onClick={() => setRejecting(d)}>
                  Reject
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ReasonDialog
        open={!!rejecting}
        title="Reject document"
        reasonLabel="What’s wrong (shown to the owner)"
        confirmLabel="Reject"
        destructive
        onClose={() => setRejecting(null)}
        onSubmit={({ reason }) => run(() => api.documents.review(owner, rejecting.id, 'REJECTED', reason), { success: 'Document rejected', invalidate: refresh })}
      />
    </>
  );
}
