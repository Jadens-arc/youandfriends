'use client';

import { cn, focusRing, transition } from '@youandfriends/ui';
import { Bell } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useUnreadCount } from './unread';

/**
 * The shell's way to the notification center (task `095`), with the unread count. The count is
 * a number in a badge and in the link's name — never a dot whose meaning is only its color.
 */
export function NotificationBell({ className }: { readonly className?: string }) {
  const unread = useUnreadCount();
  const pathname = usePathname();
  const active = pathname === '/notifications';
  const shown = unread === null || unread === 0 ? null : unread > 99 ? '99+' : String(unread);
  return (
    <Link
      href={'/notifications' as Route}
      aria-current={active ? 'page' : undefined}
      aria-label={shown === null ? 'Notifications' : `Notifications, ${unread} unread`}
      className={cn(
        'text-foreground relative flex min-h-11 min-w-11 items-center justify-center rounded-sm',
        transition,
        focusRing,
        className,
      )}
    >
      <Bell className="size-5" aria-hidden />
      {shown === null ? null : (
        <span
          aria-hidden
          className="bg-primary text-primary-foreground tabular absolute top-1 right-0.5 min-w-4 rounded-full px-1 text-center text-[0.625rem] leading-4 font-medium"
        >
          {shown}
        </span>
      )}
    </Link>
  );
}
