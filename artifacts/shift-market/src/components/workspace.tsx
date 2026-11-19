import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Check, ChevronsUpDown, Copy, Link2, Plus, Store } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  ApiError,
  getGetWorkspaceMembersQueryKey,
  useCreateWorkspace,
  useCreateWorkspaceInvite,
  useGetWorkspaceMembers,
  useRemoveWorkspaceMember,
  useRenameWorkspace,
  useSetWorkspaceMemberRole,
  type WorkspaceInvite,
  type WorkspaceKind,
  type WorkspaceRole,
} from '@workspace/api-client-react';
import { fill, formatDate, useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { SectionTitle } from '@/components/common';
import { HoldButton } from '@/components/motion';

const ROLES: WorkspaceRole[] = ['OWNER', 'MEMBER', 'VIEWER'];
const KindIcon = ({ kind }: { kind: WorkspaceKind }) => (kind === 'AGENCY' ? <Briefcase size={14} /> : <Store size={14} />);
const errorCode = (error: unknown) => (error instanceof ApiError ? (error.data as { error?: string } | undefined)?.error ?? 'generic' : 'generic');

/**
 * The open workspace and the way to the others. Shown above the account in the sidebar; with a
 * single workspace it is just its name, and the list only offers to create an agency or a shop.
 */
export function WorkspaceSwitcher() {
  const { t } = useI18n();
  const { workspace, workspaces, openWorkspace, enteredWorkspace } = useSession();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<WorkspaceKind | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const create = useCreateWorkspace();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!workspace) return null;

  const choose = async (id: string) => {
    setOpen(false);
    if (id === workspace.id) return;
    await openWorkspace(id);
    navigate('/overview');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!creating || !name.trim()) return;
    try {
      await create.mutateAsync({ data: { kind: creating, name: name.trim() } });
      setCreating(null);
      setName('');
      setOpen(false);
      await enteredWorkspace();
      navigate(creating === 'AGENCY' ? '/media-plans' : '/overview');
    } catch (err) {
      setError(t(`workspace.error.${errorCode(err)}`));
    }
  };

  return (
    <div className="ws-switcher" ref={box}>
      <button type="button" className="ws-current" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" data-testid="workspace-switcher">
        <span className="ws-icon"><KindIcon kind={workspace.kind} /></span>
        <span className="ws-text"><strong data-testid="workspace-name">{workspace.name}</strong><small>{t(`workspace.kind.${workspace.kind}`)}{workspace.role === 'VIEWER' ? ` · ${t('workspace.role.VIEWER')}` : ''}</small></span>
        <ChevronsUpDown size={14} />
      </button>
      {open && (
        <div className="ws-menu" role="menu">
          {workspaces.map((item) => (
            <button type="button" role="menuitem" key={item.id} className={`ws-option ${item.id === workspace.id ? 'active' : ''}`} onClick={() => void choose(item.id)} data-testid={`workspace-option-${item.kind.toLowerCase()}`}>
              <KindIcon kind={item.kind} /><span>{item.name}</span>{item.id === workspace.id && <Check size={14} />}
            </button>
          ))}
          <div className="ws-divider" />
          {creating ? (
            <form className="ws-create" onSubmit={(event) => void submit(event)}>
              <label htmlFor="ws-new-name">{t(creating === 'AGENCY' ? 'workspace.create.agencyName' : 'workspace.create.shopName')}</label>
              <input id="ws-new-name" autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="workspace-new-name" />
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="ws-create-actions">
                <button type="submit" className="btn btn-small" disabled={!name.trim() || create.isPending} data-testid="workspace-create-submit">{t('workspace.create.submit')}</button>
                <button type="button" className="btn secondary btn-small" onClick={() => { setCreating(null); setError(''); }}>{t('workspace.cancel')}</button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" className="ws-option" onClick={() => setCreating('AGENCY')} data-testid="workspace-create-agency"><Plus size={14} /><span>{t('workspace.create.agency')}</span></button>
              <button type="button" role="menuitem" className="ws-option" onClick={() => setCreating('SHOP')} data-testid="workspace-create-shop"><Plus size={14} /><span>{t('workspace.create.shop')}</span></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Settings: the workspace's name, its people and invitation links. */
export function TeamSection() {
  const { locale, t } = useI18n();
  const { session, workspace, isOwner, enteredWorkspace } = useSession();
  const queryClient = useQueryClient();
  const members = useGetWorkspaceMembers({ query: { queryKey: getGetWorkspaceMembersQueryKey(), enabled: Boolean(workspace) } });
  const setRole = useSetWorkspaceMemberRole();
  const remove = useRemoveWorkspaceMember();
  const rename = useRenameWorkspace();
  const invite = useCreateWorkspaceInvite();
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('MEMBER');
  const [link, setLink] = useState<WorkspaceInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(workspace?.name ?? '');
  const [error, setError] = useState('');
  const [, navigate] = useLocation();
  useEffect(() => { setName(workspace?.name ?? ''); setLink(null); }, [workspace?.id, workspace?.name]);
  if (!workspace) return null;

  const me = session?.user?.id;
  // The only owner cannot leave (the server refuses too); they hand ownership over first.
  const soleOwner = isOwner && (members.data ?? []).filter((member) => member.role === 'OWNER').length <= 1;
  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: getGetWorkspaceMembersQueryKey() });
    } catch (err) {
      setError(t(`workspace.error.${errorCode(err)}`));
    }
  };
  const url = link ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/invite/${link.token}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <section className="team" data-testid="team-section">
      <SectionTitle title={t('workspace.team')} note={fill(t('workspace.team.note'), { name: workspace.name })} />
      <div className="card card-pad team-card">
        {isOwner && (
          <form className="team-rename" onSubmit={(event) => { event.preventDefault(); void run(async () => { await rename.mutateAsync({ data: { name: name.trim() } }); await enteredWorkspace(); }); }}>
            <label htmlFor="ws-name">{t('workspace.name')}</label>
            <input id="ws-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="workspace-rename" />
            {name.trim() && name.trim() !== workspace.name && <button type="submit" className="btn btn-small secondary" disabled={rename.isPending}>{t('workspace.save')}</button>}
          </form>
        )}
        <div className="table-wrap"><table className="data-table" data-testid="team-members">
          <thead><tr><th>{t('workspace.member')}</th><th>{t('workspace.role')}</th><th>{t('workspace.joined')}</th><th /></tr></thead>
          <tbody>{(members.data ?? []).map((member) => (
            <tr key={member.userId} data-testid={`member-${member.email}`}>
              <td><strong>{member.name || member.email}</strong>{member.name && <span className="table-sub">{member.email}</span>}</td>
              <td>{isOwner && member.userId !== me
                ? <select aria-label={t('workspace.role')} value={member.role} onChange={(event) => void run(() => setRole.mutateAsync({ userId: member.userId, data: { role: event.target.value as WorkspaceRole } }))} data-testid={`member-role-${member.email}`}>{ROLES.map((role) => <option key={role} value={role}>{t(`workspace.role.${role}`)}</option>)}</select>
                : t(`workspace.role.${member.role}`)}</td>
              <td>{formatDate(member.joinedAt, locale)}</td>
              <td className="team-actions">{member.userId === me
                ? !soleOwner && <HoldButton className="btn-small secondary danger" description={t('workspace.leave.confirm')} onConfirm={() => void run(async () => { await remove.mutateAsync({ userId: member.userId }); await enteredWorkspace(); navigate('/overview'); })} testId="workspace-leave">{t('workspace.leave')}</HoldButton>
                : isOwner && <HoldButton className="btn-small secondary danger" description={fill(t('workspace.remove.confirm'), { name: member.name || member.email })} onConfirm={() => void run(() => remove.mutateAsync({ userId: member.userId }))} testId={`member-remove-${member.email}`}>{t('workspace.remove')}</HoldButton>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="hint-text">{t('workspace.roles.help')}</p>
        {isOwner && (
          <div className="team-invite">
            <label htmlFor="invite-role">{t('workspace.invite.role')}</label>
            <select id="invite-role" value={inviteRole} onChange={(event) => { setInviteRole(event.target.value as WorkspaceRole); setLink(null); }} data-testid="invite-role">{ROLES.map((role) => <option key={role} value={role}>{t(`workspace.role.${role}`)}</option>)}</select>
            <button type="button" className="btn btn-small" disabled={invite.isPending} onClick={() => void run(async () => { setCopied(false); setLink(await invite.mutateAsync({ data: { role: inviteRole } })); })} data-testid="invite-create"><Link2 size={14} /> {t('workspace.invite.create')}</button>
          </div>
        )}
        {link && (
          <div className="team-link" data-testid="invite-link">
            <input readOnly value={url} aria-label={t('workspace.invite.link')} onFocus={(event) => event.currentTarget.select()} data-testid="invite-url" />
            <button type="button" className="btn btn-small secondary" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} {t(copied ? 'workspace.invite.copied' : 'workspace.invite.copy')}</button>
            <small className="hint-text">{fill(t('workspace.invite.note'), { date: formatDate(link.expiresAt, locale) })}</small>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
