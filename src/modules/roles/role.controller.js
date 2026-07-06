import { roleService } from './role.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';
import { tenantScope } from '../../utils/tenant.js';

export const catalog = asyncHandler(async (_req, res) =>
  ok(res, roleService.catalog(), 'Permission catalog')
);

export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await roleService.list(req.validatedQuery ?? req.query, tenantScope(req.user));
  return paginated(res, items, pagination, 'Roles retrieved');
});

export const getOne = asyncHandler(async (req, res) =>
  ok(res, await roleService.getById(req.params.id, tenantScope(req.user)), 'Role retrieved')
);

export const create = asyncHandler(async (req, res) =>
  created(res, await roleService.create(req.body, tenantScope(req.user)), 'Role created')
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await roleService.update(req.params.id, req.body, tenantScope(req.user)), 'Role updated')
);

export const remove = asyncHandler(async (req, res) => {
  await roleService.remove(req.params.id, tenantScope(req.user));
  return noContent(res);
});

export default { catalog, list, getOne, create, update, remove };
