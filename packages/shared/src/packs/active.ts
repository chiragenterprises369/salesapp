import { z } from 'zod';

/** An active, entitled pack in a workspace (MeResponse.packs, PackRuntime.packs). Dependency-free on purpose. */
export const ActivePackSchema = z.object({
  key: z.string(),
  version: z.string(),
  /** Enabled modes chosen at activation (e.g. ["developer"]). */
  modes: z.array(z.string()),
});
export type ActivePack = z.infer<typeof ActivePackSchema>;
