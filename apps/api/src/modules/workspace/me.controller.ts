import { Body, Controller, Logger } from '@nestjs/common';
import {
  API_ROUTES,
  ProfileUpdateSchema,
  UserSettingsUpdateSchema,
  type UserSettings,
  type UserSettingsUpdate,
} from '@vistar/shared';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { SettingsService } from './settings.service.js';
import { requireUserId, UsersService } from './users.service.js';
import { actorOf } from './util.js';

/** Self-service: my settings and profile (every signed-in user). PUT /me/status is the presence engine's (realtime stream). */
@Controller()
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly events: EventBus,
  ) {}

  @ApiRoute(API_ROUTES.mySettingsGet)
  getSettings(@CurrentAuth() auth: AuthContext): Promise<UserSettings> {
    return this.settings.getUserSettings(auth.workspaceId, requireUserId(auth));
  }

  @ApiRoute(API_ROUTES.mySettingsUpdate)
  async updateSettings(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(UserSettingsUpdateSchema)) body: UserSettingsUpdate): Promise<UserSettings> {
    const userId = requireUserId(auth);
    const { settings, changed } = await this.settings.updateUserSettings(auth.workspaceId, userId, body);
    if (changed.includes('theme')) {
      try {
        // Targets the user's room so their other tabs and devices switch theme.
        await this.events.publish('theme.changed', auth.workspaceId, { scope: 'user', userId, mode: settings.theme.mode }, { actor: actorOf(auth), userId });
      } catch (err) {
        this.logger.error(`theme.changed publish failed: ${(err as Error).message}`);
      }
    }
    return settings;
  }

  @ApiRoute(API_ROUTES.myProfileUpdate)
  updateProfile(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ProfileUpdateSchema)) body: z.output<typeof ProfileUpdateSchema>) {
    return this.users.updateProfile(auth, body);
  }
}
