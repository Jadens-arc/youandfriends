import { DevicesManager } from '@/components/settings/devices-manager';

export const metadata = { title: 'Devices · Settings · You & Friends' };

/** Mac sync devices: pair, see, disconnect (task `110`). */
export default function DevicesPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Devices</h1>
        <p className="text-body text-muted-foreground mt-1 font-sans">
          A paired Mac can add snapshots to the Project Files you choose, and nothing else. It can’t
          read your songs, lyrics, or comments, and it can’t delete anything.
        </p>
      </header>
      <DevicesManager />
    </div>
  );
}
