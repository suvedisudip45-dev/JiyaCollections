import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'clothing',
});

const [deliveries] = await conn.execute('SELECT id, orderId, state, ncmOrderId, ncmStatus, vendorReference, lastSyncedAt, updatedAt FROM DeliveryOrder ORDER BY updatedAt DESC LIMIT 10');
const [webhooks] = await conn.execute('SELECT id, eventKey, event, orderId, orderIds, status, processingStatus, processingError, receivedAt FROM NcmWebhookEvent ORDER BY receivedAt DESC LIMIT 10');
const [assignments] = await conn.execute('SELECT id, orderId, manufacturerId, status, assignedAt, readyAt, pickedUpAt FROM OrderAssignment ORDER BY assignedAt DESC LIMIT 10');
const [orders] = await conn.execute('SELECT id, manufacturerId, fulfillmentStatus, status, amount, date FROM `Order` ORDER BY date DESC LIMIT 10');

console.log(JSON.stringify({ deliveries, webhooks, assignments, orders }, null, 2));

await conn.end();
