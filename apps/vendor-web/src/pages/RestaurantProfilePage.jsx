import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileText, ImagePlus, Upload } from 'lucide-react';
import { HoursEditor } from '../components/HoursEditor';
import { RestaurantForm } from '../components/RestaurantForm';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, useToast } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { APPROVAL, dateTime } from '../lib/format';
import { useSession } from '../state/session';

export const DOC_LABEL = {
  CAC_CERTIFICATE: 'CAC registration certificate',
  FOOD_HANDLER_PERMIT: 'Food handler / hygiene permit',
  OWNER_ID: 'Owner’s government ID',
  OTHER: 'Other supporting document',
};
const DOC_STATUS = { PENDING: ['Under review', 'warn'], APPROVED: ['Accepted', 'ok'], REJECTED: ['Not accepted', 'bad'] };

/** What still stands between the restaurant and approval / a good listing. */
export function verificationChecklist(restaurant, menuItemCount, documentCount) {
  return [
    { label: 'Location pinned', done: restaurant.latitude !== null && restaurant.longitude !== null, required: true },
    { label: 'Opening hours set', done: restaurant.hours.length > 0, required: true },
    { label: 'At least one document uploaded', done: documentCount > 0, required: false },
    { label: 'Menu has dishes', done: menuItemCount > 0, required: false },
    { label: 'Logo added', done: !!restaurant.logoUrl, required: false },
  ];
}

function ImageSlot({ label, url, aspect, onUpload, onRemove, busy }) {
  const ref = useRef(null);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{label}</span>
      <div className={`flex items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-muted ${aspect}`}>
        {url ? <img src={url} alt={label} className="size-full object-cover" /> : <ImagePlus className="size-8 text-ink-muted" aria-hidden />}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`Upload ${label.toLowerCase()}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = '';
        }}
      />
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" loading={busy} onClick={() => ref.current?.click()}>
          {url ? 'Change' : 'Upload'}
        </Button>
        {url ? (
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DocumentsCard({ restaurantId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ['documents', restaurantId], queryFn: () => api.restaurants.documents(restaurantId) });
  const [type, setType] = useState('CAC_CERTIFICATE');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const upload = async (file) => {
    setBusy(true);
    try {
      await api.restaurants.uploadDocument(restaurantId, file, type);
      toast.show(`${DOC_LABEL[type]} uploaded`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['documents', restaurantId] });
    } catch (e) {
      toast.show(e.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Verification documents</h2>
      <p className="mb-4 text-sm text-ink-muted">PDF, JPG or PNG up to 10 MB. Only ChopNow’s review team can see these.</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select label="Document type" value={type} onChange={(e) => setType(e.target.value)} className="min-w-64">
          {Object.entries(DOC_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <input
          ref={ref}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          aria-label="Choose document file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
        <Button icon={Upload} loading={busy} onClick={() => ref.current?.click()}>
          Upload document
        </Button>
      </div>
      {docs.isPending ? (
        <LoadingBlock />
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={docs.refetch} />
      ) : docs.data.items.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" message="A CAC certificate and the owner’s ID speed up approval." />
      ) : (
        <ul className="divide-y divide-line">
          {docs.data.items.map((d) => {
            const [label, tone] = DOC_STATUS[d.status] ?? [d.status, 'neutral'];
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="size-5 text-ink-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{DOC_LABEL[d.type] ?? d.type}</p>
                  <p className="truncate text-sm text-ink-muted">
                    {d.originalName} · {Math.ceil(d.sizeBytes / 1024)} KB · {dateTime(d.uploadedAt)}
                  </p>
                  {d.reviewNote ? <p className="text-sm text-bad">{d.reviewNote}</p> : null}
                </div>
                <Badge tone={tone}>{label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function RestaurantProfilePage() {
  const { restaurant } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const detail = useQuery({ queryKey: ['restaurant', restaurant.id], queryFn: () => api.restaurants.get(restaurant.id) });
  const menu = useQuery({ queryKey: ['menu', restaurant.id], queryFn: () => api.menu.get(restaurant.id) });
  const docs = useQuery({ queryKey: ['documents', restaurant.id], queryFn: () => api.restaurants.documents(restaurant.id) });
  const [serverErrors, setServerErrors] = useState({});
  const [imageBusy, setImageBusy] = useState(null);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['restaurant', restaurant.id] }), queryClient.invalidateQueries({ queryKey: ['restaurants'] })]);

  const saveImage = async (purpose, file) => {
    setImageBusy(purpose);
    try {
      const field = purpose === 'logo' ? 'logoUrl' : 'coverImageUrl';
      const value = file ? (await api.restaurants.uploadImage(restaurant.id, file, purpose)).url : null;
      await api.restaurants.update(restaurant.id, { [field]: value });
      toast.show(purpose === 'logo' ? 'Logo updated' : 'Cover photo updated', 'success');
      await refresh();
    } catch (e) {
      toast.show(e.message, 'danger');
    } finally {
      setImageBusy(null);
    }
  };

  if (detail.isPending) return <LoadingBlock label="Loading restaurant" />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={detail.refetch} />;
  const r = detail.data;
  const approval = APPROVAL[r.verificationStatus] ?? { label: r.verificationStatus, tone: 'neutral' };
  const itemCount = menu.data?.categories.reduce((n, c) => n + c.items.length, 0) ?? 0;
  const checklist = verificationChecklist(r, itemCount, docs.data?.items.length ?? 0);

  return (
    <>
      <PageHeader title="Restaurant profile" description="What customers see, when you’re open, and your verification status." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <h2 className="mb-4 text-lg font-bold">Photos</h2>
            <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
              <ImageSlot label="Logo" url={r.logoUrl} aspect="aspect-square" busy={imageBusy === 'logo'} onUpload={(f) => saveImage('logo', f)} onRemove={() => saveImage('logo', null)} />
              <ImageSlot label="Cover photo" url={r.coverImageUrl} aspect="aspect-[16/9]" busy={imageBusy === 'cover'} onUpload={(f) => saveImage('cover', f)} onRemove={() => saveImage('cover', null)} />
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-bold">Opening hours</h2>
            <HoursEditor
              key={JSON.stringify(r.hours)}
              windows={r.hours}
              onSave={async (windows) => {
                await api.restaurants.setHours(r.id, windows);
                toast.show('Opening hours saved', 'success');
                await refresh();
              }}
            />
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-bold">Details</h2>
            <RestaurantForm
              key={r.id}
              initial={r}
              submitLabel="Save details"
              serverErrors={serverErrors}
              onSubmit={async (input) => {
                try {
                  await api.restaurants.update(r.id, input);
                  setServerErrors({});
                  toast.show('Details saved', 'success');
                  await refresh();
                } catch (e) {
                  if (e instanceof ApiError) {
                    setServerErrors(e.fieldErrors());
                    toast.show(e.message, 'danger');
                  } else throw e;
                }
              }}
            />
          </Card>

          <DocumentsCard restaurantId={r.id} />
        </div>

        <aside className="flex flex-col gap-5">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-bold">Verification</h2>
              <span className="ml-auto">
                <Badge tone={approval.tone}>{approval.label}</Badge>
              </span>
            </div>
            {r.verificationNote ? <p className="mb-3 rounded-xl bg-warn-soft p-3 text-sm">{r.verificationNote}</p> : null}
            {r.verificationStatus === 'PENDING' ? <p className="mb-3 text-sm text-ink-muted">Customers can’t see your restaurant until it’s approved. We usually review within one working day.</p> : null}
            <ul className="flex flex-col gap-2" aria-label="Checklist">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  {c.done ? <CheckCircle2 className="size-5 text-ok" aria-hidden /> : <Circle className="size-5 text-ink-muted" aria-hidden />}
                  <span className={c.done ? '' : 'text-ink-muted'}>
                    {c.label}
                    {c.required ? <span className="sr-only">{c.done ? ' (done)' : ' (required)'}</span> : null}
                    {c.required && !c.done ? <span className="ml-1 text-xs font-semibold text-bad">required</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-2 text-lg font-bold">Set by ChopNow</h2>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-ink-muted">Delivery radius</dt>
              <dd className="text-right">{(r.deliveryRadiusMeters / 1000).toFixed(1)} km</dd>
              <dt className="text-ink-muted">Rating</dt>
              <dd className="text-right">{r.ratingAverage ? `${r.ratingAverage.toFixed(1)} (${r.ratingCount})` : 'No ratings yet'}</dd>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
