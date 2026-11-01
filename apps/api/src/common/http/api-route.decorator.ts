import { applyDecorators, HttpCode, RequestMapping, RequestMethod, SetMetadata, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { toNestPath, type RouteDef } from '@vistar/shared';
import { AUTH_MODE_KEY, PERMISSION_KEY, ROUTE_DEF_KEY } from '../auth/auth-context.js';

const METHOD: Record<RouteDef['method'], RequestMethod> = {
  get: RequestMethod.GET,
  post: RequestMethod.POST,
  patch: RequestMethod.PATCH,
  put: RequestMethod.PUT,
  delete: RequestMethod.DELETE,
};

/**
 * Bind a controller method to a route from the shared REST contract (API_ROUTES).
 * Sets method, path, status code, auth mode and required permission from the contract so they
 * cannot drift. Use with `@Controller()` (no path prefix).
 *
 *   @ApiRoute(API_ROUTES.leadCreate)
 *   create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(LeadCreateSchema)) body: LeadCreate) { ... }
 */
export function ApiRoute(def: RouteDef) {
  // Global prefix is "api"; absolute contract paths already start with /api.
  const path = toNestPath(def.absolute ? def.path.replace(/^\/api/, '') : def.path);
  const decorators: Array<MethodDecorator | ClassDecorator> = [
    RequestMapping({ path, method: METHOD[def.method] }),
    HttpCode(def.status ?? 200),
    SetMetadata(AUTH_MODE_KEY, def.auth),
    SetMetadata(ROUTE_DEF_KEY, def),
  ];
  if (def.permission) decorators.push(SetMetadata(PERMISSION_KEY, def.permission));
  if (def.absolute) decorators.push(Version(VERSION_NEUTRAL));
  return applyDecorators(...decorators);
}
