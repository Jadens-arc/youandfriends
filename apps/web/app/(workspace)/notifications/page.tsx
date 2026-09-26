import { NotificationList } from '@/components/notifications/notification-list';

export const metadata = { title: 'Notifications · You & Friends' };

/** The notification center (task `095`). */
export default function NotificationsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Notifications</h1>
      </header>
      <NotificationList />
    </div>
  );
}
