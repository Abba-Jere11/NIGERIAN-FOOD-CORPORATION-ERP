import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { zodPipe } from '../common/validation/zod-validation.pipe';
import { InvitesService } from '../hr/invites.service';
import { registerInviteSchema } from './me.dto';

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]?.trim() ?? null;
  return req.ip ?? null;
}

@Controller('api/public/invites')
export class PublicInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get(':token')
  @Public()
  preview(@Param('token') token: string, @Req() req: Request) {
    return this.invites.preview(token, clientIp(req));
  }

  @Post(':token/register')
  @Public()
  async register(
    @Param('token') token: string,
    @Body(zodPipe(registerInviteSchema)) body: {
      password: string;
      otherNames?: string | null;
      gender?: string | null;
      personalPhone?: string | null;
      emergencyName?: string | null;
      emergencyPhone?: string | null;
      bankName?: string | null;
      bankAccountName?: string | null;
      bankAccountNumber?: string | null;
    },
    @Req() req: Request,
  ) {
    await this.invites.register(token, body, clientIp(req));
    return { ok: true };
  }
}
