import { useState } from 'react';
import { ArrowUpRight, MailCheck } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { ApiError, useRequestPasswordReset, useResetPassword } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function errorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiError) {
    if (error.status === 429) return t('auth.error.RATE_LIMITED');
    const code = (error.data as { error?: string } | undefined)?.error;
    if (code) return t(`auth.error.${code}`);
  }
  return t('auth.error.generic');
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <Link href="/" className="brand auth-brand"><span className="brand-mark"><ArrowUpRight size={15} /></span><span className="brand-name">Reflect</span></Link>
      {children}
    </div>
  );
}

/** "Forgot password": asks for the email and always answers the same way. */
export function ForgotPasswordPage() {
  const { t } = useI18n();
  const request = useRequestPasswordReset();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    try {
      await request.mutateAsync({ data: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };

  if (sent) {
    return <Shell><div className="card auth-card" data-testid="reset-sent">
      <MailCheck size={22} className="auth-icon" aria-hidden />
      <h1>{t('auth.reset.sent.title')}</h1>
      <p className="auth-lead">{t('auth.reset.sent.body')}</p>
      <Link href="/login" className="auth-switch">{t('auth.reset.back')}</Link>
    </div></Shell>;
  }
  return <Shell>
    <form className="card auth-card" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      <h1>{t('auth.reset.title')}</h1>
      <p className="auth-lead">{t('auth.reset.lead')}</p>
      <div className="field"><label htmlFor="reset-email">{t('auth.email')}</label><input id="reset-email" type="email" required value={email} autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} data-testid="input-reset-email" /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn auth-submit" disabled={request.isPending || !email} data-testid="button-reset-request">{request.isPending ? t('auth.pending') : t('auth.reset.submit')}</button>
      <Link href="/login" className="auth-switch">{t('auth.reset.back')}</Link>
    </form>
  </Shell>;
}

/** Opened from the link in the email (or from the administrator): sets a new password and signs in. */
export function ResetPasswordPage() {
  const { t } = useI18n();
  const search = useSearch();
  const token = new URLSearchParams(search).get('token') ?? '';
  const { refresh, leaveDemo } = useSession();
  const [, navigate] = useLocation();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (password.length < 8) { setError(t('auth.error.WEAK_PASSWORD')); return; }
    try {
      await reset.mutateAsync({ data: { token, password } });
      leaveDemo();
      await refresh();
      navigate('/overview');
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };

  if (!token) {
    return <Shell><div className="card auth-card">
      <h1>{t('auth.newPassword.title')}</h1>
      <p className="form-error" role="alert">{t('auth.error.INVALID_RESET_LINK')}</p>
      <Link href="/forgot-password" className="auth-switch">{t('auth.reset.again')}</Link>
    </div></Shell>;
  }
  return <Shell>
    <form className="card auth-card" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
      <h1>{t('auth.newPassword.title')}</h1>
      <div className="field"><label htmlFor="new-password">{t('auth.newPassword.label')}</label><input id="new-password" type="password" required minLength={8} value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} data-testid="input-new-password" /><small>{t('auth.password.hint')}</small></div>
      {error && <p className="form-error" role="alert" data-testid="reset-error">{error}</p>}
      <button type="submit" className="btn auth-submit" disabled={reset.isPending || !password} data-testid="button-reset-submit">{reset.isPending ? t('auth.pending') : t('auth.newPassword.submit')}</button>
      {error && <Link href="/forgot-password" className="auth-switch">{t('auth.reset.again')}</Link>}
    </form>
  </Shell>;
}
