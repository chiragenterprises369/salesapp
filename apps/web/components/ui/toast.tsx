'use client';

import { Toaster as Sonner, toast } from 'sonner';
import { useDocumentTheme } from '@/lib/use-document-theme';

/**
 * Toasts (sonner) styled with tokens. Mount <Toaster /> once in the root layout.
 * Use `toast.success('Lead assigned to Priya')`, `toast.error(...)`, `toast(msg, { action })`.
 * Copy: name the outcome ("Lead moved to Quote sent"), never apologise.
 */
export function Toaster() {
  const theme = useDocumentTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      gap={8}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: 'group !rounded-lg !border !border-border !bg-surface !text-fg !shadow-overlay !text-sm !font-sans',
          title: '!font-medium',
          description: '!text-muted !text-xs',
          actionButton: '!bg-accent !text-accent-fg !rounded-md !text-xs !font-medium',
          cancelButton: '!bg-surface-3 !text-fg !rounded-md !text-xs',
          closeButton: '!bg-surface !border-border !text-muted',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-danger-text',
          warning: '[&_[data-icon]]:!text-warning',
          info: '[&_[data-icon]]:!text-accent-text',
        },
      }}
    />
  );
}

export { toast };
