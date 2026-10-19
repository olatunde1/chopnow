import type { Role } from '@chopnow/shared-schemas';
import { STAFF_ROLES } from '@chopnow/shared-schemas';

/** What a client is told: "something changed, refetch". Ids only, never personal data. */
export type RealtimeEvent =
  | { type: 'order.updated'; orderId: string; restaurantId: string; status: string }
  | { type: 'delivery.updated'; orderId: string; restaurantId: string; deliveryId: string; event: string }
  | { type: 'work.updated'; deliveryId?: string }
  | { type: 'dispatch.updated' }
  | { type: 'notification.new'; notificationId: string; notificationType: string; orderId: string | null };

export interface Connection {
  userId: string;
  role: Role;
  send(data: string): void;
}

/**
 * Connections on this API instance, by user, plus the staff room. Each instance runs its own change
 * feed over the shared database, so every instance can serve any user without a message broker.
 */
export class RealtimeHub {
  private readonly byUser = new Map<string, Set<Connection>>();
  private readonly staff = new Set<Connection>();
  /** Recently delivered events, for tests and diagnostics. */
  readonly recent: { userId: string | 'staff'; event: RealtimeEvent }[] = [];

  add(c: Connection) {
    const set = this.byUser.get(c.userId) ?? new Set();
    set.add(c);
    this.byUser.set(c.userId, set);
    if ((STAFF_ROLES as readonly string[]).includes(c.role)) this.staff.add(c);
  }

  remove(c: Connection) {
    this.byUser.get(c.userId)?.delete(c);
    if (this.byUser.get(c.userId)?.size === 0) this.byUser.delete(c.userId);
    this.staff.delete(c);
  }

  get size() {
    let n = 0;
    for (const s of this.byUser.values()) n += s.size;
    return n;
  }

  toUsers(userIds: (string | null | undefined)[], event: RealtimeEvent) {
    const payload = JSON.stringify(event);
    for (const id of new Set(userIds.filter((x): x is string => !!x))) {
      this.remember(id, event);
      for (const c of this.byUser.get(id) ?? []) safeSend(c, payload);
    }
  }

  toStaff(event: RealtimeEvent) {
    this.remember('staff', event);
    const payload = JSON.stringify(event);
    for (const c of this.staff) safeSend(c, payload);
  }

  private remember(userId: string | 'staff', event: RealtimeEvent) {
    this.recent.push({ userId, event });
    if (this.recent.length > 500) this.recent.splice(0, this.recent.length - 500);
  }
}

function safeSend(c: Connection, payload: string) {
  try {
    c.send(payload);
  } catch {
    // Closed socket: the server removes it on its close event.
  }
}
