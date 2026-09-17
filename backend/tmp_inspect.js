const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'root', database: 'clothing' });
  const [manufacturers] = await conn.execute('SELECT id, name, email, city, ncmPickupBranch, pickupBranchStatus, isActive, isAvailable, createdAt FROM Manufacturer ORDER BY createdAt DESC LIMIT 20');
  const [assignments] = await conn.execute('SELECT id, orderId, manufacturerId, status, assignedAt FROM OrderAssignment ORDER BY assignedAt DESC LIMIT 20');
  const [orders] = await conn.execute('SELECT id, manufacturerId, fulfillmentStatus, amount, items, address FROM `Order` ORDER BY createdAt DESC LIMIT 20');
  console.log(JSON.stringify({ manufacturers, assignments, orders }, null, 2));
  await conn.end();
})();
