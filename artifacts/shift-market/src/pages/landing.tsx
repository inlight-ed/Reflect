import { ArrowUpRight, BadgeCheck, FileSpreadsheet, LineChart, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { fill, localeOptions, useI18n, type Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Looping, decorative hero animation: a growing revenue line, a forecast band and pulsing signals. */
function HeroAnimation() {
  const { t } = useI18n();
  return (
    <div className="hero-visual" aria-hidden>
      <div className="orbit orbit-1" />
      <div className="orbit orbit-2" />
      <svg viewBox="0 0 520 340" className="hero-chart">
        <defs>
          <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e7b24f" stopOpacity="0.35" /><stop offset="100%" stopColor="#e7b24f" stopOpacity="0" /></linearGradient>
          <linearGradient id="hero-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#b9d94b" /><stop offset="100%" stopColor="#e7b24f" /></linearGradient>
        </defs>
        {[60, 120, 180, 240].map((y) => <line key={y} x1="20" x2="500" y1={y} y2={y} className="hero-grid" />)}
        <path className="hero-previous" d="M20 250 C 80 240, 120 236, 170 228 S 260 214, 300 206 S 400 196, 500 182" />
        <path className="hero-area" d="M20 262 C 70 250, 110 238, 160 214 S 240 188, 290 166 S 380 120, 430 104 S 480 84, 500 76 L 500 300 L 20 300 Z" fill="url(#hero-area)" />
        <path className="hero-line" d="M20 262 C 70 250, 110 238, 160 214 S 240 188, 290 166 S 380 120, 430 104 S 480 84, 500 76" stroke="url(#hero-line)" />
        <circle className="hero-pulse p1" cx="160" cy="214" r="6" />
        <circle className="hero-pulse p2" cx="290" cy="166" r="6" />
        <circle className="hero-pulse p3" cx="430" cy="104" r="6" />
      </svg>
      <div className="float-card fc-1"><span className="fc-tag restock">{t('ДОЗАКАЗАТЬ')}</span><strong>{fill(t('forecast.days'), { days: 9 })}</strong><em>{fill(t('forecast.reorder'), { qty: 426 })}</em></div>
      <div className="float-card fc-2"><span className="fc-tag scale">{t('МАСШТАБИРОВАТЬ')}</span><strong>+33%</strong><em>{t('products.col.margin')} 52%</em></div>
      <div className="float-card fc-3"><span className="fc-tag ads">ROAS</span><strong>3.2x</strong><em>{t('ads.col.breakeven')} 4.1x</em></div>
    </div>
  );
}

export default function LandingPage() {
  const { locale, setLocale, t } = useI18n();
  const { enterDemo } = useSession();
  const [, navigate] = useLocation();
  const features = [
    { icon: FileSpreadsheet, title: 'landing.f1.title', body: 'landing.f1.body' },
    { icon: LineChart, title: 'landing.f2.title', body: 'landing.f2.body' },
    { icon: BadgeCheck, title: 'landing.f3.title', body: 'landing.f3.body' },
  ];
  return (
    <div className="landing">
      <header className="landing-top">
        <span className="brand"><span className="brand-mark"><ArrowUpRight size={15} /></span><span className="brand-name">Reflect</span></span>
        <div className="landing-top-actions">
          <select className="top-language-select" aria-label={t('Язык интерфейса')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)} data-testid="select-language">
            {localeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
          <Link href="/login" className="btn secondary" data-testid="link-login">{t('landing.cta.login')}</Link>
        </div>
      </header>
      <main className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow">{t('landing.eyebrow')}</div>
          <h1>{t('landing.title')}</h1>
          <p>{t('landing.subtitle')}</p>
          <div className="hero-actions">
            <Link href="/register" className="btn hero-primary" data-testid="link-register">{t('landing.cta.start')}</Link>
            <button type="button" className="btn secondary" onClick={() => { enterDemo(); navigate('/overview'); }} data-testid="button-demo">{t('landing.cta.demo')}</button>
          </div>
          <p className="hero-steps">{t('landing.steps')}</p>
        </div>
        <HeroAnimation />
      </main>
      <section className="landing-features">
        {features.map(({ icon: Icon, title, body }) => (
          <article key={title} className="feature">
            <span className="feature-icon"><Icon size={18} /></span>
            <h2>{t(title)}</h2>
            <p>{t(body)}</p>
          </article>
        ))}
      </section>
      <footer className="landing-footer"><ShieldCheck size={14} aria-hidden /> {t('landing.footer')}</footer>
    </div>
  );
}
