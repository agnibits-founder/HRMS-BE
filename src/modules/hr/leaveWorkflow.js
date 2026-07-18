import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { notify } from '../notifications/notify.js';
import { record, AuditAction } from '../audit/audit.service.js';
import { dayCount } from './helpers.js';

/**
 * Leave approval workflow.
 *
 * apply → PENDING (manager notified) → approve | reject (employee notified,
 * balance auto-updates) ; cancel restores the balance. Balances are derived
 * live from APPROVED/PENDING leaves, so a rejected/cancelled leave is
 * automatically excluded — no stored counter to reconcile.
 */
const NEXT = { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' };
const VERB = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' };
const shape = (l) => ({ ...l, days: dayCount(l.startDate, l.endDate) });

/** Notify the applicant's manager that a new leave request is awaiting approval. */
export async function notifyManagerOnApply(data) {
  if (!data.employeeId) return;
  const emp = await prisma.user.findUnique({
    where: { id: data.employeeId },
    select: { managerId: true, companyId: true },
  });
  if (!emp?.managerId) return;
  await notify({
    userId: emp.managerId,
    companyId: emp.companyId,
    type: 'INFO',
    title: 'New leave request',
    message: `${data.employeeName || 'An employee'} requested ${data.type || 'ANNUAL'} leave (${dayCount(data.startDate, data.endDate)} day(s)) — awaiting your approval.`,
  });
}

/** True if the actor may approve/reject this leave (manager of the employee, or HR/ADMIN). */
function canDecide(actor, employee) {
  const perms = actor.permissions ?? [];
  const isAdminHr = perms.includes('*') || perms.includes('leave:update');
  const isManager = !!employee?.managerId && employee.managerId === actor.id;
  return isAdminHr || isManager;
}

/**
 * Approve / reject / cancel a leave with full authorization + notification +
 * audit. Rejection requires a reason.
 */
export async function transitionLeave({ id, action, reason, actor }) {
  const leave = await prisma.leave.findFirst({
    where: { id, companyId: actor.companyId ?? undefined, deletedAt: null },
  });
  if (!leave) throw ApiError.notFound('Leave not found', { code: 'LEAVE_NOT_FOUND' });

  const employee = leave.employeeId
    ? await prisma.user.findUnique({ where: { id: leave.employeeId }, select: { id: true, managerId: true, companyId: true } })
    : null;

  if (action === 'cancel') {
    const isOwner = leave.employeeId === actor.id;
    const isAdminHr = (actor.permissions ?? []).some((p) => p === '*' || p === 'leave:update');
    if (!isOwner && !isAdminHr) throw ApiError.forbidden('You cannot cancel this leave', { code: 'FORBIDDEN' });
    if (['CANCELLED', 'REJECTED'].includes(leave.status)) {
      throw ApiError.badRequest(`Leave is already ${leave.status.toLowerCase()}`, { code: 'INVALID_TRANSITION' });
    }
  } else {
    // approve / reject
    if (leave.employeeId === actor.id) {
      throw ApiError.forbidden('You cannot approve or reject your own leave', { code: 'SELF_APPROVAL' });
    }
    if (!canDecide(actor, employee)) {
      throw ApiError.forbidden("Only the employee's manager or HR can approve/reject this leave", { code: 'FORBIDDEN' });
    }
    if (leave.status !== 'PENDING') {
      throw ApiError.badRequest(`Leave is already ${leave.status.toLowerCase()}`, { code: 'INVALID_TRANSITION' });
    }
    if (action === 'reject' && !reason) {
      throw ApiError.unprocessable('A reason is required to reject a leave', { code: 'REASON_REQUIRED' });
    }
  }

  const updated = await prisma.leave.update({
    where: { id },
    data: {
      status: NEXT[action],
      decisionReason: reason ?? null,
      decidedById: actor.id,
      decidedAt: new Date(),
      updatedById: actor.id,
    },
  });

  // Notify the employee of the outcome.
  await notify({
    userId: leave.employeeId,
    companyId: leave.companyId,
    type: action === 'approve' ? 'SUCCESS' : action === 'reject' ? 'WARNING' : 'INFO',
    title: `Leave ${VERB[action]}`,
    message: `Your ${leave.type} leave (${dayCount(leave.startDate, leave.endDate)} day(s)) was ${VERB[action]}${reason ? `: ${reason}` : ''}.`,
  });
  await record({
    action: AuditAction.UPDATE,
    entity: 'leave',
    entityId: id,
    metadata: { transition: NEXT[action], reason: reason ?? null },
    actorId: actor.id,
  });

  return shape(updated);
}

/** A manager's approval queue: PENDING leaves of their direct reports. */
export async function pendingApprovalQueue(actor, query) {
  const reports = await prisma.user.findMany({
    where: { managerId: actor.id, deletedAt: null },
    select: { id: true },
  });
  const ids = reports.map((r) => r.id);
  const { parsePagination, buildPaginationMeta } = await import('../../utils/pagination.js');
  const pg = parsePagination(query);
  const where = {
    companyId: actor.companyId ?? undefined,
    deletedAt: null,
    status: 'PENDING',
    employeeId: { in: ids.length ? ids : ['__none__'] },
  };
  const [items, total] = await Promise.all([
    prisma.leave.findMany({ where, orderBy: { startDate: 'asc' }, skip: pg.skip, take: pg.take }),
    prisma.leave.count({ where }),
  ]);
  return { items: items.map(shape), pagination: buildPaginationMeta(pg, total) };
}

export default { notifyManagerOnApply, transitionLeave, pendingApprovalQueue };
