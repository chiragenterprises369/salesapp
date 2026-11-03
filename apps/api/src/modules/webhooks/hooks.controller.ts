import { Body, Controller, Headers, Param, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { API_ROUTES, IdSchema, TelephonyProviderParamSchema, WhatsappVerifyQuerySchema, type TelephonyProvider } from '@vistar/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { IndiamartService } from '../integrations/indiamart.service.js';
import { TelephonyService } from '../integrations/telephony.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { InboundService } from './inbound.service.js';

const WorkspaceParam = z.object({ workspaceId: IdSchema });
const InboundParam = z.object({ workspaceId: IdSchema, sourceKey: z.string().min(1).max(60) });
const KeyQuery = z.object({ key: z.string().max(200).optional() });
const TokenQuery = z.object({ token: z.string().max(200).optional() });
type VerifyQuery = z.output<typeof WhatsappVerifyQuerySchema>;

/**
 * Every /api/hooks/* receiver in ONE controller so Express matches the literal paths (whatsapp, indiamart, telephony)
 * before the generic /api/hooks/{workspaceId}/{sourceKey}: keep this declaration order. The guard skips auth for
 * these routes (auth webhook / public); each handler verifies its own signature, token or key.
 */
@Controller()
export class HooksController {
  constructor(
    private readonly inbound: InboundService,
    private readonly whatsapp: WhatsappService,
    private readonly indiamart: IndiamartService,
    private readonly telephony: TelephonyService,
  ) {}

  @ApiRoute(API_ROUTES.whatsappWebhookVerify)
  platformVerify(@Query(new ZodPipe(WhatsappVerifyQuerySchema)) q: VerifyQuery, @Res() res: Response) {
    res.status(200).type('text/plain').send(this.whatsapp.verifyPlatform(q));
  }

  @ApiRoute(API_ROUTES.whatsappWebhook)
  async platformEvents(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: unknown) {
    await this.whatsapp.receivePlatform(req.rawBody, signature, body);
    return { ok: true as const };
  }

  @ApiRoute(API_ROUTES.whatsappWorkspaceVerify)
  async workspaceVerify(@Param(new ZodPipe(WorkspaceParam)) { workspaceId }: { workspaceId: string }, @Query(new ZodPipe(WhatsappVerifyQuerySchema)) q: VerifyQuery, @Res() res: Response) {
    const challenge = await this.whatsapp.verifyWorkspace(workspaceId, q);
    res.status(200).type('text/plain').send(challenge);
  }

  @ApiRoute(API_ROUTES.whatsappWorkspaceWebhook)
  workspaceEvents(@Param(new ZodPipe(WorkspaceParam)) { workspaceId }: { workspaceId: string }, @Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: unknown) {
    return this.whatsapp.receiveWorkspace(workspaceId, req.rawBody, signature, body);
  }

  @ApiRoute(API_ROUTES.indiamartPush)
  indiamartPush(@Param(new ZodPipe(WorkspaceParam)) { workspaceId }: { workspaceId: string }, @Query(new ZodPipe(KeyQuery)) q: { key?: string }, @Body() body: unknown) {
    return this.indiamart.receivePush(workspaceId, q.key, body);
  }

  @ApiRoute(API_ROUTES.telephonyWebhook)
  telephonyCallback(@Param(new ZodPipe(TelephonyProviderParamSchema)) p: { workspaceId: string; provider: TelephonyProvider }, @Query(new ZodPipe(TokenQuery)) q: { token?: string }, @Body() body: unknown) {
    return this.telephony.callback(p.workspaceId, p.provider, q.token, body);
  }

  /** Generic inbound source: keep LAST (after the literal provider paths). */
  @ApiRoute(API_ROUTES.inboundWebhook)
  async inboundWebhook(
    @Param(new ZodPipe(InboundParam)) p: { workspaceId: string; sourceKey: string },
    @Query(new ZodPipe(TokenQuery)) q: { token?: string },
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.inbound.receive(p.workspaceId, p.sourceKey, req, q.token);
    res.status(out.status);
    return out.body;
  }
}
