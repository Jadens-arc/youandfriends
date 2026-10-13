import { NotificationPreferences } from '@/components/settings/notification-preferences';

export const metadata = { title: 'Notifications · Settings · You & Friends' };

/** Choosing what to hear about, and how (task `096`). */
export default function NotificationSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Notifications</h1>
        <p className="text-body text-muted-foreground mt-1 font-sans">
          What you hear about in this workspace, and how.
        </p>
      </header>
      <NotificationPreferences />
    </div>
  );
}
