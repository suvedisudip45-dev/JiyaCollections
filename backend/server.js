import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { flushLogs, logger } from "./utils/logger.js";
import { ALLOWED_CORS_HEADERS, getAllowedOrigins, isOriginAllowed } from "./config/cors.js";
import connectDB, { prisma } from "./config/db.js";
import connectCloudinary from "./config/cloudinary.js";
import { validateJwtConfig } from "./config/jwt.js";
import userRouter from "./routes/userRoute.js";
import productRouter from "./routes/productRoute.js";
import comboBundleRouter from "./routes/comboBundleRoute.js";
import collaborationRouter from "./routes/collaborationRoute.js";
import cartRouter from "./routes/cartRoute.js";
import orderRouter from "./routes/orderRoute.js";
import categoryRouter from "./routes/categoryRoute.js";
import subCategoryRouter from "./routes/subCategoryRoute.js";
import colorRouter from "./routes/colorRoute.js";
import reviewRouter from "./routes/reviewRoute.js";
import shippingRouter from "./routes/shippingRoute.js";
import loyaltyRouter from "./routes/loyaltyRoute.js";
import customerRouter from "./routes/customerRoute.js";
import offerRouter from "./routes/offerRoute.js";
import cogsRouter from "./routes/cogsRoute.js";
import financialRouter from "./routes/financialRoute.js";
import returnsRouter from "./routes/returnsRoute.js";
import accountingRouter from "./routes/accountingRoute.js";
import manufacturerRouter from "./routes/manufacturerRoute.js";
import manufacturerInventoryRouter from "./routes/manufacturerInventoryRoute.js";
import manufacturerProductionRouter from "./routes/manufacturerProductionRoute.js";
import orderAssignmentRouter from "./routes/orderAssignmentRoute.js";
import distributorRouter from "./routes/distributorRoute.js";
import adminDistributorApplicationRouter from "./routes/adminDistributorApplicationRoute.js";
import adminDistributorRateRouter, { adminDistributorFinanceRouter } from "./routes/adminDistributorRateRoute.js";
import adminManufacturerSettlementRouter from "./routes/adminManufacturerSettlementRoute.js";
import inventoryLedgerRouter from "./routes/inventoryLedgerRoute.js";
import stockTransferRouter from "./routes/stockTransferRoute.js";
import expenseRouter from "./routes/expenseRoute.js";
import deliveryRouter from "./routes/deliveryRoute.js";
import personalizedLetterRouter from "./routes/personalizedLetterRoute.js";
import storyLetterAdminRouter from "./routes/storyLetterAdminRoute.js";
import marketingCardRouter from "./routes/marketingCardRoute.js";
import authRouter from "./routes/authRoute.js";
import accessManagementRouter from "./routes/accessManagementRoute.js";
import locationPricingRouter from "./routes/locationPricingRoute.js";
import notificationRouter from "./routes/notificationRoute.js";
import { adminGiftRouter, distributorGiftRouter } from "./routes/giftRoute.js";
import sanitizeMiddleware from "./middleware/sanitize.js";
import { ensureStandardChartOfAccounts } from "./services/accountingPostingEngine.js";
import { startSystemAuditOutboxWorker } from "./services/auditService.js";
import { syncAllProductsStock } from "./services/stockSyncService.js";

// App Config
const app = express();
const port = process.env.PORT || 4000;

const startServer = async () => {
  validateJwtConfig();
  const connected = await connectDB();
  if (!connected) throw new Error("Database connection is required before startup.");
  await connectCloudinary();
  await ensureStandardChartOfAccounts();
  await syncAllProductsStock();
  startSystemAuditOutboxWorker();

  app.listen(port, () => {
    logger.info("Server started", { port });
  });
};

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(sanitizeMiddleware);
app.use((req, res, next) => {
  const suppliedId = String(req.headers["x-correlation-id"] || "").trim();
  req.correlationId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedId) ? suppliedId : randomUUID();
  res.setHeader("X-Correlation-ID", req.correlationId);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.once("finish", () => {
    const durationMs = Date.now() - start;
    logger.request(req, res, durationMs);
  });
  next();
});

const allowedOrigins = getAllowedOrigins();

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ALLOWED_CORS_HEADERS,
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

//  Api Endpoints
app.use("/api/auth", authRouter);
app.use("/api/distributor", distributorRouter);
app.use("/api/admin/distributor-applications", adminDistributorApplicationRouter);
app.use("/api/admin/distributor-rates", adminDistributorRateRouter);
app.use("/api/admin/distributor-finance", adminDistributorFinanceRouter);
app.use("/api/admin/finance", adminManufacturerSettlementRouter);
app.use("/api/admin/inventory-ledger", inventoryLedgerRouter);
app.use("/api/stock-transfers", stockTransferRouter);
app.use("/api/admin/access", accessManagementRouter);
app.use("/api/admin", locationPricingRouter);
app.use("/api/admin/gifts", adminGiftRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/distributor/gifts", distributorGiftRouter);
app.use("/api/user", userRouter);
app.use("/api/product", productRouter);
app.use("/api/combo-bundles", comboBundleRouter);
app.use("/api/collaborations", collaborationRouter);
app.use("/api/cart", cartRouter);
app.use("/api/order", orderRouter);
app.use("/api/category", categoryRouter);
app.use("/api/subcategory", subCategoryRouter);
app.use("/api/color", colorRouter);
app.use("/api/review", reviewRouter);
app.use("/api/shipping", shippingRouter);
app.use("/api/loyalty", loyaltyRouter);
app.use("/api/customer", customerRouter);
app.use("/api/offer", offerRouter);
app.use("/api/cogs", cogsRouter);
app.use("/api/finance", financialRouter);
app.use("/api/returns", returnsRouter);
app.use("/api/accounting", accountingRouter);
// Manufacturer system
app.use("/api/manufacturer", manufacturerRouter);
app.use("/api/manufacturer-inventory", manufacturerInventoryRouter);
app.use("/api/manufacturer-production", manufacturerProductionRouter);
app.use("/api/assignment", orderAssignmentRouter);
app.use("/api/order-assignment", orderAssignmentRouter);
app.use("/api/expense", expenseRouter);
app.use("/api/delivery", deliveryRouter);
app.use("/api/delivery-job", deliveryRouter);
app.use("/api/personalized-letter", personalizedLetterRouter);
app.use("/api/admin/story-letter", storyLetterAdminRouter);
app.use("/api/marketing-cards", marketingCardRouter);
app.use("/webhooks", deliveryRouter);
app.use("/api/ncm-webhook", deliveryRouter);

app.get("/", (req, res) => {
  res.send("API Working");
});

startServer().catch(async (error) => {
  logger.error("Server startup failed; the API will not listen.", {
    error: error.message,
    name: error.name,
  });
  await prisma.$disconnect().catch((disconnectError) => {
    console.error("Database disconnect after startup failure failed:", disconnectError.message);
  });
  await flushLogs().catch((flushError) => {
    console.error("Could not flush startup failure logs:", flushError.message);
  });
  process.exitCode = 1;
});
