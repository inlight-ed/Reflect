import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link, useLocation, useRoute } from 'wouter';
import { getGetInviteQueryKey, useAcceptInvite, useGetInvite } from '@workspace/api-client-react';
import { fill, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * An invitation link. Anyone can see which workspace it opens; joining needs an account, and the
 * sign-in and sign-up pages bring the person back here afterwards.
 */
export default function InvitePage() {
  const { t } = useI18n();
  const [, params] = useRoute('/invite/:token');
  const token = params?.token ?? '';
  const { signedIn, loading, enteredWorkspace, leaveDemo } = useSession();
  const [, navigate] = useLocation();
  const preview = useGetInvite(token, { query: { queryKey: getGetInviteQueryKey(token), enabled: Boolean(token), retry: false } });
  const accept = useAcceptInvite();
  const [failed, setFailed] = useState(false);
  const back = `?next=${encodeURIComponent(`/invite/${token}`)}`;

  const join = async () => {
    try {
      await accept.mutateAsync({ token });
      leaveDemo();
      await enteredWorkspace();
      navigate('/overview');
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="auth-page">
      <Link href="/" className="brand auth-brand"><span className="brand-mark"><ArrowUpRight size={15} /></span><span className="brand-name">Reflect</span></Link>
      <div className="card auth-card" data-testid="invite-card">
        <h1>{t('invite.title')}</h1>
        {preview.isLoading || loading ? <p className="hint-text">{t('auth.pending')}</p>
          : preview.isError || !preview.data || failed ? <p className="form-error" role="alert" data-testid="invite-invalid">{t('invite.invalid')}</p>
          : <>
            <p data-testid="invite-text">{fill(t('invite.body'), { name: preview.data.name, kind: t(`workspace.kind.${preview.data.kind}`).toLowerCase(), role: t(`workspace.role.${preview.data.role}`).toLowerCase() })}</p>
            <p className="hint-text">{t(`workspace.role.${preview.data.role}.help`)}</p>
            {signedIn
              ? <button type="button" className="btn auth-submit" disabled={accept.isPending} onClick={() => void join()} data-testid="invite-accept">{t('invite.accept')}</button>
              : <div className="center-actions">
                <Link href={`/login${back}`} className="btn" data-testid="invite-login">{t('landing.cta.login')}</Link>
                <Link href={`/register${back}`} className="btn secondary" data-testid="invite-register">{t('auth.submit.register')}</Link>
              </div>}
          </>}
      </div>
    </div>
  );
}
