import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, FileClock, MessageSquareWarning, Search, UserPlus, Users } from 'lucide-react';
import { FilterChips, ReasonDialog, Status, ago, useAction } from '../components/admin';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Modal, PageHeader, Pagination, Select, Table } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession } from '../state/session';

const ROLE_LABEL = { CUSTOMER: 'Customer', VENDOR: 'Restaurant', RIDER: 'Rider', ADMIN: 'Admin', OPERATIONS: 'Operations', SUPPORT: 'Support', FINANCE: 'Finance' };

export function UsersPage() {
  const { can, user: me } = useSession();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState(null); // { user, action }
  const [creating, setCreating] = useState(false);
  const { run } = useAction();
  const query = { page, pageSize: 25, ...(role ? { role } : {}), ...(term ? { q: term } : {}) };
  const list = useQuery({ queryKey: ['admin-users', query], queryFn: () => api.users.list(query), placeholderData: (p) => p });
  const canManage = (u) => u.id !== me.id && (u.role === 'CUSTOMER' ? can('customer.manage') : u.role !== 'VENDOR' && u.role !== 'RIDER' && can('staff.manage'));

  return (
    <>
      <PageHeader
        title="Customers & staff"
        description="Restaurants and riders are managed from their own pages."
        actions={can('staff.manage') ? <Button icon={UserPlus} onClick={() => setCreating(true)}>Add staff member</Button> : null}
      />
      <Card className="mb-4 flex flex-col gap-3">
        <form className="flex max-w-xl items-center gap-2 rounded-xl border border-line bg-surface px-3" role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); setPage(1); }}>
          <Search className="size-4 text-ink-muted" aria-hidden />
          <label className="sr-only" htmlFor="user-search">Search accounts</label>
          <input id="user-search" className="min-h-11 flex-1 bg-transparent outline-none" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <FilterChips label="Filter by role" value={role} onChange={(v) => { setRole(v); setPage(1); }} options={[['', 'All'], ['CUSTOMER', 'Customers'], ['ADMIN', 'Admins'], ['OPERATIONS', 'Operations'], ['SUPPORT', 'Support'], ['FINANCE', 'Finance']]} />
      </Card>
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <>
            <Table
              columns={[
                { key: 'name', header: 'Name', render: (u) => <span className="font-semibold">{u.fullName}</span> },
                { key: 'contact', header: 'Contact', render: (u) => <span className="text-sm">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span> },
                { key: 'role', header: 'Role', render: (u) => <Badge>{ROLE_LABEL[u.role]}</Badge> },
                { key: 'orders', header: 'Orders', align: 'right', render: (u) => u.orderCount },
                { key: 'login', header: 'Last sign-in', render: (u) => (u.mustChangePassword ? <Badge tone="warn">Not activated</Badge> : ago(u.lastLoginAt)) },
                { key: 'status', header: 'Status', render: (u) => <Status value={u.status} /> },
                {
                  key: 'act', header: '', align: 'right',
                  render: (u) => (canManage(u) ? (
                    <Button variant={u.status === 'ACTIVE' ? 'ghost' : 'outline'} size="sm" onClick={(e) => { e.stopPropagation(); setTarget({ user: u, action: u.status === 'ACTIVE' ? 'suspend' : 'reactivate' }); }}>
                      {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  ) : null),
                },
              ]}
              rows={list.data.items}
              rowKey={(u) => u.id}
              empty={<EmptyState icon={Users} title="No accounts match" />}
            />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ReasonDialog
        open={!!target}
        title={target ? `${target.action === 'suspend' ? 'Suspend' : 'Reactivate'} ${target.user.fullName}?` : ''}
        message={target?.action === 'suspend' ? 'They are signed out on every device and can’t sign in until reactivated.' : undefined}
        confirmLabel={target?.action === 'suspend' ? 'Suspend' : 'Reactivate'}
        destructive={target?.action === 'suspend'}
        onClose={() => setTarget(null)}
        onSubmit={({ reason }) => run(() => (target.action === 'suspend' ? api.users.suspend(target.user.id, reason) : api.users.reactivate(target.user.id, reason)), { success: target.action === 'suspend' ? 'Account suspended' : 'Account reactivated', invalidate: [['admin-users']] })}
      />
      {creating ? <CreateStaff onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/** Creates a staff account and shows the one-time password exactly once. */
export function CreateStaff({ onClose }) {
  const { run, busy } = useAction();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', role: 'SUPPORT' });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setError(null);
    const res = await run(() => api.users.createStaff({ fullName: form.fullName, email: form.email, role: form.role, ...(form.phone.trim() ? { phone: form.phone } : {}) }), { invalidate: [['admin-users']] });
    if (res.ok) setCreated(res.result);
    else setError(res.message);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={created ? 'Staff account created' : 'Add a staff member'}
      footer={created ? <Button onClick={onClose}>Done</Button> : (
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={form.fullName.trim().length < 2 || !form.email.includes('@')}>Create account</Button>
        </>
      )}
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <p>Give <strong>{created.user.fullName}</strong> this one-time password in person or by phone. It won’t be shown again. They must choose their own password when they first sign in.</p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-muted p-3">
            <code className="flex-1 select-all text-lg font-bold tracking-wider" data-testid="temp-password">{created.temporaryPassword}</code>
            <Button variant="outline" size="sm" icon={Copy} onClick={async () => { try { await navigator.clipboard.writeText(created.temporaryPassword); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{error}</p> : null}
          <Input label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input label="Work email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone (optional)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} hint="Give the narrowest role that covers their work.">
            <option value="SUPPORT">Support: look up orders, request refunds, moderate reviews</option>
            <option value="OPERATIONS">Operations: + manage orders, dispatch, approvals, promotions</option>
            <option value="FINANCE">Finance: refunds, rider cash, settlements, payouts</option>
            <option value="ADMIN">Admin: everything, including staff and settings</option>
          </Select>
        </div>
      )}
    </Modal>
  );
}

export function ReviewsModerationPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState(null);
  const { run } = useAction();
  const query = { page, pageSize: 20, ...(status === 'LOW' ? { maxRating: 2 } : status ? { status } : {}) };
  const list = useQuery({ queryKey: ['admin-reviews', query], queryFn: () => api.reviews.list(query), placeholderData: (p) => p });

  return (
    <>
      <PageHeader title="Reviews" description="Hide reviews that are abusive, personal or not about the order. Ratings are recalculated from published reviews." />
      <Card className="mb-4"><FilterChips label="Filter reviews" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[['', 'All'], ['LOW', '1–2 stars'], ['PUBLISHED', 'Published'], ['HIDDEN', 'Hidden']]} /></Card>
      {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.data.items.length === 0 ? (
        <Card><EmptyState icon={MessageSquareWarning} title="No reviews here" /></Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.items.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{'★'.repeat(r.restaurantRating)}{'☆'.repeat(5 - r.restaurantRating)}</span>
                  <span className="font-semibold">{r.restaurantName}</span>
                  <span className="text-ink-muted">· {r.customerName} · {r.orderCode} · {dateTime(r.createdAt)}</span>
                  {r.riderRating ? <span className="text-ink-muted">· rider {r.riderRating}★</span> : null}
                  <span className="ml-auto"><Status value={r.status} /></span>
                </div>
                <p className="mt-2 break-words">{r.comment ?? <span className="text-ink-muted">No comment</span>}</p>
                {r.vendorReply ? <p className="mt-2 rounded-xl bg-surface-muted p-2 text-sm">Restaurant: {r.vendorReply}</p> : null}
                {r.moderationNote ? <p className="mt-2 text-sm text-ink-muted">Moderation note: {r.moderationNote}</p> : null}
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setTarget(r)}>{r.status === 'PUBLISHED' ? 'Hide' : 'Publish again'}</Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {list.data ? <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} /> : null}
      <ReasonDialog
        open={!!target}
        title={target?.status === 'PUBLISHED' ? 'Hide this review?' : 'Publish this review again?'}
        confirmLabel={target?.status === 'PUBLISHED' ? 'Hide' : 'Publish'}
        onClose={() => setTarget(null)}
        onSubmit={({ reason }) => run(() => api.reviews.moderate(target.id, target.status === 'PUBLISHED' ? 'HIDDEN' : 'PUBLISHED', reason), { success: 'Review updated', invalidate: [['admin-reviews']] })}
      />
    </>
  );
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [applied, setApplied] = useState({});
  const [open, setOpen] = useState(null);
  const query = { page, pageSize: 50, ...applied };
  const list = useQuery({ queryKey: ['audit', query], queryFn: () => api.audit(query), placeholderData: (p) => p });

  return (
    <>
      <PageHeader title="Audit log" description="Every sign-in event, approval, money movement and staff action. Entries can’t be edited or deleted." />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied({ ...(action.trim() ? { action: action.trim() } : {}), ...(entityId.trim() ? { entityId: entityId.trim() } : {}) }); setPage(1); }}>
          <Input label="Action starts with" placeholder="refund. · order. · payout." value={action} onChange={(e) => setAction(e.target.value)} />
          <Input label="Record id" placeholder="UUID" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
      </Card>
      <Card>
        {list.isPending ? <LoadingBlock /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <>
            <Table
              columns={[
                { key: 'at', header: 'When', render: (a) => dateTime(a.createdAt) },
                { key: 'who', header: 'Who', render: (a) => `${a.actorName ?? 'System'} (${a.actorRole.toLowerCase()})` },
                { key: 'action', header: 'Action', render: (a) => <code className="text-sm">{a.action}</code> },
                { key: 'what', header: 'Record', render: (a) => <span className="text-sm text-ink-muted">{a.entityType}{a.entityId ? ` ${a.entityId.slice(0, 8)}…` : ''}</span> },
              ]}
              rows={list.data.items}
              rowKey={(a) => a.id}
              onRowClick={setOpen}
              empty={<EmptyState icon={FileClock} title="No entries" />}
            />
            <Pagination page={page} pageSize={50} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ''} size="lg">
        {open ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>{dateTime(open.createdAt)} · {open.actorName ?? 'System'} ({open.actorRole.toLowerCase()}){open.ipAddress ? ` · ${open.ipAddress}` : ''}</p>
            <p>{open.entityType} <code>{open.entityId}</code></p>
            {open.before ? <><h3 className="font-bold">Before</h3><pre className="overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">{JSON.stringify(open.before, null, 2)}</pre></> : null}
            {open.after ? <><h3 className="font-bold">After</h3><pre className="overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">{JSON.stringify(open.after, null, 2)}</pre></> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
