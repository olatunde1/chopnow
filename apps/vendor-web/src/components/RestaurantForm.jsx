import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { RestaurantCreateSchema } from '@chopnow/shared-schemas';
import { koboToNairaInput, nairaToKobo } from '../lib/format';
import { Button, Input, Textarea } from './ui';

const toForm = (r) => ({
  name: r?.name ?? '',
  description: r?.description ?? '',
  phone: r?.phone ?? '',
  email: r?.email ?? '',
  addressLine: r?.addressLine ?? '',
  area: r?.area ?? '',
  city: r?.city ?? 'Sagamu',
  latitude: r?.latitude?.toString() ?? '',
  longitude: r?.longitude?.toString() ?? '',
  prepTimeMinutes: String(r?.prepTimeMinutes ?? 20),
  minOrder: koboToNairaInput(r?.minOrderKobo ?? 0),
});

/** Converts the form into the API shape, validated with the same schema the API uses. */
export function parseRestaurantForm(form) {
  const minOrderKobo = nairaToKobo(form.minOrder || '0');
  const input = {
    name: form.name,
    description: form.description,
    phone: form.phone,
    ...(form.email.trim() ? { email: form.email } : {}),
    addressLine: form.addressLine,
    area: form.area,
    city: form.city,
    latitude: form.latitude === '' ? undefined : Number(form.latitude),
    longitude: form.longitude === '' ? undefined : Number(form.longitude),
    prepTimeMinutes: Number(form.prepTimeMinutes),
    minOrderKobo: minOrderKobo ?? -1,
  };
  const result = RestaurantCreateSchema.safeParse(input);
  const errors = {};
  if (!result.success) {
    for (const i of result.error.issues) {
      const k = i.path[0] === 'minOrderKobo' ? 'minOrder' : String(i.path[0]);
      if (!errors[k]) errors[k] = k === 'minOrder' ? 'Enter an amount in naira, e.g. 1500' : i.message;
    }
  }
  return { ok: result.success, data: result.success ? result.data : null, errors };
}

/** Restaurant details used for both the application and later profile edits. */
export function RestaurantForm({ initial, onSubmit, submitLabel, serverErrors = {} }) {
  const [form, setForm] = useState(() => toForm(initial));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const all = { ...errors, ...serverErrors };

  const locate = () => {
    if (!navigator.geolocation) return setErrors({ ...errors, latitude: 'Location is not available in this browser. Enter coordinates manually.' });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
      },
      () => {
        setErrors((e) => ({ ...e, latitude: 'We couldn’t get your location. Allow location access or enter coordinates.' }));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    const parsed = parseRestaurantForm(form);
    setErrors(parsed.errors);
    if (!parsed.ok) return;
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Input className="sm:col-span-2" label="Restaurant name" value={form.name} onChange={set('name')} error={all.name} />
      <Textarea className="sm:col-span-2" label="Description" value={form.description} onChange={set('description')} error={all.description} hint="What customers should know: cuisine, specialities." />
      <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={all.phone} />
      <Input label="Email (optional)" type="email" value={form.email} onChange={set('email')} error={all.email} />
      <Input className="sm:col-span-2" label="Street address" value={form.addressLine} onChange={set('addressLine')} error={all.addressLine} />
      <Input label="Area" value={form.area} onChange={set('area')} error={all.area} />
      <Input label="City" value={form.city} onChange={set('city')} error={all.city} />
      <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <legend className="px-1 text-sm font-semibold">Map location (used for delivery distance)</legend>
        <Input label="Latitude" inputMode="decimal" value={form.latitude} onChange={set('latitude')} error={all.latitude} />
        <Input label="Longitude" inputMode="decimal" value={form.longitude} onChange={set('longitude')} error={all.longitude} />
        <Button variant="secondary" icon={LocateFixed} onClick={locate} loading={locating}>
          Use my location
        </Button>
      </fieldset>
      <Input label="Usual preparation time (minutes)" type="number" min={5} max={180} value={form.prepTimeMinutes} onChange={set('prepTimeMinutes')} error={all.prepTimeMinutes} />
      <Input label="Minimum order (₦)" inputMode="decimal" value={form.minOrder} onChange={set('minOrder')} error={all.minOrder} hint="0 for no minimum" />
      <div className="sm:col-span-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
