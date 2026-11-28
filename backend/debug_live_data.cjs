const mysql = require('mysql2/promise');

(async () => {
  await import("./utils/requireMaintenanceDatabaseSafety.js");
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const conn = await mysql.createConnection({
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || "3306"),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")),
  });

  const [manufacturers] = await conn.execute('SELECT id, name, email, city, ncmPickupBranch, pickupBranchStatus, isActive, isAvailable, createdAt FROM Manufacturer ORDER BY createdAt DESC LIMIT 20');
  const [assignments] = await conn.execute('SELECT id, orderId, manufacturerId, status, assignedAt FROM OrderAssignment ORDER BY assignedAt DESC LIMIT 20');
  const [orders] = await conn.execute('SELECT id, manufacturerId, fulfillmentStatus, amount, items, address, createdAt FROM `Order` ORDER BY createdAt DESC LIMIT 20');

  console.log(JSON.stringify({ manufacturers, assignments, orders }, null, 2));

  await conn.end();
})();
