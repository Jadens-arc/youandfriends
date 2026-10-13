import { NotificationList } from '@/components/notifications/notification-list';

export const metadata = { title: 'Notifications · You & Friends' };

/**
 * The notification center (task `095`). The list is fetched on the client, so marking read and
 * the shell's unread count stay in step without a full reload.
 */
export default function NotificationsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <h1 className="text-title text-foreground hidden font-serif md:block">Notifications</h1>
      <NotificationList />
    </div>
  );
}
