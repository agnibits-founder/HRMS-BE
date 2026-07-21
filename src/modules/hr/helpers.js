import { z } from 'zod';
import { prisma } from '../../config/prisma.js';

/**
 * Shared building blocks for the generated HR CRUD modules: a common list-query
 * schema, coercion helpers, and denormalization resolvers that turn an id
 * (employee/requester/candidate/department) into a stored display value so
 * reads stay join-free and fast.
 */
export const listQuery = (extra = {}) =>
  z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sort: z.string().optional(),
    search: z.string().optional(),
    ...extra,
  });

export const isoDate = z.coerce.date();
export const optDate = z.coerce.date().nullable().optional();
export const nstr = z.string().trim().min(1);
export const ostr = z.string().trim().nullable().optional();

/**
 * Human-readable seniority band for a numeric designation level (1–15). The raw
 * number sorts/compares well but reads poorly ("L9"), so we surface a label the
 * UI can show alongside it ("L9 · Lead"). This is a sensible default ladder;
 * companies get their own custom names in a later leveling-framework feature.
 */
const LEVEL_BANDS = [
  [2, 'Entry'],
  [4, 'Junior'],
  [6, 'Mid'],
  [8, 'Senior'],
  [10, 'Lead'],
  [12, 'Manager'],
  [14, 'Director'],
  [15, 'Executive'],
];
export const levelLabel = (level) => {
  if (level == null) return null;
  const band = LEVEL_BANDS.find(([max]) => level <= max);
  return band ? band[1] : null;
};
/** Time-of-day "HH:MM" (00:00–23:59), for attendance check-in/out. */
export const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time in HH:MM format')
  .nullable()
  .optional();

/**
 * Resolve a user reference that may be an id OR an email into { id, name }.
 * Keeps denormalized employee/requester fields robust regardless of whether the
 * frontend sends a real user id or an email; falls back to the raw value.
 */
export async function resolveUser(value) {
  if (!value) return { id: null, name: null };
  const v = String(value);
  const u = await prisma.user.findFirst({
    where: { OR: [{ id: v }, { email: v.toLowerCase() }] },
    select: { id: true, firstName: true, lastName: true },
  });
  if (u) return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() };
  return { id: v, name: null };
}

/** Resolve a user's display name only. */
export async function resolveUserName(value) {
  return (await resolveUser(value)).name;
}

/** Resolve a candidate's display name. */
export async function resolveCandidateName(id) {
  if (!id) return null;
  const c = await prisma.candidate.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
  return c ? `${c.firstName} ${c.lastName}`.trim() : null;
}

/** Resolve a department reference (id OR name) to a valid department id within the company. */
export async function resolveDepartmentId(value, companyId) {
  if (!value) return null;
  const dept = await prisma.department.findFirst({
    where: { companyId: companyId ?? undefined, deletedAt: null, OR: [{ id: String(value) }, { name: String(value) }] },
    select: { id: true },
  });
  return dept?.id ?? null;
}

/**
 * Work hours between two "HH:MM" times, rounded to 2 decimals. Handles overnight
 * shifts (checkOut earlier than checkIn wraps to the next day). 0 if incomplete.
 */
export function workHoursBetween(checkIn, checkOut) {
  const toMinutes = (t) => {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMinutes(checkIn);
  const b = toMinutes(checkOut);
  if (a == null || b == null) return 0;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60; // overnight / night shift
  return Math.round((diff / 60) * 100) / 100;
}

/** Inclusive day count between two dates. */
export function dayCount(start, end) {
  if (!start || !end) return 0;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms >= 0 ? Math.floor(ms / 86_400_000) + 1 : 0;
}

export const zEnum = (values) => z.enum(values);
