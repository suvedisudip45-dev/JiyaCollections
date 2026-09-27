import amqp from "amqplib";
import { logger } from "../../utils/logger.js";
import { QUEUE_NAMES } from "../constants.js";

const buildAmqpUrl = (config) => {
  const protocol = config.rabbit.tlsEnabled ? "amqps" : "amqp";
  const username = encodeURIComponent(config.rabbit.username);
  const password = encodeURIComponent(config.rabbit.password);
  const virtualHost = encodeURIComponent(config.rabbit.virtualHost);
  return `${protocol}://${username}:${password}@${config.rabbit.host}:${config.rabbit.port}/${virtualHost}?heartbeat=${config.rabbit.heartbeatSeconds}`;
};

export const connectNotificationBroker = async (config) => {
  logger.info("Connecting to RabbitMQ notification broker", {
    host: config.rabbit.host,
    port: config.rabbit.port,
    tlsEnabled: config.rabbit.tlsEnabled,
    virtualHost: config.rabbit.virtualHost,
  });
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
  logger.info("RabbitMQ notification queues ready", {
    exchange: QUEUE_NAMES.EXCHANGE,
    deadLetterExchange: QUEUE_NAMES.DEAD_LETTER_EXCHANGE,
    queues: [QUEUE_NAMES.SMS, QUEUE_NAMES.EMAIL],
  });
  return { connection, channel };
};

export const publishConfirmed = (channel, routingKey, payload, properties = {}) => new Promise((resolve, reject) => {
  const message = Buffer.from(JSON.stringify(payload));
  logger.info("Publishing RabbitMQ notification message", {
    routingKey,
    payloadPreview: JSON.stringify(payload).slice(0, 250),
    messageId: properties?.messageId || null,
  });
  channel.publish(
    QUEUE_NAMES.EXCHANGE,
    routingKey,
    message,
    {
      persistent: true,
      contentType: "application/json",
      timestamp: Date.now(),
      ...properties,
    },
    (error) => {
      if (error) {
        logger.error("RabbitMQ publish confirm failed", {
          routingKey,
          messageId: properties?.messageId || null,
          errorMessage: error.message,
        });
        reject(error);
        return;
      }
      logger.info("RabbitMQ publish confirm succeeded", {
        routingKey,
        messageId: properties?.messageId || null,
      });
      resolve();
    },
  );
});
