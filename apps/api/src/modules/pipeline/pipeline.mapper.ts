import { HexColorSchema, type Pipeline, type Stage } from '@vistar/shared';
import type { Pipeline as PipelineRow, Stage as StageRow } from '../../generated/prisma/client.js';

export function toStage(s: StageRow): Stage {
  return {
    id: s.id,
    pipelineId: s.pipelineId,
    key: s.key,
    name: s.name,
    type: s.type,
    order: s.order,
    color: s.color && HexColorSchema.safeParse(s.color).success ? s.color : null,
    probability: Math.max(0, Math.min(100, s.probability)),
  };
}

export function toPipeline(p: PipelineRow & { stages: StageRow[] }): Pipeline {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    isDefault: p.isDefault,
    packKey: p.packKey,
    stages: p.stages
      .filter((s) => !s.archivedAt)
      .sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime())
      .map(toStage),
  };
}

/** "Quote sent" -> "quote_sent"; unique within the pipeline ("quote_sent_2"). */
export function stageKey(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'stage';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}
