'use client';

import { cn, focusRing, transition } from '@youandfriends/ui';
import { Bell } from 'lucide-react';
import Link from 'next/link';

import { useUnreadCount } from '@/lib/notifications/client';

/**
 * The shell's way to notifications (task `095`), with the unread count. The count is in the
 * link's name, not only in the badge: a dot is not a number to a screen reader.
 */
export function NotificationBell({ className }: { readonly className?: string }) {
  const unread = useUnreadCount();
  const label =
    unread === null || unread === 0
      ? 'Notifications'
      : `Notifications, ${unread > 99 ? 'more than 99' : unread} unread`;
  return (
    <Link
      href="/notifications"
      aria-label={label}
      className={cn(
        'text-foreground relative flex min-h-11 min-w-11 items-center justify-center rounded-sm md:min-h-9 md:min-w-9',
        transition,
        focusRing,
        className,
      )}
    >
      <Bell className="size-5" aria-hidden />
      {unread === null || unread === 0 ? null : (
        <span
          aria-hidden
          data-unread={unread}
          className="bg-primary text-primary-foreground tabular absolute top-1 right-1 min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
