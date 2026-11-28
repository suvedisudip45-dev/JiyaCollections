import "./utils/requireMaintenanceDatabaseSafety.js";
import mysql from 'mysql2/promise';

const databaseUrl = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || "3306"),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")),
});

try {
  const [deliveries] = await conn.execute('SELECT id, orderId, state, ncmOrderId, ncmStatus, vendorReference, lastSyncedAt, updatedAt FROM DeliveryOrder ORDER BY updatedAt DESC LIMIT 10');
  const [webhooks] = await conn.execute('SELECT id, eventKey, event, orderId, orderIds, status, processingStatus, processingError, receivedAt FROM NcmWebhookEvent ORDER BY receivedAt DESC LIMIT 10');
  const [assignments] = await conn.execute('SELECT id, orderId, manufacturerId, status, assignedAt, readyAt, pickedUpAt FROM OrderAssignment ORDER BY assignedAt DESC LIMIT 10');
  const [orders] = await conn.execute('SELECT id, manufacturerId, fulfillmentStatus, status, amount, date FROM `Order` ORDER BY date DESC LIMIT 10');

  console.log(JSON.stringify({ deliveries, webhooks, assignments, orders }, null, 2));
} finally {
  await conn.end();
}
