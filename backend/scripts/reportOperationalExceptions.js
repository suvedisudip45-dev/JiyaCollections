import dotenv from "dotenv";
import { prisma } from "../config/db.js";
import { buildOperationalExceptionReport } from "../services/operationalExceptionReport.js";

dotenv.config();

try {
  const report = await buildOperationalExceptionReport();
  console.log(JSON.stringify(report, null, 2));
  if (report.hasExceptions) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({
    error: "Operational exception report failed.",
    code: error?.code || error?.name || "OPERATIONAL_REPORT_FAILED",
  }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
