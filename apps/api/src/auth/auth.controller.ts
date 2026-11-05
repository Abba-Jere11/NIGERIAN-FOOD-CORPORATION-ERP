import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { ActorContext } from '@nfc/db';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { StepUpRequiredError } from '../common/errors/domain-error';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentActor } from './current-actor.decorator';
import { Public } from './public.decorator';
import { ActorOnly } from './require-permission.decorator';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const mfaSchema = z.object({
  code: z.string().min(6).max(32),
});

const emailSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(12),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  password: z.string().min(12),
});

const enrolConfirmSchema = z.object({
  code: z.string().min(6).max(32),
});

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('csrf')
  @Public()
  csrf(@Res({ passthrough: true }) res: Response) {
    return this.auth.issueCsrf(res);
  }

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(zodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
  ) {
    return this.auth.login(req, res, body.email, body.password);
  }

  @Post('mfa')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  mfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(zodPipe(mfaSchema)) body: z.infer<typeof mfaSchema>,
  ) {
    return this.auth.verifyMfa(req, res, body.code);
  }

  @Post('logout')
  @ActorOnly()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
    return { ok: true };
  }

  @Post('forgot')
  @Public()
  async forgot(@Body(zodPipe(emailSchema)) body: z.infer<typeof emailSchema>) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Post('reset')
  @Public()
  async reset(@Body(zodPipe(resetSchema)) body: z.infer<typeof resetSchema>) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @Post('change-password')
  @ActorOnly()
  async changePassword(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    const result = await this.auth.changePassword(actor.ref, body.currentPassword, body.password);
    return { ok: true, mfaEnrolRequired: result.mfaEnrolRequired };
  }

  @Post('mfa/enrol')
  @ActorOnly()
  beginEnrol(@CurrentActor() actor: ActorContext) {
    return this.auth.beginMfaEnrol(actor);
  }

  @Post('mfa/enrol/confirm')
  @ActorOnly()
  confirmEnrol(
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(enrolConfirmSchema)) body: z.infer<typeof enrolConfirmSchema>,
  ) {
    return this.auth.confirmMfaEnrol(actor, body.code);
  }

  @Post('mfa/backup-codes')
  @ActorOnly()
  regenerateBackup(@Req() req: Request, @CurrentActor() actor: ActorContext) {
    if (actor.mfaPolicyRequired && actor.mfaEnrolled && !this.auth.hasValidStepUp(req, actor.ref)) {
      throw new StepUpRequiredError();
    }
    return this.auth.regenerateBackupCodes(actor.ref);
  }

  @Post('step-up')
  @ActorOnly()
  stepUp(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentActor() actor: ActorContext,
    @Body(zodPipe(enrolConfirmSchema)) body: z.infer<typeof enrolConfirmSchema>,
  ) {
    return this.auth.confirmStepUp(req, res, actor.ref, body.code);
  }

  @Get('sessions')
  @ActorOnly()
  sessions(@CurrentActor() actor: ActorContext) {
    return this.auth.listMySessions(actor);
  }

  @Post('sessions/:id/revoke')
  @ActorOnly()
  async revokeMine(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.auth.revokeMySession(actor.ref, id);
    return { ok: true };
  }
}
