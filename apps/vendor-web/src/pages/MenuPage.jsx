import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, ImageOff, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { ItemEditor } from '../components/ItemEditor';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, LoadingBlock, Modal, Money, PageHeader, Switch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../state/session';

export function MenuPage() {
  const { restaurant } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const menu = useQuery({ queryKey: ['menu', restaurant.id], queryFn: () => api.menu.get(restaurant.id) });
  const [editor, setEditor] = useState(null); // { item?, categoryId }
  const [categoryModal, setCategoryModal] = useState(null); // { id?, name }
  const [confirm, setConfirm] = useState(null); // { kind, target }
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['menu', restaurant.id] });

  const act = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.show(success, 'success');
      refresh();
    } catch (e) {
      toast.show(e.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (menu.isPending) return <LoadingBlock label="Loading menu" />;
  if (menu.isError) return <ErrorState error={menu.error} onRetry={menu.refetch} />;
  const categories = menu.data.categories;

  return (
    <>
      <PageHeader
        title="Menu"
        description="Changes show to customers immediately. Mark dishes sold out instead of deleting them."
        actions={
          <>
            <Button variant="outline" icon={Plus} onClick={() => setCategoryModal({ name: '' })}>
              Add category
            </Button>
            <Button icon={Plus} disabled={!categories.length} onClick={() => setEditor({ categoryId: categories[0]?.id })}>
              Add dish
            </Button>
          </>
        }
      />

      {categories.length === 0 ? (
        <Card>
          <EmptyState icon={UtensilsCrossed} title="Start your menu" message="Create a category such as “Rice” or “Soups”, then add dishes to it." action={<Button onClick={() => setCategoryModal({ name: '' })}>Add first category</Button>} />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {categories.map((c) => (
            <Card key={c.id} aria-label={c.name}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{c.name}</h2>
                {!c.isActive ? <Badge tone="neutral">Hidden from customers</Badge> : null}
                <div className="ml-auto flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" icon={Plus} onClick={() => setEditor({ categoryId: c.id })}>
                    Dish
                  </Button>
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setCategoryModal({ id: c.id, name: c.name })}>
                    Rename
                  </Button>
                  <Button variant="ghost" size="sm" icon={c.isActive ? EyeOff : Eye} onClick={() => act(() => api.menu.updateCategory(restaurant.id, c.id, { isActive: !c.isActive }), c.isActive ? `${c.name} hidden` : `${c.name} visible`)}>
                    {c.isActive ? 'Hide' : 'Show'}
                  </Button>
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirm({ kind: 'category', target: c })}>
                    Delete
                  </Button>
                </div>
              </div>
              {c.items.length === 0 ? (
                <p className="text-sm text-ink-muted">No dishes in this category yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {c.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                        {i.imageUrl ? <img src={i.imageUrl} alt="" className="size-full object-cover" /> : <ImageOff className="m-4 size-6 text-ink-muted" aria-hidden />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-words">{i.name}</p>
                        <p className="text-sm text-ink-muted">
                          {i.variants.length ? 'from ' : ''}
                          <Money kobo={i.fromPriceKobo} />
                          {i.variants.length ? ` · ${i.variants.length} options` : ''}
                          {i.extras.length ? ` · ${i.extras.length} extras` : ''}
                        </p>
                      </div>
                      <Switch
                        checked={i.isAvailable}
                        onChange={(on) => act(() => api.menu.setItemAvailable(restaurant.id, i.id, on), on ? `${i.name} available` : `${i.name} marked sold out`)}
                        label={`${i.name} available`}
                        description={i.isAvailable ? 'Available' : 'Sold out'}
                        disabled={busy}
                      />
                      <Button variant="outline" size="sm" icon={Pencil} onClick={() => setEditor({ item: i, categoryId: c.id })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Delete ${i.name}`} onClick={() => setConfirm({ kind: 'item', target: i })} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {editor ? (
        <ItemEditor
          key={editor.item?.id ?? `new-${editor.categoryId}`}
          open
          onClose={() => setEditor(null)}
          restaurantId={restaurant.id}
          categories={categories}
          item={editor.item}
          defaultCategoryId={editor.categoryId}
          onSaved={(saved) => {
            setEditor(null);
            toast.show(`${saved.name} saved`, 'success');
            refresh();
          }}
        />
      ) : null}

      <Modal
        open={!!categoryModal}
        onClose={() => setCategoryModal(null)}
        title={categoryModal?.id ? 'Rename category' : 'Add category'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCategoryModal(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!categoryModal?.name.trim()}
              onClick={async () => {
                const { id, name } = categoryModal;
                await act(() => (id ? api.menu.updateCategory(restaurant.id, id, { name: name.trim() }) : api.menu.createCategory(restaurant.id, { name: name.trim() })), 'Category saved');
                setCategoryModal(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Input label="Category name" value={categoryModal?.name ?? ''} onChange={(e) => setCategoryModal({ ...categoryModal, name: e.target.value })} placeholder="e.g. Rice, Soups, Drinks" />
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'item' ? `Delete ${confirm?.target.name}?` : `Delete ${confirm?.target.name}?`}
        message={confirm?.kind === 'item' ? 'It disappears from your menu. Past orders keep their details. To pause it temporarily, mark it sold out instead.' : 'Only empty categories can be deleted.'}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const { kind, target } = confirm;
          await act(() => (kind === 'item' ? api.menu.deleteItem(restaurant.id, target.id) : api.menu.deleteCategory(restaurant.id, target.id)), `${target.name} deleted`);
          setConfirm(null);
        }}
      />
    </>
  );
}
