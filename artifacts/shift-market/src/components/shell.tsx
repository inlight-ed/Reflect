import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BellDot, ClipboardList, Database, Eye, FileText, LayoutDashboard, LogOut, Megaphone, Menu, MessageSquareText, Package, Radio, RefreshCw, Settings2, Users, X, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useGetAttention, useHealthCheck } from '@workspace/api-client-react';
import { fill, localeOptions, useI18n, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button, IconButton } from '@/components/ui';
import { WorkspaceSwitcher } from '@/components/workspace';

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Work sections, in the order they have always had. */
export const nav: NavItem[] = [
  { href: '/overview', label: 'Обзор', icon: LayoutDashboard },
  { href: '/attention', label: 'nav.attention', icon: BellDot },
  { href: '/advertising', label: 'Реклама', icon: Megaphone },
  { href: '/products', label: 'Товары', icon: Package },
  { href: '/media-plans', label: 'nav.media', icon: ClipboardList },
  { href: '/external-media', label: 'Внешние медиа', icon: Radio },
  { href: '/competitors', label: 'Конкуренты', icon: Users },
  { href: '/content', label: 'Контент', icon: FileText },
  { href: '/assistant', label: 'Спросить Reflect', icon: MessageSquareText },
];

const settingsItem: NavItem = { href: '/settings', label: 'Настройки', icon: Settings2 };
const dataItem: NavItem = { href: '/data', label: 'nav.data', icon: Database };
/** The first four sections sit in the phone's bottom bar; everything is in the menu. */
const bottomItems = nav.slice(0, 4);

const pageNames: Record<string, string> = Object.fromEntries([...nav, settingsItem, dataItem].map((item) => [item.href, item.label]));

// Test ids are derived from the Russian label, as before (link-nav-обзор, mobile-nav-реклама…).
const testId = (label: string) => label.toLowerCase().replace(/\s/g, '-');
const systemTestId = (href: string) => (href === '/settings' ? 'link-nav-settings' : 'link-nav-data');

function LanguageSelect({ id, className, testIdValue }: { id?: string; className?: string; testIdValue: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <select id={id} className={className} aria-label={id ? undefined : t('Язык интерфейса')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)} data-testid={testIdValue}>
      {localeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  );
}

/** Count of serious items on "Needs attention", with a spoken name ("6 urgent"), not just a number. */
function UrgentBadge({ count, testIdValue }: { count: number; testIdValue?: string }) {
  const { t } = useI18n();
  if (count <= 0) return null;
  const label = fill(t('nav.urgent'), { count });
  return <span className="rf-nav-badge" data-testid={testIdValue} aria-label={label} title={label}>{count}</span>;
}

type NavListProps = { items: NavItem[]; isActive: (href: string) => boolean; urgent: number; variant: 'sidebar' | 'drawer'; testIdFor: (item: NavItem) => string };

function NavList({ items, isActive, urgent, variant, testIdFor }: NavListProps) {
  const { t } = useI18n();
  return (
    <ul className="rf-nav-list">
      {items.map((item) => {
        const { href, label, icon: Icon } = item;
        const active = isActive(href);
        const name = t(label);
        return (
          <li key={href}>
            <Link href={href} className={`rf-nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} title={variant === 'sidebar' ? name : undefined} data-testid={testIdFor(item)}>
              <Icon aria-hidden />
              <span className="rf-nav-label">{name}</span>
              {href === '/attention' && <UrgentBadge count={urgent} testIdValue={variant === 'sidebar' ? 'attention-badge' : undefined} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Focus stays inside an open dialog-like panel: Tab from the last control wraps to the first and back.
 * The panel gets focus when it opens; the opener gets it back when it closes.
 */
function useFocusTrap(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => element.offsetParent !== null);
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      // Back to the button that opened the menu, unless navigation already moved focus elsewhere on purpose.
      if (opener.current && document.contains(opener.current)) opener.current.focus({ preventScroll: true });
    };
  }, [open, panel, onClose]);
}

export function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const health = useHealthCheck();
  const queryClient = useQueryClient();
  const fetching = useIsFetching() > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const { signedIn, demo, session, signOut, leaveDemo, workspace } = useSession();
  const systemItems = signedIn ? [dataItem, settingsItem] : [settingsItem];
  // Serious items for the badge on "Needs attention"; refreshed with the rest of the app.
  const attention = useGetAttention(undefined, { query: { staleTime: 60_000 } as never });
  const urgent = attention.data?.high ?? 0;
  const currentName = t(pageNames[location] || (location.startsWith('/media-plans/') ? 'nav.media' : 'Обзор'));
  const workspaceName = workspace?.name ?? (demo ? t('nav.demoWorkspace') : t('Workspace'));
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => { document.title = `Reflect — ${currentName}`; }, [currentName]);
  useEffect(() => { setMenuOpen(false); }, [location]);
  useFocusTrap(menuOpen, drawer, closeMenu);

  const isActive = (href: string) => location === href || (href === '/media-plans' && location.startsWith('/media-plans/'));
  const moreActive = menuOpen || !bottomItems.some((item) => isActive(item.href));

  const account = signedIn ? (
    <div className="rf-account" data-testid="account-mini">
      <span className="rf-account-name" title={session?.user?.email}>{session?.user?.name || session?.user?.email}</span>
      <IconButton label={t('auth.logout')} icon={<LogOut />} size="sm" onClick={() => { void signOut().then(() => navigate('/')); }} data-testid="button-sidebar-logout" />
    </div>
  ) : (
    <div className={`rf-source-mini${health.isError ? ' rf-source-mini--offline' : ''}`}><span className="rf-source-dot" aria-hidden /><span>{t('Source mode')}</span><strong>{health.isError ? t('OFFLINE') : t('DEMO DATA')}</strong></div>
  );

  return <div className="rf-shell">
    <a className="rf-skip-link" href="#main-content">{t('nav.skip')}</a>

    <aside className="rf-sidebar">
      <Link href="/overview" className="rf-brand" data-testid="link-brand" aria-label="Reflect">
        <span className="rf-brand-mark" aria-hidden><ArrowUpRight size={15} /></span><span className="rf-brand-name">Reflect</span>
      </Link>
      {signedIn && <div className="rf-sidebar-workspace"><WorkspaceSwitcher /></div>}
      <nav className="rf-nav-group" aria-labelledby="nav-group-work">
        <span className="rf-nav-heading" id="nav-group-work">{t('nav.group.work')}</span>
        <NavList items={nav} isActive={isActive} urgent={urgent} variant="sidebar" testIdFor={(item) => `link-nav-${testId(item.label)}`} />
      </nav>
      <nav className="rf-nav-group" aria-labelledby="nav-group-manage">
        <span className="rf-nav-heading" id="nav-group-manage">{t('nav.group.manage')}</span>
        <NavList items={systemItems} isActive={isActive} urgent={0} variant="sidebar" testIdFor={(item) => systemTestId(item.href)} />
      </nav>
      <div className="rf-sidebar-foot">
        {account}
        <div className="rf-language"><label htmlFor="sidebar-language">{t('Язык')}</label><LanguageSelect id="sidebar-language" className="rf-language-select" testIdValue="select-language" /></div>
        <div className="rf-version">Reflect v0.14.0</div>
      </div>
    </aside>

    <section className="rf-workspace">
      <header className="rf-topbar">
        <IconButton className="rf-menu-toggle" label={t('Открыть навигацию')} icon={<Menu />} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="mobile-menu" data-testid="button-open-navigation" />
        <div className="rf-crumb">
          <span className="rf-crumb-workspace" title={workspaceName}>{workspaceName}</span>
          <span className="rf-crumb-sep" aria-hidden>/</span>
          <span className="rf-crumb-page" aria-current="page">{currentName}</span>
        </div>
        <div className="rf-topbar-actions">
          <LanguageSelect className="rf-language-select rf-topbar-language" testIdValue="select-language-mobile" />
          {/* While anything is loading, a second press would only queue the same requests again. */}
          <IconButton label={t('Обновить данные')} icon={<RefreshCw className={fetching ? 'rf-refreshing-icon' : undefined} />} pending={false} aria-busy={fetching || undefined} aria-disabled={fetching || undefined} onClick={() => { if (!fetching) void queryClient.invalidateQueries(); }} data-testid="button-refresh-workspace" />
        </div>
      </header>

      {workspace?.role === 'VIEWER' && (
        <div className="rf-banner rf-banner--viewer" role="note" data-testid="viewer-banner">
          <Eye className="rf-banner-icon" aria-hidden /><span>{t('workspace.viewer.banner')}</span>
        </div>
      )}
      {demo && (
        <div className="rf-banner rf-banner--demo" role="note" data-testid="demo-banner">
          <span className="rf-banner-text">{t('demo.banner')}</span>
          <div className="rf-banner-actions">
            <Link href="/register" className="rf-button rf-button--primary rf-button--sm">{t('demo.banner.cta')}</Link>
            <Button variant="secondary" size="sm" onClick={() => { leaveDemo(); navigate('/'); }}>{t('demo.exit')}</Button>
          </div>
        </div>
      )}
      <div id="main-content" tabIndex={-1}>{children}</div>
    </section>

    {menuOpen && <div className="rf-drawer-backdrop" onClick={closeMenu} data-testid="menu-backdrop" />}
    {menuOpen && (
      <div className="rf-drawer" id="mobile-menu" ref={drawer} role="dialog" aria-modal="true" aria-label={t('nav.main')}>
        <div className="rf-drawer-head">
          <span className="rf-brand-name">Reflect</span>
          <IconButton label={t('Закрыть меню')} icon={<X />} onClick={closeMenu} className="rf-drawer-close" />
        </div>
        {signedIn && <WorkspaceSwitcher />}
        <nav className="rf-nav-group" aria-labelledby="drawer-group-work">
          <span className="rf-nav-heading" id="drawer-group-work">{t('nav.group.work')}</span>
          <NavList items={nav} isActive={isActive} urgent={urgent} variant="drawer" testIdFor={(item) => `mobile-link-${testId(item.label)}`} />
        </nav>
        <nav className="rf-nav-group" aria-labelledby="drawer-group-manage">
          <span className="rf-nav-heading" id="drawer-group-manage">{t('nav.group.manage')}</span>
          <NavList items={systemItems} isActive={isActive} urgent={0} variant="drawer" testIdFor={(item) => `mobile-link-${testId(item.label)}`} />
        </nav>
        <div className="rf-drawer-foot">{account}</div>
      </div>
    )}

    <nav className="rf-bottom-nav" aria-label={t('nav.bottom')}>
      {bottomItems.map(({ href, label, icon: Icon }) => (
        <Link href={href} className={`rf-bottom-item ${isActive(href) ? 'active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} key={href} data-testid={`mobile-nav-${testId(label)}`}>
          <span className="rf-bottom-icon"><Icon aria-hidden />{href === '/attention' && <UrgentBadge count={urgent} />}</span>
          <span className="rf-bottom-label">{t(label)}</span>
        </Link>
      ))}
      <button type="button" className={`rf-bottom-item ${moreActive ? 'active' : ''}`} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="mobile-menu" data-testid="mobile-nav-more">
        <span className="rf-bottom-icon"><Menu aria-hidden /></span><span className="rf-bottom-label">{t('Ещё')}</span>
      </button>
    </nav>
  </div>;
}
