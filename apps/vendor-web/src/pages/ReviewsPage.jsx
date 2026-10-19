import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Star } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, Textarea, useToast } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession } from '../state/session';

export function Stars({ value }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-4 ${n <= value ? 'fill-[var(--color-warn)] text-warn' : 'text-line'}`} aria-hidden />
      ))}
    </span>
  );
}

function ReplyBox({ review, restaurantId, onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reviews.reply(restaurantId, review.id, text.trim());
      toast.show('Reply posted', 'success');
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Textarea label={`Reply to ${review.customerFirstName}`} value={text} onChange={(e) => setText(e.target.value)} error={error} hint="Replies are public and can’t be edited. Be polite and specific." maxLength={1000} />
      <Button size="sm" className="self-end" onClick={send} loading={busy} disabled={text.trim().length < 2}>
        Post reply
      </Button>
    </div>
  );
}

export function ReviewsPage() {
  const { restaurant } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [replying, setReplying] = useState(null);
  const reviews = useQuery({ queryKey: ['reviews', restaurant.id, page], queryFn: () => api.reviews.list(restaurant.id, page), placeholderData: (prev) => prev });

  if (reviews.isPending) return <LoadingBlock label="Loading reviews" />;
  if (reviews.isError) return <ErrorState error={reviews.error} onRetry={reviews.refetch} />;
  const { items, total, ratingAverage, ratingCount } = reviews.data;

  return (
    <>
      <PageHeader title="Reviews" description="Ratings from customers after delivery." />
      <Card className="mb-5 flex items-center gap-4">
        <p className="text-4xl font-extrabold">{ratingAverage ? ratingAverage.toFixed(1) : '—'}</p>
        <div>
          {ratingAverage ? <Stars value={Math.round(ratingAverage)} /> : null}
          <p className="text-sm text-ink-muted">{ratingCount === 1 ? '1 rating' : `${ratingCount} ratings`}</p>
        </div>
      </Card>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={MessageSquare} title="No reviews yet" message="Customers can rate their order for 14 days after delivery." />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.restaurantRating} />
                  <span className="font-semibold">{r.customerFirstName}</span>
                  <span className="text-sm text-ink-muted">
                    · {r.orderCode} · {dateTime(r.createdAt)}
                  </span>
                </div>
                {r.comment ? <p className="mt-2 break-words">{r.comment}</p> : <p className="mt-2 text-sm text-ink-muted">No comment.</p>}
                {r.vendorReply ? (
                  <div className="mt-3 rounded-xl bg-surface-muted p-3 text-sm">
                    <p className="font-semibold">Your reply</p>
                    <p className="break-words">{r.vendorReply}</p>
                  </div>
                ) : replying === r.id ? (
                  <ReplyBox
                    review={r}
                    restaurantId={restaurant.id}
                    onDone={() => {
                      setReplying(null);
                      queryClient.invalidateQueries({ queryKey: ['reviews', restaurant.id] });
                    }}
                  />
                ) : (
                  <Button variant="ghost" size="sm" icon={MessageSquare} className="mt-2" onClick={() => setReplying(r.id)}>
                    Reply
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={20} total={total} onPage={setPage} />
    </>
  );
}
