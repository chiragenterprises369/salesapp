import { Global, Module } from '@nestjs/common';
import { AndroidReleasesService } from './android-releases.service.js';
import { DevicesService } from './devices.service.js';
import { FirebaseConfigService } from './firebase-config.service.js';
import { AppController, DevicesController, SuperConfigController } from './platform-config.controller.js';
import { PushService } from './push.service.js';

/**
 * OWNER: backend-core (PLATFORM stream, change #19). Super Admin config section (Firebase files, APK releases),
 * public app bootstrap (/app/config, latest APK), devices and the FCM push sender.
 * Global: PushService.sendToUser() is used by notifications and, in the realtime stream, by presence/calls.
 */
@Global()
@Module({
  controllers: [SuperConfigController, AppController, DevicesController],
  providers: [FirebaseConfigService, AndroidReleasesService, DevicesService, PushService],
  exports: [PushService, FirebaseConfigService],
})
export class PlatformConfigModule {}
