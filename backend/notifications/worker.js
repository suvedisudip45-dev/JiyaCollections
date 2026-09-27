import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { loadNotificationConfig } from "./config.js";
import { startNotificationConsumers } from "./consumer.js";
import { connectNotificationBroker } from "./queue/connection.js";
import { markExpiredProcessingUnknown, scheduleDueRetries } from "./scheduler.js";
import { createNotificationProviders } from "./providers/providerFactory.js";
import { publishPendingOutbox } from "./outboxRelay.js";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const startNotificationWorker = async ({
  config = loadNotificationConfig(),
  client = prisma,
  connectBroker = connectNotificationBroker,
  providerFactory = createNotificationProviders,
  relay = publishPendingOutbox,
  retryScheduler = scheduleDueRetries,
  leaseRecovery = markExpiredProcessingUnknown,
} = {}) => {
  if (!config.enabled) {
    logger.info("Notification worker disabled; no broker connection was opened.");
    return;
  }

  const providers = providerFactory({ config });
  let stopping = false;
  let activeConnection = null;
  let activeChannel = null;
  let resolvePause = null;
  let reconnectDelayMs = 1000;

  const requestStop = () => {
    stopping = true;
    if (resolvePause) resolvePause();
  };
  const handleSignal = () => requestStop();
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  try {
    while (!stopping) {
      let brokerAvailable = false;
      try {
        const broker = await connectBroker(config);
        activeConnection = broker.connection;
        activeChannel = broker.channel;
        brokerAvailable = true;
        reconnectDelayMs = 1000;
        activeConnection.on("error", (error) => {
          brokerAvailable = false;
          logger.warn("Notification broker connection error.", { code: error?.code || "BROKER_ERROR" });
        });
        activeConnection.on("close", () => { brokerAvailable = false; });
        activeChannel.on("close", () => { brokerAvailable = false; });
        await startNotificationConsumers({ channel: activeChannel, providers, config, client });
        logger.info("Notification worker connected to RabbitMQ.");

        while (!stopping && brokerAvailable) {
          await relay({ client, channel: activeChannel });
          await retryScheduler({ client, limit: 50 });
          await leaseRecovery({ client, limit: 50 });
          await new Promise((resolve) => {
            resolvePause = resolve;
            const timer = setTimeout(() => {
              resolvePause = null;
              resolve();
            }, config.retry.schedulerIntervalMs);
            timer.unref?.();
          });
        }
      } catch (error) {
        logger.error("Notification worker cycle failed.", { code: error?.code || error?.name || "WORKER_ERROR" });
      } finally {
        brokerAvailable = false;
        try { await activeChannel?.close(); } catch {}
        try { await activeConnection?.close(); } catch {}
        activeChannel = null;
        activeConnection = null;
      }

      if (!stopping) {
        await pause(reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
      }
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    try { providers.email.close(); } catch {}
    await client.$disconnect?.();
    logger.info("Notification worker stopped.");
  }
};
