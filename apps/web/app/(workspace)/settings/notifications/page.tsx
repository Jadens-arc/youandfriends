import { NotificationPreferencesForm } from '@/components/settings/notification-preferences';

export const metadata = { title: 'Notifications · Settings · You & Friends' };

/** What each person hears about, and how (task `096`). */
export default function NotificationSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Notifications</h1>
        <p className="text-body text-muted-foreground mt-1 font-sans">
          Choose what you hear about, and where. These are yours, in every workspace.
        </p>
      </header>
      <NotificationPreferencesForm />
    </div>
  );
}
