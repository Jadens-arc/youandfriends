import { parseServerEnv } from '@youandfriends/config';
import { AppError } from '@youandfriends/contracts';
import { notFound } from 'next/navigation';

import { SharedWithMe } from '@/components/library/modules/shared-with-me';
import { libraryContext } from '@/lib/library/context';
import { readProjectLibrary } from '@/lib/library/projects';
import { currentWorkspace } from '@/lib/workspace/current';

export const metadata = { title: 'Shared · You & Friends' };

/**
 * Shared (tasks `041`/`044`): what someone explicitly opened up to this person — a grant, not
 * just membership — through the same filtered reads as the library's module.
 */
export default async function SharedPage() {
  const context = await currentWorkspace();
  if (context === null) notFound();
  const library = await readProjectLibrary(libraryContext(context), {
    folderId: null,
    quotaBytes: parseServerEnv().YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES,
  }).catch((error: unknown) => {
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-title text-foreground font-serif">Shared</h1>
      <SharedWithMe shared={library.modules.sharedWithMe} />
    </div>
  );
}
