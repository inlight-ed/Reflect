import { AlertCircle, LayoutDashboard } from 'lucide-react';
import { Link } from 'wouter';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="page">
      <div className="error-box" role="alert">
        <AlertCircle size={22} />
        <h3>{t('Страница не найдена')}</h3>
        <p>{t('Проверьте адрес или вернитесь к нужному разделу.')}</p>
        <Link href="/overview" className="btn secondary"><LayoutDashboard size={14} /> {t('Обзор')}</Link>
      </div>
    </main>
  );
}
