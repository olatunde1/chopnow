import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LoginRequestSchema, RegisterRequestSchema } from '@chopnow/shared-schemas';
import { Button, Card, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { useSession } from '../state/session';

function zodErrors(result) {
  const out = {};
  if (result.success) return out;
  for (const i of result.error.issues) {
    const k = String(i.path[0] ?? 'form');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand text-lg font-extrabold text-white" aria-hidden>
            C
          </div>
          <div>
            <p className="text-xl font-extrabold">ChopNow for Restaurants</p>
            <p className="text-sm text-ink-muted">Manage orders, menu and sales</p>
          </div>
        </div>
        <Card>
          <h1 className="text-2xl font-extrabold">{title}</h1>
          {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </Card>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signIn, error: sessionError } = useSession();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMessage(null);
    const parsed = LoginRequestSchema.safeParse(form);
    if (!parsed.success) return setErrors(zodErrors(parsed));
    setErrors({});
    setBusy(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setMessage(err.message);
      } else setMessage('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Use your restaurant account.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {message || sessionError ? (
          <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
            {message ?? sessionError}
          </p>
        ) : null}
        <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <Input label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm text-ink-muted">
          New restaurant?{' '}
          <Link to="/register" className="font-semibold text-brand underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setMessage(null);
    const parsed = RegisterRequestSchema.safeParse({ ...form, role: 'VENDOR' });
    if (!parsed.success) return setErrors(zodErrors(parsed));
    setErrors({});
    setBusy(true);
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setMessage(err.message);
      } else setMessage('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create a restaurant account" subtitle="Next, you’ll add your restaurant for approval.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {message ? (
          <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
            {message}
          </p>
        ) : null}
        <Input label="Your full name" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
        <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Input label="Phone number" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} error={errors.phone} hint="e.g. 0803 123 4567" />
        <Input label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters, with a letter and a number" />
        <Button type="submit" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-sm text-ink-muted">
          Already registered?{' '}
          <Link to="/" className="font-semibold text-brand underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
