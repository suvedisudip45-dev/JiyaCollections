import dotenv from "dotenv";
import { prisma } from "../config/db.js";
import { loadNotificationConfig } from "../notifications/config.js";
import { inspectNotificationRuntime } from "../notifications/runtimeCheck.js";

dotenv.config();
dotenv.config({ path: ".env.notifications", override: false });

try {
  const report = await inspectNotificationRuntime({ config: loadNotificationConfig() });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || error?.name || "NOTIFICATION_HEALTH_CHECK_FAILED",
    message: "Notification health check failed. Verify worker, broker, database, and configuration.",
  }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
