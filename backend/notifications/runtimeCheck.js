import { prisma } from "../config/db.js";
import { NOTIFICATION_STATUS, QUEUE_NAMES } from "./constants.js";
import { connectNotificationBroker } from "./queue/connection.js";

const QUEUE_BY_CHANNEL = Object.freeze({
  SMS: QUEUE_NAMES.SMS,
  EMAIL: QUEUE_NAMES.EMAIL,
});

export const inspectNotificationRuntime = async ({
  config,
  client = prisma,
  connectBroker = connectNotificationBroker,
  now = new Date(),
} = {}) => {
  if (!config?.enabled) throw new Error("Notifications are not enabled.");

  const enabledChannels = ["SMS", "EMAIL"].filter((channel) => config[channel.toLowerCase()]?.enabled);
  let broker;
  try {
    broker = await connectBroker(config);
    const queues = await Promise.all(enabledChannels.map(async (channel) => {
      const name = QUEUE_BY_CHANNEL[channel];
      const { messageCount, consumerCount } = await broker.channel.checkQueue(name);
      return { channel, name, messageCount, consumerCount };
    }));
    const groupedStatuses = await client.notification.groupBy({
      by: ["channel", "status"],
      _count: { _all: true },
    });
    const oldestOutstanding = await client.notification.findFirst({
      where: { status: { in: [NOTIFICATION_STATUS.PENDING, NOTIFICATION_STATUS.QUEUED] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const statusCounts = Object.fromEntries(
      groupedStatuses.map(({ channel, status, _count }) => [
        `${channel}:${status}`,
        _count._all,
      ])
    );

    return {
      ok: queues.every((queue) => queue.consumerCount > 0),
      broker: { connected: true, queues },
      notifications: {
        statusCounts,
        oldestOutstandingCreatedAt: oldestOutstanding?.createdAt?.toISOString() || null,
        oldestOutstandingAgeSeconds: oldestOutstanding
          ? Math.max(0, Math.floor((now.getTime() - oldestOutstanding.createdAt.getTime()) / 1000))
          : null,
      },
    };
  } finally {
    try { await broker?.channel.close(); } catch {}
    try { await broker?.connection.close(); } catch {}
  }
};
