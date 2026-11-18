import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Redirect, Route, Switch, Router as WouterRouter } from 'wouter';
import type { ReactNode } from 'react';
import { ErrorBoundary, type ErrorFallbackProps } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoadingState, SourcePill } from '@/components/common';
import { Shell } from '@/components/shell';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { PeriodProvider } from '@/lib/period';
import { SessionProvider, useSession } from '@/lib/session';
import { nextPath } from '@/lib/next-path';
import NotFound from '@/pages/not-found';
import OverviewPage from '@/pages/overview';

// The overview is the landing page; everything else loads when first opened.
const AdvertisingPage = lazy(() => import('@/pages/advertising'));
const ProductsPage = lazy(() => import('@/pages/products'));
const AttentionPage = lazy(() => import('@/pages/attention'));
const MediaPlansPage = lazy(() => import('@/pages/media-plans'));
const ExternalMediaPage = lazy(() => import('@/pages/external-media'));
const CompetitorsPage = lazy(() => import('@/pages/competitors'));
const ContentPage = lazy(() => import('@/pages/content'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const AssistantPage = lazy(() => import('@/pages/assistant'));
const DataPage = lazy(() => import('@/pages/data'));
const LandingPage = lazy(() => import('@/pages/landing'));
const InvitePage = lazy(() => import('@/pages/invite'));
const AuthPage = lazy(() => import('@/pages/auth'));
const ForgotPasswordPage = lazy(() => import('@/pages/password-reset').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/password-reset').then((module) => ({ default: module.ResetPasswordPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

function LocalizedErrorFallback({ resetError }: ErrorFallbackProps) {
  const { t } = useI18n();
  return (
    <div className="page" data-testid="status-error">
      <div className="page-meta" style={{ marginBottom: 18 }}><SourcePill /></div>
      <div className="error-box" role="alert">
        <AlertTriangle size={22} />
        <h3>{t('Сигнал недоступен')}</h3>
        <p>{t('Произошла непредвиденная ошибка. Повторите попытку.')}</p>
        <button className="btn secondary" onClick={resetError} data-testid="button-retry">
          <RefreshCw size={14} /> {t('Повторить')}
        </button>
      </div>
    </div>
  );
}

function Splash() {
  return <div className="splash" aria-busy="true"><span className="brand-mark pulse" /></div>;
}

/** App pages need a session or an explicit demo; everyone else starts on the landing page. */
function Gate({ children }: { children: ReactNode }) {
  const { loading, signedIn, demo } = useSession();
  if (loading) return <Splash />;
  if (!signedIn && !demo) return <Redirect to="/" />;
  return <>{children}</>;
}

function AppRoutes() {
  return <Shell><ErrorBoundary FallbackComponent={LocalizedErrorFallback}><Suspense fallback={<LoadingState />}><Switch>
    <Route path="/overview" component={OverviewPage} />
    <Route path="/advertising" component={AdvertisingPage} />
    <Route path="/products" component={ProductsPage} />
    <Route path="/attention" component={AttentionPage} />
    <Route path="/media-plans" component={MediaPlansPage} />
    <Route path="/media-plans/:planId" component={MediaPlansPage} />
    <Route path="/external-media" component={ExternalMediaPage} />
    <Route path="/competitors" component={CompetitorsPage} />
    <Route path="/content" component={ContentPage} />
    <Route path="/assistant" component={AssistantPage} />
    <Route path="/data" component={DataPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></Suspense></ErrorBoundary></Shell>;
}

function Router() {
  const { loading, signedIn, demo } = useSession();
  return <Suspense fallback={<Splash />}><Switch>
    <Route path="/">{loading ? <Splash /> : signedIn || demo ? <Redirect to="/overview" /> : <LandingPage />}</Route>
    <Route path="/invite/:token"><InvitePage /></Route>
    <Route path="/login">{signedIn ? <Redirect to={nextPath()} /> : <AuthPage mode="login" />}</Route>
    <Route path="/forgot-password">{signedIn ? <Redirect to="/overview" /> : <ForgotPasswordPage />}</Route>
    <Route path="/reset-password"><ResetPasswordPage /></Route>
    <Route path="/register">{signedIn ? <Redirect to={nextPath()} /> : <AuthPage mode="register" />}</Route>
    <Route><Gate><AppRoutes /></Gate></Route>
  </Switch></Suspense>;
}

function App() {
  return <QueryClientProvider client={queryClient}><I18nProvider><SessionProvider><PeriodProvider><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></PeriodProvider></SessionProvider></I18nProvider></QueryClientProvider>;
}

export default App;
