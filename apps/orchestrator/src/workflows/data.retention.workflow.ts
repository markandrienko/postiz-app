import {
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';

const { refreshChannelsData, clearExpiredChannelData } =
  proxyActivities<IntegrationsActivity>({
    startToCloseTimeout: '10 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

// Data retention for platforms whose API terms limit how long stored data may
// go without a refresh (periodicDataRefresh, e.g. YouTube: 30 days). Once a
// day: refreshes each channel's token, name and picture and clears the ids of
// published posts the platform no longer has (a page of channels per
// activity), then clears the platform data of deleted channels and of
// channels that stayed disconnected for 21 days.
export async function dataRetentionWorkflow() {
  let loops = 0;
  while (true) {
    // a failed step never ends the daily loop: it runs again tomorrow
    let cursor: string | null = null;
    do {
      try {
        cursor = await refreshChannelsData(cursor);
      } catch (err) {
        if (isCancellation(err)) {
          throw err;
        }
        cursor = null;
      }
    } while (cursor);

    try {
      await clearExpiredChannelData();
    } catch (err) {
      if (isCancellation(err)) {
        throw err;
      }
    }

    await sleep('1 day');

    // Keep the history small, the new run starts with the next daily pass
    if (++loops >= 7 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof dataRetentionWorkflow>();
    }
  }
}
