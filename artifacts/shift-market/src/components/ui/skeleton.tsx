import { cn } from '@/lib/utils';

/*
 * Placeholders while data loads. They are decorative (aria-hidden): the region that is loading
 * should carry aria-busy="true" (as LoadingState already does), so the state is announced once.
 */

/** A few lines of text; the last one is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cn('rf-skeleton-text', className)} aria-hidden>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <span key={index} className="rf-skeleton rf-skeleton--line" />)}
    </span>
  );
}

/** A card-sized block, e.g. for a chart or a list. Height can be set to match the real content. */
export function SkeletonCard({ height, className }: { height?: number; className?: string }) {
  return <span className={cn('rf-skeleton rf-skeleton--card', className)} style={height ? { height } : undefined} aria-hidden />;
}

/** The shape of a metric card: label, value, change. */
export function SkeletonMetric({ className }: { className?: string }) {
  return (
    <span className={cn('rf-skeleton-metric', className)} aria-hidden>
      <span className="rf-skeleton" />
      <span className="rf-skeleton" />
      <span className="rf-skeleton" />
    </span>
  );
}
