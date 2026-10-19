import { useState } from 'react';
import { LoginRequestSchema, PasswordSchema } from '@chopnow/shared-schemas';
import { Button, Card, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { useSession } from '../state/session';

function Layout({ title, subtitle, children }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-ink text-lg font-extrabold text-white" aria-hidden>
            C
          </div>
          <div>
            <p className="text-xl font-extrabold">ChopNow Admin</p>
            <p className="text-sm text-ink-muted">Operations, support and finance</p>
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
    if (!parsed.success) {
      const out = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      return setErrors(out);
    }
    setErrors({});
    setBusy(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const shown = message ?? sessionError;
  return (
    <Layout title="Sign in" subtitle="Staff accounts only.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {shown ? (
          <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
            {shown}
          </p>
        ) : null}
        <Input label="Email" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <Input label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
    </Layout>
  );
}

/** Shown when the account still has its one-time password; nothing else works until it's changed. */
export function ChangePasswordPage() {
  const { changePassword, signOut, user } = useSession();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    const strong = PasswordSchema.safeParse(form.next);
    if (!form.current) errs.current = 'Enter the one-time password you were given';
    if (!strong.success) errs.next = strong.error.issues[0].message;
    else if (form.next.length < 12) errs.next = 'Staff passwords need at least 12 characters';
    if (form.next !== form.confirm) errs.confirm = 'The passwords don’t match';
    if (form.next && form.next === form.current) errs.next = 'Choose a password different from the one-time password';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setMessage(null);
    try {
      await changePassword(form.current, form.next);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="Set your password" subtitle={`Welcome, ${user?.fullName}. Replace your one-time password before you start.`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {message ? (
          <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
            {message}
          </p>
        ) : null}
        <Input label="One-time password" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} error={errors.current} />
        <Input label="New password" type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} error={errors.next} hint="At least 12 characters, with letters and numbers." />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} />
        <Button type="submit" loading={busy}>
          Save and continue
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </form>
    </Layout>
  );
}
