import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BellDot, ClipboardList, Database, FileText, LayoutDashboard, LogOut, Megaphone, Menu, MessageSquareText, Package, Radio, RefreshCw, Settings2, Users, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useGetAttention, useHealthCheck } from '@workspace/api-client-react';
import { formatTime, localeOptions, useI18n, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/use-now';
import { WorkspaceSwitcher } from '@/components/workspace';

export const nav = [
  { href: '/overview', label: 'Обзор', icon: LayoutDashboard, index: '01' },
  { href: '/attention', label: 'nav.attention', icon: BellDot, index: '02' },
  { href: '/advertising', label: 'Реклама', icon: Megaphone, index: '03' },
  { href: '/products', label: 'Товары', icon: Package, index: '04' },
  { href: '/media-plans', label: 'nav.media', icon: ClipboardList, index: '05' },
  { href: '/external-media', label: 'Внешние медиа', icon: Radio, index: '06' },
  { href: '/competitors', label: 'Конкуренты', icon: Users, index: '07' },
  { href: '/content', label: 'Контент', icon: FileText, index: '08' },
  { href: '/assistant', label: 'Спросить Reflect', icon: MessageSquareText, index: '09' },
];

const settingsItem = { href: '/settings', label: 'Настройки', icon: Settings2, index: '' };
const dataItem = { href: '/data', label: 'nav.data', icon: Database, index: '' };

const pageNames: Record<string, string> = Object.fromEntries([...nav, settingsItem, dataItem].map((item) => [item.href, item.label]));

const testId = (label: string) => label.toLowerCase().replace(/\s/g, '-');

function LanguageSelect({ id, className, testIdValue }: { id?: string; className?: string; testIdValue: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <select id={id} className={className} aria-label={id ? undefined : t('Язык интерфейса')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)} data-testid={testIdValue}>
      {localeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const health = useHealthCheck();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const { locale, t } = useI18n();
  const { signedIn, demo, session, signOut, leaveDemo, workspace } = useSession();
  const [, navigate] = useLocation();
  const now = useNow(30_000);
  const systemItems = signedIn ? [dataItem, settingsItem] : [settingsItem];
  // Serious items for the badge on "Needs attention"; refreshed with the rest of the app.
  const attention = useGetAttention(undefined, { query: { staleTime: 60_000 } as never });
  const urgent = attention.data?.high ?? 0;
  const currentName = t(pageNames[location] || (location.startsWith('/media-plans/') ? 'nav.media' : 'Обзор'));

  useEffect(() => { document.title = `Reflect — ${currentName}`; }, [currentName]);
  useEffect(() => { setMenuOpen(false); }, [location]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const clock = formatTime(now.toISOString(), locale);
  const isActive = (href: string) => location === href || (href === '/media-plans' && location.startsWith('/media-plans/'));

  return <div className="shell">
    <a className="skip-link" href="#main-content">{t('Обзор')}</a>
    <aside className="sidebar">
      <Link href="/overview" className="brand" data-testid="link-brand"><span className="brand-mark"><ArrowUpRight size={15} /></span><span className="brand-name">Reflect</span></Link>
      <nav className="nav-group" aria-label={t('Operating room')}>
        <div className="nav-label">{t('Operating room')}</div>
        {nav.map(({ href, label, icon: Icon, index }) => <Link href={href} className={`nav-item ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} key={href} data-testid={`link-nav-${testId(label)}`}><Icon /><span className="nav-copy">{t(label)}</span>{href === '/attention' && urgent > 0 ? <span className="nav-badge" data-testid="attention-badge" aria-label={`${urgent}`}>{urgent}</span> : <span className="nav-index">{index}</span>}</Link>)}
      </nav>
      <div className="nav-group"><div className="nav-label">{t('System')}</div>{systemItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`nav-item ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} data-testid={href === '/settings' ? 'link-nav-settings' : 'link-nav-data'}><Icon /><span className="nav-copy">{t(label)}</span></Link>)}</div>
      <div className="sidebar-foot">
        {signedIn && <WorkspaceSwitcher />}
        {signedIn ? (
          <div className="account-mini" data-testid="account-mini"><span className="account-email" title={session?.user?.email}>{session?.user?.name || session?.user?.email}</span><button type="button" className="top-action" onClick={() => { void signOut().then(() => navigate('/')); }} aria-label={t('auth.logout')} title={t('auth.logout')} data-testid="button-sidebar-logout"><LogOut size={14} /></button></div>
        ) : (
          <div className="source-mini"><span className="source-dot" /><span>{t('Source mode')}</span><strong>{health.isError ? t('OFFLINE') : t('DEMO DATA')}</strong></div>
        )}
        <div className="language-control"><label htmlFor="sidebar-language">{t('Язык')}</label><LanguageSelect id="sidebar-language" testIdValue="select-language" /></div>
        <div className="version">Reflect v0.14.0</div>
      </div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <button className="top-action menu-toggle" onClick={() => setMenuOpen((open) => !open)} data-testid="button-open-navigation" aria-label={t('Открыть навигацию')} aria-expanded={menuOpen} aria-controls="mobile-menu"><Menu size={18} /></button>
          <span className="crumb">{workspace?.name ?? t('Workspace')} <span className="crumb-sep">/</span> <strong>{currentName}</strong></span>
        </div>
        <div className="topbar-right">
          <span className="clock">{locale === 'ru' ? 'АЛМАТЫ' : t('ALMATY')} · {clock}</span>
          <LanguageSelect className="top-language-select shell-mobile-language" testIdValue="select-language-mobile" />
          <button className="top-action" onClick={() => void queryClient.invalidateQueries()} data-testid="button-refresh-workspace" aria-label={t('Обновить данные')} title={t('Обновить данные')}><RefreshCw size={15} /></button>
        </div>
      </header>
      {menuOpen && <div className="mobile-menu-backdrop" onClick={() => setMenuOpen(false)} />}
      {menuOpen && <nav className="mobile-menu" id="mobile-menu" aria-label={t('Открыть навигацию')}>
        <button className="top-action mobile-menu-close" onClick={() => setMenuOpen(false)} aria-label={t('Закрыть меню')}><X size={17} /></button>
        {signedIn && <WorkspaceSwitcher />}
        {[...nav, ...systemItems].map(({ href, label, icon: Icon }) => <Link href={href} className={`nav-item ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} key={href} data-testid={`mobile-link-${testId(label)}`}><Icon /><span>{t(label)}</span></Link>)}
      </nav>}
      {workspace?.role === 'VIEWER' && <div className="viewer-banner" role="note" data-testid="viewer-banner">{t('workspace.viewer.banner')}</div>}
      {demo && <div className="demo-banner" role="note" data-testid="demo-banner"><span>{t('demo.banner')}</span><div><Link href="/register" className="btn">{t('demo.banner.cta')}</Link><button type="button" className="btn secondary" onClick={() => { leaveDemo(); navigate('/'); }}>{t('demo.exit')}</button></div></div>}
      <div id="main-content">{children}</div>
    </section>
    <nav className="mobile-bar" aria-label={t('Открыть навигацию')}>
      {nav.slice(0, 4).map(({ href, label, icon: Icon }) => <Link href={href} className={`mobile-nav ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} key={href} data-testid={`mobile-nav-${testId(label)}`}><Icon /><span>{t(label)}</span></Link>)}
      <button type="button" className={`mobile-nav ${menuOpen || !nav.slice(0, 4).some((item) => isActive(item.href)) ? 'active' : ''}`} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="mobile-menu" data-testid="mobile-nav-more"><Menu /><span>{t('Ещё')}</span></button>
    </nav>
  </div>;
}
