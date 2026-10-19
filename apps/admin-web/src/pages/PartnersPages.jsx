import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Bike, Store } from 'lucide-react';
import { Documents } from '../components/Documents';
import { Facts, FilterChips, ReasonDialog, Status, useAction } from '../components/admin';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Pagination, Table } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession } from '../state/session';

const STATUSES = [['', 'All'], ['PENDING', 'To approve'], ['APPROVED', 'Approved'], ['SUSPENDED', 'Suspended'], ['REJECTED', 'Rejected']];

function useListParams() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, String(v)) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return { status, page, set };
}

export function RestaurantsPage() {
  const { can } = useSession();
  const { status, page, set } = useListParams();
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const { run } = useAction();
  const query = { page, pageSize: 25, ...(status ? { status } : {}) };
  const list = useQuery({ queryKey: ['admin-restaurants', query], queryFn: () => api.restaurants.list(query), placeholderData: (p) => p });
  const refresh = [['admin-restaurants'], ['dashboard']];
  const done = (r) => {
    if (r.ok) setSelected(r.result);
    return r;
  };

  return (
    <>
      <PageHeader title="Restaurants" description="Approve new restaurants once their location, hours and documents check out." />
      <Card className="mb-4">
        <FilterChips label="Filter restaurants" value={status} onChange={(v) => set({ status: v })} options={STATUSES} />
      </Card>
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <>
            <Table
              columns={[
                { key: 'name', header: 'Restaurant', render: (r) => <span className="font-semibold">{r.name}</span> },
                { key: 'area', header: 'Area', render: (r) => r.area },
                { key: 'owner', header: 'Owner', render: (r) => r.owner.fullName },
                { key: 'ready', header: 'Ready to approve', render: (r) => (r.hoursConfigured && r.latitude !== null ? `${r.menuItemCount} dishes` : <span className="text-warn">{r.latitude === null ? 'No location' : 'No hours'}</span>) },
                { key: 'status', header: 'Status', render: (r) => <Status value={r.verificationStatus} /> },
                { key: 'open', header: 'Taking orders', render: (r) => (r.isAcceptingOrders ? 'Yes' : 'No') },
              ]}
              rows={list.data.items}
              rowKey={(r) => r.id}
              onRowClick={setSelected}
              empty={<EmptyState icon={Store} title="No restaurants here" />}
            />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} size="lg" title={selected?.name ?? ''}>
        {selected ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2"><Status value={selected.verificationStatus} />{selected.verificationNote ? <span className="text-sm text-ink-muted">{selected.verificationNote}</span> : null}</div>
            <Facts rows={[
              ['Address', `${selected.addressLine}, ${selected.area}, ${selected.city}`],
              ['Location', selected.latitude !== null ? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}` : null],
              ['Opening hours', selected.hoursConfigured ? 'Set' : 'Not set'],
              ['Menu', `${selected.menuItemCount} dishes`],
              ['Owner', `${selected.owner.fullName} · ${selected.owner.email}${selected.owner.phone ? ` · ${selected.owner.phone}` : ''}`],
              ['Applied', dateTime(selected.createdAt)],
              ['Approved', selected.approvedAt ? dateTime(selected.approvedAt) : null],
            ]} />
            <div>
              <h3 className="mb-2 font-bold">Documents</h3>
              <Documents owner="restaurant" ownerId={selected.id} canReview={can('restaurant.approve')} />
            </div>
            {can('restaurant.approve') ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {selected.verificationStatus !== 'APPROVED' ? <Button onClick={() => run(() => api.restaurants.approve(selected.id), { success: 'Restaurant approved', invalidate: refresh }).then(done)}>Approve</Button> : null}
                {selected.verificationStatus === 'PENDING' ? <Button variant="outline" onClick={() => setDialog('reject')}>Reject</Button> : null}
                {selected.verificationStatus === 'APPROVED' ? <Button variant="danger" onClick={() => setDialog('suspend')}>Suspend</Button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ReasonDialog open={dialog === 'reject'} title={`Reject ${selected?.name}?`} reasonLabel="Reason (shown to the owner)" confirmLabel="Reject" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.restaurants.reject(selected.id, reason), { success: 'Rejected', invalidate: refresh }).then(done)} />
      <ReasonDialog open={dialog === 'suspend'} title={`Suspend ${selected?.name}?`} message="It stops receiving orders immediately." reasonLabel="Reason (shown to the owner)" confirmLabel="Suspend" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.restaurants.suspend(selected.id, reason), { success: 'Suspended', invalidate: refresh }).then(done)} />
    </>
  );
}

export function RidersPage() {
  const { can } = useSession();
  const { status, page, set } = useListParams();
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const { run } = useAction();
  const query = { page, pageSize: 25, ...(status ? { status } : {}) };
  const list = useQuery({ queryKey: ['admin-riders', query], queryFn: () => api.riders.list(query), placeholderData: (p) => p });
  const refresh = [['admin-riders'], ['dashboard']];
  const done = (r) => {
    if (r.ok) setSelected(r.result);
    return r;
  };

  return (
    <>
      <PageHeader title="Riders" description="Approve riders as core (offered first) or independent, after checking their licence and ID." />
      <Card className="mb-4">
        <FilterChips label="Filter riders" value={status} onChange={(v) => set({ status: v })} options={STATUSES} />
      </Card>
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <>
            <Table
              columns={[
                { key: 'name', header: 'Rider', render: (r) => <span className="font-semibold">{r.user.fullName}</span> },
                { key: 'type', header: 'Type', render: (r) => <Badge tone={r.riderType === 'CORE' ? 'info' : 'neutral'}>{r.riderType === 'CORE' ? 'Core' : 'Independent'}</Badge> },
                { key: 'vehicle', header: 'Vehicle', render: (r) => `${r.vehicleType.toLowerCase()}${r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}` },
                { key: 'done', header: 'Deliveries', align: 'right', render: (r) => r.completedDeliveries },
                { key: 'status', header: 'Status', render: (r) => <Status value={r.verificationStatus} /> },
                { key: 'online', header: 'Now', render: (r) => <Status value={r.availability} /> },
              ]}
              rows={list.data.items}
              rowKey={(r) => r.id}
              onRowClick={setSelected}
              empty={<EmptyState icon={Bike} title="No riders here" />}
            />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} size="lg" title={selected?.user.fullName ?? ''}>
        {selected ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2"><Status value={selected.verificationStatus} /><Status value={selected.availability} />{selected.verificationNote ? <span className="text-sm text-ink-muted">{selected.verificationNote}</span> : null}</div>
            <Facts rows={[
              ['Type', selected.riderType === 'CORE' ? 'Core (offered first)' : 'Independent'],
              ['Vehicle', `${selected.vehicleType.toLowerCase()}${selected.vehiclePlate ? ` · ${selected.vehiclePlate}` : ''}`],
              ['Contact', `${selected.user.email}${selected.user.phone ? ` · ${selected.user.phone}` : ''}`],
              ['Deliveries completed', selected.completedDeliveries],
              ['Applied', dateTime(selected.createdAt)],
            ]} />
            <div>
              <h3 className="mb-2 font-bold">Documents</h3>
              <Documents owner="rider" ownerId={selected.id} canReview={can('rider.approve')} />
            </div>
            {can('rider.approve') ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {selected.verificationStatus !== 'APPROVED' ? <Button onClick={() => setDialog('approve')}>Approve</Button> : null}
                {selected.verificationStatus === 'PENDING' ? <Button variant="outline" onClick={() => setDialog('reject')}>Reject</Button> : null}
                {selected.verificationStatus === 'APPROVED' ? (
                  <>
                    <Button variant="outline" onClick={() => run(() => api.riders.setType(selected.id, selected.riderType === 'CORE' ? 'INDEPENDENT' : 'CORE'), { success: 'Rider type changed', invalidate: refresh }).then(done)}>
                      Make {selected.riderType === 'CORE' ? 'independent' : 'core'}
                    </Button>
                    <Button variant="danger" onClick={() => setDialog('suspend')}>Suspend</Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ReasonDialog
        open={dialog === 'approve'}
        title={`Approve ${selected?.user.fullName}`}
        fields={[{ name: 'riderType', label: 'Rider type', type: 'select', required: true, options: [['CORE', 'Core: offered jobs first'], ['INDEPENDENT', 'Independent: offered after 2 minutes']] }]}
        requireReason={false}
        confirmLabel="Approve"
        onClose={() => setDialog(null)}
        onSubmit={({ riderType }) => run(() => api.riders.approve(selected.id, riderType), { success: 'Rider approved', invalidate: refresh }).then(done)}
      />
      <ReasonDialog open={dialog === 'reject'} title={`Reject ${selected?.user.fullName}?`} reasonLabel="Reason (shown to the rider)" confirmLabel="Reject" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.riders.reject(selected.id, reason), { success: 'Rejected', invalidate: refresh }).then(done)} />
      <ReasonDialog open={dialog === 'suspend'} title={`Suspend ${selected?.user.fullName}?`} message="They go offline at once. A rider in the middle of a delivery must be taken off it first (Dispatch)." reasonLabel="Reason (shown to the rider)" confirmLabel="Suspend" destructive onClose={() => setDialog(null)} onSubmit={({ reason }) => run(() => api.riders.suspend(selected.id, reason), { success: 'Suspended', invalidate: refresh }).then(done)} />
    </>
  );
}
