import { useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { MenuItemInputSchema } from '@chopnow/shared-schemas';
import { ApiError, api } from '../lib/api';
import { koboToNairaInput, nairaToKobo } from '../lib/format';
import { Button, Input, Modal, Select, Switch, Textarea } from './ui';

const blankVariant = () => ({ key: Math.random().toString(36).slice(2), name: '', price: '', isDefault: false, isAvailable: true });
const blankExtra = () => ({ key: Math.random().toString(36).slice(2), name: '', price: '', maxQuantity: '1', isAvailable: true });

function fromItem(item, defaultCategoryId) {
  return {
    categoryId: item?.categoryId ?? defaultCategoryId ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    price: koboToNairaInput(item?.priceKobo),
    prepTimeMinutes: item?.prepTimeMinutes ? String(item.prepTimeMinutes) : '',
    imageUrl: item?.imageUrl ?? null,
    isAvailable: item?.isAvailable ?? true,
    variants: (item?.variants ?? []).map((v) => ({ key: v.id, id: v.id, name: v.name, price: koboToNairaInput(v.priceKobo), isDefault: v.isDefault, isAvailable: v.isAvailable })),
    extras: (item?.extras ?? []).map((e) => ({ key: e.id, id: e.id, name: e.name, price: koboToNairaInput(e.priceKobo), maxQuantity: String(e.maxQuantity), isAvailable: e.isAvailable })),
  };
}

/** Builds the API payload; price text that isn't a valid naira amount becomes a field error. */
export function toItemPayload(form) {
  const errors = {};
  const price = nairaToKobo(form.price);
  if (price === null) errors.price = 'Enter a price in naira, e.g. 2500';
  const variants = form.variants.map((v, i) => {
    const p = nairaToKobo(v.price);
    if (p === null) errors[`variant-${i}`] = 'Enter a price';
    return { ...(v.id ? { id: v.id } : {}), name: v.name, priceKobo: p ?? 0, isDefault: v.isDefault, isAvailable: v.isAvailable };
  });
  const extras = form.extras.map((e, i) => {
    const p = nairaToKobo(e.price);
    if (p === null) errors[`extra-${i}`] = 'Enter a price';
    return { ...(e.id ? { id: e.id } : {}), name: e.name, priceKobo: p ?? 0, maxQuantity: Number(e.maxQuantity) || 1, isAvailable: e.isAvailable };
  });
  const payload = {
    categoryId: form.categoryId,
    name: form.name,
    description: form.description,
    imageUrl: form.imageUrl,
    priceKobo: price ?? 0,
    isAvailable: form.isAvailable,
    prepTimeMinutes: form.prepTimeMinutes ? Number(form.prepTimeMinutes) : null,
    variants,
    extras,
  };
  const parsed = MenuItemInputSchema.safeParse(payload);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const k = i.path[0] === 'variants' || i.path[0] === 'extras' ? `${i.path[0]}` : String(i.path[0]);
      if (!errors[k]) errors[k] = i.message;
    }
  }
  return { ok: Object.keys(errors).length === 0, payload: parsed.success ? parsed.data : payload, errors };
}

export function ItemEditor({ open, onClose, restaurantId, categories, item, defaultCategoryId, onSaved }) {
  const [form, setForm] = useState(() => fromItem(item, defaultCategoryId));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setRow = (list, idx, patch) => setForm((f) => ({ ...f, [list]: f[list].map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));
  const removeRow = (list, idx) => setForm((f) => ({ ...f, [list]: f[list].filter((_, i) => i !== idx) }));

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const res = await api.restaurants.uploadImage(restaurantId, file, 'menu_item');
      setForm((f) => ({ ...f, imageUrl: res.url }));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    const { ok, payload, errors: errs } = toItemPayload(form);
    setErrors(errs);
    if (!ok) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = item ? await api.menu.updateItem(restaurantId, item.id, payload) : await api.menu.createItem(restaurantId, payload);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        setMessage(e.message);
      } else setMessage('Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={item ? `Edit ${item.name}` : 'Add a dish'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {item ? 'Save changes' : 'Add dish'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-muted">
            {form.imageUrl ? <img src={form.imageUrl} alt="Dish photo" className="size-full object-cover" /> : <ImagePlus className="size-8 text-ink-muted" aria-hidden />}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="dish-photo" aria-label="Upload dish photo" onChange={(e) => upload(e.target.files?.[0])} />
          <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
            {form.imageUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {form.imageUrl ? (
            <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, imageUrl: null })}>
              Remove photo
            </Button>
          ) : null}
          <p className="text-xs text-ink-muted">JPG, PNG or WebP, up to 5 MB.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {message ? (
            <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad sm:col-span-2">
              {message}
            </p>
          ) : null}
          <Input className="sm:col-span-2" label="Dish name" value={form.name} onChange={set('name')} error={errors.name} />
          <Textarea className="sm:col-span-2" label="Description" value={form.description} onChange={set('description')} error={errors.description} />
          <Select label="Category" value={form.categoryId} onChange={set('categoryId')} error={errors.categoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input label="Price (₦)" inputMode="decimal" value={form.price} onChange={set('price')} error={errors.price} hint={form.variants.length ? 'Used when no option is chosen; option prices apply otherwise.' : undefined} />
          <Input label="Prep time (minutes, optional)" type="number" min={1} max={180} value={form.prepTimeMinutes} onChange={set('prepTimeMinutes')} error={errors.prepTimeMinutes} />
          <div className="flex items-end pb-2">
            <Switch checked={form.isAvailable} onChange={(v) => setForm({ ...form, isAvailable: v })} label="Available" description={form.isAvailable ? 'Available' : 'Sold out'} />
          </div>
        </div>
      </div>

      <fieldset className="mt-6 flex flex-col gap-3">
        <legend className="mb-2 font-bold">Options (e.g. sizes)</legend>
        {errors.variants ? <p className="text-sm text-bad">{errors.variants}</p> : null}
        {form.variants.map((v, i) => (
          <div key={v.key} className="grid items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_140px_auto_auto_auto]">
            <Input label="Option name" value={v.name} onChange={(e) => setRow('variants', i, { name: e.target.value })} />
            <Input label="Price (₦)" inputMode="decimal" value={v.price} onChange={(e) => setRow('variants', i, { price: e.target.value })} error={errors[`variant-${i}`]} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="default-variant" checked={v.isDefault} onChange={() => setForm((f) => ({ ...f, variants: f.variants.map((x, j) => ({ ...x, isDefault: j === i })) }))} className="size-5 accent-[var(--color-brand)]" />
              Default
            </label>
            <Switch checked={v.isAvailable} onChange={(on) => setRow('variants', i, { isAvailable: on })} label={`${v.name || 'Option'} available`} />
            <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove option ${v.name}`} onClick={() => removeRow('variants', i)} />
          </div>
        ))}
        <Button variant="outline" size="sm" icon={Plus} className="self-start" onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, blankVariant()] }))}>
          Add option
        </Button>
      </fieldset>

      <fieldset className="mt-6 flex flex-col gap-3">
        <legend className="mb-2 font-bold">Extras (e.g. chicken, plantain)</legend>
        {errors.extras ? <p className="text-sm text-bad">{errors.extras}</p> : null}
        {form.extras.map((x, i) => (
          <div key={x.key} className="grid items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_120px_100px_auto_auto]">
            <Input label="Extra" value={x.name} onChange={(e) => setRow('extras', i, { name: e.target.value })} />
            <Input label="Price (₦)" inputMode="decimal" value={x.price} onChange={(e) => setRow('extras', i, { price: e.target.value })} error={errors[`extra-${i}`]} />
            <Input label="Max qty" type="number" min={1} max={20} value={x.maxQuantity} onChange={(e) => setRow('extras', i, { maxQuantity: e.target.value })} />
            <Switch checked={x.isAvailable} onChange={(on) => setRow('extras', i, { isAvailable: on })} label={`${x.name || 'Extra'} available`} />
            <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove extra ${x.name}`} onClick={() => removeRow('extras', i)} />
          </div>
        ))}
        <Button variant="outline" size="sm" icon={Plus} className="self-start" onClick={() => setForm((f) => ({ ...f, extras: [...f.extras, blankExtra()] }))}>
          Add extra
        </Button>
      </fieldset>
    </Modal>
  );
}
