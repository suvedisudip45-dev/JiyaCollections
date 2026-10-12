import { PrismaClient } from "@prisma/client";
import { prismaQueryCacheMiddleware } from "../utils/prismaQueryCache.js";

const prisma = new PrismaClient({
  log: ["error"],
});

prisma.$use(prismaQueryCacheMiddleware);

const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log("MySQL DB connected via Prisma");
    return true;
  } catch (error) {
    console.error("Error connecting to MySQL DB:", error.message);
    return false;
  }
};

const reconnectPrisma = async () => {
  try {
    await prisma.$connect();
    return true;
  } catch (error) {
    console.error("Prisma reconnect failed:", error.message);
    return false;
  }
};

export { prisma, reconnectPrisma };
export default connectDB;
