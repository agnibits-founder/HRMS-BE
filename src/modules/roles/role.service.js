import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { roleRepository } from './role.repository.js';
import { record, recordChange, AuditAction } from '../audit/audit.service.js';
import { PERMISSIONS, ALL_PERMISSIONS, WILDCARD } from '../../constants/permissions.js';

/**
 * Role & permission management. Roles are company-scoped (or global system
 * roles, companyId=null). System roles are read-only. Multi-tenant: a tenant
 * admin only sees/manages its own company's roles (plus read-only global system
 * roles); the platform SUPER_ADMIN spans all companies.
 */
class RoleService {
  /** The full permission catalog, grouped by resource, for admin UIs. */
  catalog() {
    const grouped = {};
    for (const [key, value] of Object.entries(PERMISSIONS)) {
      const [resource, action] = value.split(':');
      (grouped[resource] ??= []).push({ key, permission: value, action });
    }
    return { wildcard: WILDCARD, total: ALL_PERMISSIONS.length, groups: grouped };
  }

  async list(query, ctx) {
    let where;
    if (ctx.isSuperAdmin) {
      where = query.companyId ? { companyId: query.companyId } : {};
    } else {
      // Own company roles + global system roles (read-only reference).
      where = { OR: [{ companyId: ctx.companyId ?? undefined }, { companyId: null }] };
    }
    const { items, pagination } = await roleRepository.paginate(query, where);
    return { items, pagination };
  }

  async getById(id, ctx) {
    const role = await roleRepository.findById(id, { include: { _count: { select: { users: true } } } });
    if (!role) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    // Tenants may read their own roles and global system roles only.
    if (!ctx.isSuperAdmin && role.companyId !== ctx.companyId && role.companyId !== null) {
      throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    }
    return role;
  }

  async create(data, ctx) {
    const targetCompany = ctx.isSuperAdmin ? (data.companyId ?? ctx.companyId ?? null) : ctx.companyId;
    const dup = await prisma.role.findFirst({
      where: { name: data.name, companyId: targetCompany, deletedAt: null },
    });
    if (dup) throw ApiError.conflict('A role with this name already exists', { code: 'ROLE_NAME_TAKEN' });

    const role = await roleRepository.create({
      name: data.name,
      description: data.description,
      companyId: targetCompany,
      permissions: [...new Set(data.permissions)],
      isSystem: false,
      createdById: ctx.actorId,
    });
    await record({ action: AuditAction.CREATE, entity: 'role', entityId: role.id, after: role, actorId: ctx.actorId });
    return role;
  }

  async update(id, data, ctx) {
    const before = await roleRepository.findById(id);
    if (!before) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    this.#assertWritable(before, ctx);
    if (before.isSystem) throw ApiError.forbidden('System roles cannot be modified', { code: 'SYSTEM_ROLE' });

    const patch = { ...data, updatedById: ctx.actorId };
    if (data.permissions) patch.permissions = [...new Set(data.permissions)];
    if (!ctx.isSuperAdmin) delete patch.companyId; // never reassign a role's tenant

    const after = await roleRepository.update(id, patch);
    await recordChange({ action: AuditAction.UPDATE, entity: 'role', entityId: id, before, after, actorId: ctx.actorId });
    return after;
  }

  async remove(id, ctx) {
    const role = await prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    this.#assertWritable(role, ctx);
    if (role.isSystem) throw ApiError.forbidden('System roles cannot be deleted', { code: 'SYSTEM_ROLE' });
    if (role._count.users > 0) {
      throw ApiError.conflict('Role is assigned to users and cannot be deleted', {
        code: 'ROLE_IN_USE',
        details: { assignedUsers: role._count.users },
      });
    }
    await roleRepository.remove(id, { actorId: ctx.actorId });
    await record({ action: AuditAction.DELETE, entity: 'role', entityId: id, actorId: ctx.actorId });
  }

  /** A tenant may only mutate roles belonging to its own company. */
  #assertWritable(role, ctx) {
    if (ctx.isSuperAdmin) return;
    if (role.companyId !== ctx.companyId) {
      throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    }
  }
}

export const roleService = new RoleService();
export default roleService;
