import "../utils/requireMaintenanceDatabaseSafety.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function checkOrders() {
  try {
    const orders = await prisma.order.findMany();
    const cleanOrders = orders.map(o => ({ ...o, date: o.date.toString() }));
    console.log("ALL ORDERS:", JSON.stringify(cleanOrders, null, 2));

    const products = await prisma.product.findMany();
    const cleanProducts = products.map(p => ({ ...p, date: p.date.toString() }));
    console.log("ALL PRODUCTS:", JSON.stringify(cleanProducts, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

checkOrders();
