import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { CSRF_COOKIE, CSRF_HEADER } from '@nfc/shared';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ForbiddenError } from '../common/errors/domain-error';
import { readCookie } from './actor.service';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE.has(request.method.toUpperCase())) return true;

    const cookie = readCookie(request, CSRF_COOKIE);
    if (!cookie) return true;

    const header = request.headers[CSRF_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token || token !== cookie) {
      throw new ForbiddenError('The request failed the CSRF check. Reload and try again.');
    }
    return true;
  }
}
