import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_KEY = 'nfc:public-route';

/**
 * Marks a route as reachable without an acting identity.
 *
 * Only the health endpoint uses this. The route-coverage test asserts that no
 * other endpoint is public and that every non-public endpoint declares a
 * permission, so a new endpoint cannot be added without an access decision.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);
