/**
 * Multi-tenant scoping helpers. Every tenant (company) is isolated at the row
 * level via `companyId`. The single platform SUPER_ADMIN (Agnibits) bypasses
 * scoping to manage all tenants; everyone else is confined to their own company.
 */

/** Is this user the platform SUPER_ADMIN (Agnibits)? */
export function isSuperAdmin(user) {
  if (!user) return false;
  const roles = user.roles ?? [];
  const perms = user.permissions ?? [];
  return roles.includes('SUPER_ADMIN') || perms.includes('platform:manage') || perms.includes('*');
}

/** Build a scope context from the authenticated user. */
export function tenantScope(user) {
  return {
    actorId: user?.id ?? null,
    companyId: user?.companyId ?? null,
    isSuperAdmin: isSuperAdmin(user),
  };
}

/**
 * Merge the tenant filter into a Prisma `where`. Super admin → no companyId
 * constraint (sees all); tenant users → forced to their own companyId.
 */
export function tenantWhere(ctx, extra = {}) {
  return ctx.isSuperAdmin ? { ...extra } : { ...extra, companyId: ctx.companyId };
}

export default { isSuperAdmin, tenantScope, tenantWhere };
