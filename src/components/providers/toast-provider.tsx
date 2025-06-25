'use client';

import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      duration={4000}
      theme="dark"
      className="toaster group"
      toastOptions={{
        style: {
          background: 'hsl(240 10% 3.9%)',
          border: '1px solid hsl(240 3.7% 15.9%)',
          color: 'hsl(0 0% 98%)',
        },
        className: 'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
        descriptionClassName: 'group-[.toast]:text-muted-foreground',
      }}
    />
  );
}