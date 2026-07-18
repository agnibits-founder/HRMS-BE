import { prisma } from '../../config/prisma.js';
import { emitToUser } from '../../realtime/socket.js';
import { logger } from '../../config/logger.js';

/**
 * Create an in-app notification for a user and push it in real time over
 * Socket.io. Best-effort: a notification failure never breaks the originating
 * action (leave approval, etc.).
 */
export async function notify({ userId, companyId, title, message = null, type = 'INFO' }) {
  if (!userId) return null;
  try {
    const n = await prisma.notification.create({
      data: { userId, companyId: companyId ?? null, title, message, type },
    });
    emitToUser(userId, 'notification:new', n);
    return n;
  } catch (err) {
    logger.error({ err }, 'notify failed');
    return null;
  }
}

export default notify;
