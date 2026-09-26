import amqp from "amqplib";
import { QUEUE_NAMES } from "../constants.js";

const buildAmqpUrl = (config) => {
  const protocol = config.rabbit.tlsEnabled ? "amqps" : "amqp";
  const username = encodeURIComponent(config.rabbit.username);
  const password = encodeURIComponent(config.rabbit.password);
  const virtualHost = encodeURIComponent(config.rabbit.virtualHost);
  return `${protocol}://${username}:${password}@${config.rabbit.host}:${config.rabbit.port}/${virtualHost}?heartbeat=${config.rabbit.heartbeatSeconds}`;
};

export const connectNotificationBroker = async (config) => {
  const connection = await amqp.connect(buildAmqpUrl(config));
  const channel = await connection.createConfirmChannel();
  await channel.assertExchange(QUEUE_NAMES.EXCHANGE, "direct", { durable: true });
  await channel.assertExchange(QUEUE_NAMES.DEAD_LETTER_EXCHANGE, "direct", { durable: true });

  const queues = [
    { name: QUEUE_NAMES.SMS, route: QUEUE_NAMES.SMS_ROUTE, deadRoute: QUEUE_NAMES.SMS_DEAD_ROUTE },
    { name: QUEUE_NAMES.EMAIL, route: QUEUE_NAMES.EMAIL_ROUTE, deadRoute: QUEUE_NAMES.EMAIL_DEAD_ROUTE },
  ];
  for (const queue of queues) {
    await channel.assertQueue(queue.name, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": QUEUE_NAMES.DEAD_LETTER_EXCHANGE,
        "x-dead-letter-routing-key": queue.deadRoute,
      },
    });
    await channel.bindQueue(queue.name, QUEUE_NAMES.EXCHANGE, queue.route);
    const deadQueue = queue.name.replace(".queue", ".dlq");
    await channel.assertQueue(deadQueue, { durable: true });
    await channel.bindQueue(deadQueue, QUEUE_NAMES.DEAD_LETTER_EXCHANGE, queue.deadRoute);
  }

  await channel.prefetch(config.rabbit.prefetch);
  return { connection, channel };
};

export const publishConfirmed = (channel, routingKey, payload, properties = {}) => new Promise((resolve, reject) => {
  channel.publish(
    QUEUE_NAMES.EXCHANGE,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      contentType: "application/json",
      timestamp: Date.now(),
      ...properties,
    },
    (error) => error ? reject(error) : resolve(),
  );
});
