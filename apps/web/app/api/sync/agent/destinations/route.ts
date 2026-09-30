import { handleJson, json } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { requireSyncAgent } from '@/lib/sync/agent';
import { agentDestinations } from '@/lib/sync/destinations';

/**
 * `GET /api/sync/agent/destinations` (task `110`): where this device may upload, right now — the
 * projects it was paired with that its pairer can still edit. The agent's "who am I".
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const context = libraryContext(await requireSyncAgent(request, correlationId));
    return json({ destinations: await agentDestinations(context) });
  });
}
