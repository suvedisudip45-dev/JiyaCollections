import dotenv from "dotenv";
import { loadNotificationConfig } from "../notifications/config.js";
import { QUEUE_NAMES } from "../notifications/constants.js";
import { connectNotificationBroker } from "../notifications/queue/connection.js";

dotenv.config();
dotenv.config({ path: ".env.notifications", override: false });

let broker;

try {
  const config = loadNotificationConfig();
  if (!config.enabled) throw new Error("NOTIFICATIONS_ENABLED is not true.");

  broker = await connectNotificationBroker(config);
  const queues = await Promise.all([QUEUE_NAMES.SMS, QUEUE_NAMES.EMAIL].map(async (name) => {
    const { messageCount, consumerCount } = await broker.channel.checkQueue(name);
    return { name, messageCount, consumerCount };
  }));

  console.log(JSON.stringify({ ok: true, connected: true, queues }, null, 2));
} catch (error) {
  const message = String(error?.message || "RabbitMQ check failed.")
    .replace(/(amqps?:\/\/)[^/@\s]+@/gi, "$1[redacted]@");
  console.error(JSON.stringify({ ok: false, code: error?.code || error?.name || "ERROR", message }, null, 2));
  process.exitCode = 1;
} finally {
  try { await broker?.channel.close(); } catch {}
  try { await broker?.connection.close(); } catch {}
}