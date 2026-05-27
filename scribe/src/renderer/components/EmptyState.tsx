import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Reusable empty-state (ROADMAP_V04_07): a centered icon + title + optional hint and
// up to two CTAs. `compact` tightens it for the narrow sidebar.
type Cta = { label: string; onClick: () => void };

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: Cta;
  secondaryAction?: Cta;
  compact?: boolean;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex h-full flex-col items-center justify-center text-center ${
        compact ? 'gap-2 px-4 py-8' : 'gap-3 p-8'
      }`}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-muted text-muted-foreground ${
          compact ? 'size-9' : 'size-12'
        }`}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} />
      </div>
      <div className="space-y-1">
        <p className={`font-medium text-foreground ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
        {description && (
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button size="sm" variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
