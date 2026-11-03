import { Controller, Headers } from '@nestjs/common';
import { API_ROUTES } from '@vistar/shared';
import { ApiRoute } from '../../../common/http/api-route.decorator.js';
import { GoogleCalendarSyncService } from './google-calendar-sync.service.js';

/**
 * POST /api/hooks/google-calendar (change #20, contract 20b): Google push notifications of watch channels. The
 * channel token is the per-workspace HMAC set by the sync service; unknown channels are ignored quietly and the
 * answer is always a fast 200 (Google retries otherwise). The 5-minute poll keeps working without pushes.
 */
@Controller()
export class GoogleCalendarHookController {
  constructor(private readonly sync: GoogleCalendarSyncService) {}

  @ApiRoute(API_ROUTES.googleCalendarWebhook)
  async receive(
    @Headers('x-goog-channel-id') channelId: string | undefined,
    @Headers('x-goog-channel-token') token: string | undefined,
    @Headers('x-goog-resource-state') resourceState: string | undefined,
  ): Promise<null> {
    await this.sync.receive({ channelId: channelId?.slice(0, 200), token: token?.slice(0, 300), resourceState: resourceState?.slice(0, 40) });
    return null;
  }
}
