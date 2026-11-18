import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { ApiError, useLoginAccount, useRegisterAccount } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { nextPath } from '@/lib/next-path';

function errorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiError) {
    if (error.status === 429) return t('auth.error.RATE_LIMITED');
    const code = (error.data as { error?: string } | undefined)?.error;
    if (code) return t(`auth.error.${code}`);
  }
  return t('auth.error.generic');
}

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n();
  const { refresh, leaveDemo } = useSession();
  const [, navigate] = useLocation();
  const login = useLoginAccount();
  const register = useRegisterAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const pending = login.isPending || register.isPending;
  const isRegister = mode === 'register';

  const submit = async () => {
    setError('');
    if (isRegister && password.length < 8) { setError(t('auth.error.WEAK_PASSWORD')); return; }
    try {
      if (isRegister) await register.mutateAsync({ data: { email: email.trim(), password, ...(name.trim() ? { name: name.trim() } : {}) } });
      else await login.mutateAsync({ data: { email: email.trim(), password } });
      leaveDemo();
      await refresh();
      navigate(nextPath());
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };

  return (
    <div className="auth-page">
      <Link href="/" className="brand auth-brand"><span className="brand-mark"><ArrowUpRight size={15} /></span><span className="brand-name">Reflect</span></Link>
      <form className="card auth-card" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
        <h1>{t(isRegister ? 'auth.register.title' : 'auth.login.title')}</h1>
        {isRegister && <div className="field"><label htmlFor="auth-name">{t('auth.name')}</label><input id="auth-name" value={name} maxLength={80} autoComplete="name" onChange={(event) => setName(event.target.value)} /></div>}
        <div className="field"><label htmlFor="auth-email">{t('auth.email')}</label><input id="auth-email" type="email" required value={email} autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} data-testid="input-email" /></div>
        <div className="field"><label htmlFor="auth-password">{t('auth.password')}</label><input id="auth-password" type="password" required minLength={isRegister ? 8 : 1} value={password} autoComplete={isRegister ? 'new-password' : 'current-password'} onChange={(event) => setPassword(event.target.value)} aria-describedby={isRegister ? 'password-hint' : undefined} data-testid="input-password" />{isRegister && <small id="password-hint" className="hint-text">{t('auth.password.hint')}</small>}</div>
        {!isRegister && <Link href="/forgot-password" className="auth-forgot" data-testid="link-forgot-password">{t('auth.forgot')}</Link>}
        {error && <p className="form-error" role="alert" data-testid="auth-error">{error}</p>}
        <button type="submit" className="btn auth-submit" disabled={pending || !email || !password} data-testid="button-auth-submit">{pending ? t('auth.pending') : t(isRegister ? 'auth.submit.register' : 'auth.submit.login')}</button>
        <Link href={`${isRegister ? '/login' : '/register'}${window.location.search}`} className="auth-switch">{t(isRegister ? 'auth.switch.toLogin' : 'auth.switch.toRegister')}</Link>
      </form>
    </div>
  );
}
