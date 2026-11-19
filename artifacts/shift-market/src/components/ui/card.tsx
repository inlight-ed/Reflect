import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CardProps = Omit<HTMLAttributes<HTMLElement>, 'className'> & {
  /**
   * Required on purpose, so density is always chosen explicitly:
   * "none" for a table or a list edge to edge (like .card today), "default" for content (like .card.card-pad).
   */
  padding: 'none' | 'default';
  /** section/article when the card is a self-contained region with its own heading. */
  as?: 'div' | 'section' | 'article';
  className?: string;
  children: ReactNode;
};

/** The base surface for grouped content. */
export function Card({ padding, as: Element = 'div', className, children, ...rest }: CardProps) {
  return <Element {...rest} className={cn('rf-card', padding === 'default' && 'rf-card--pad', className)}>{children}</Element>;
}
