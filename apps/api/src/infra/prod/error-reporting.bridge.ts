import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PlatformConfigService } from '../../modules/config-registry/platform-config.service.js';
import { monitoringConfig } from '../../modules/config-registry/snapshot.js';
import { invalidateErrorReportingConfig, setErrorReportingSource } from './error-reporter.js';

/**
 * Error monitoring settings from Super Admin > Config > Error monitoring (change #20, contracts-20 section 11):
 * the registry's API DSN, environment and error sample rate (the registry already applies its env fallback
 * SENTRY_DSN / SENTRY_ENVIRONMENT). No DSN = monitoring off. A change in the panel drops the cached settings.
 */
@Injectable()
export class ErrorReportingBridge implements OnModuleInit {
  constructor(private readonly config: PlatformConfigService) {}

  onModuleInit(): void {
    setErrorReportingSource(async () => {
      const m = monitoringConfig();
      return m.apiDsn ? { dsn: m.apiDsn, environment: m.environment, sampleRate: m.errorSampleRate } : null;
    });
    this.config.onChange((group) => {
      if (group === 'monitoring') invalidateErrorReportingConfig();
    });
  }
}
