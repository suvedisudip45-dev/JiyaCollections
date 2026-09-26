import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.notifications", override: false });

const { startNotificationWorker } = await import("./notifications/worker.js");
await startNotificationWorker();
