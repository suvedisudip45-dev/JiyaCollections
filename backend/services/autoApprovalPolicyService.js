import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";

/**
 * Baseline default policy configurations.
 */
export const DEFAULT_APPROVAL_POLICIES = [
  {
    module: "STOCK_TRANSFER",
    ruleName: "Standard Low-Risk Replenishment",
    conditions: {
      maxTotalUnits: 50,
      minDistributorRating: 4.0,
      requireFactoryStockMarginPct: 120, // Factory has at least 120% of requested qty
    },
    action: "AUTO_APPROVE",
    priority: 1,
    isActive: true,
  },
  {
    module: "CUSTOMER_RETURN",
    ruleName: "Standard 7-Day Size/Defect Return",
    conditions: {
      maxReturnWindowDays: 7,
      maxRefundAmountNPR: 5000,
      allowedReasons: ["SIZE_EXCHANGE", "DEFECTIVE", "DAMAGED_IN_DELIVERY"],
      requireEvidence: true,
    },
    action: "AUTO_APPROVE",
    priority: 1,
    isActive: true,
  },
  {
    module: "COD_OFFSET",
    ruleName: "Exact Net Bilateral Offset",
    conditions: {
      maxVarianceNPR: 0,
      requireVerifiedRefundDocuments: true,
    },
    action: "AUTO_APPROVE",
    priority: 1,
    isActive: true,
  },
];

/**
 * Seeds baseline approval policies if none exist in the database.
 */
export const ensureDefaultApprovalPolicies = async (client = prisma) => {
  for (const policy of DEFAULT_APPROVAL_POLICIES) {
    const existing = await client.approvalPolicyRule.findFirst({
      where: { module: policy.module, ruleName: policy.ruleName },
    });
    if (!existing) {
      await client.approvalPolicyRule.create({
        data: policy,
      });
      logger.info(`Seeded default approval policy for ${policy.module}: ${policy.ruleName}`);
    }
  }
};

/**
 * Evaluates whether a Stock Transfer Request can be auto-approved.
 */
export const evaluateStockTransferAutoApproval = async ({
  distributorId,
  manufacturerId,
  requestedLines = [],
  factoryBalances = [],
  client = prisma,
}) => {
  try {
    const rules = await client.approvalPolicyRule.findMany({
      where: { module: "STOCK_TRANSFER", isActive: true },
      orderBy: { priority: "asc" },
    });

    if (rules.length === 0) {
      return { shouldAutoApprove: false, reason: "No active auto-approval policies found." };
    }

    const totalUnits = requestedLines.reduce((sum, line) => sum + Number(line.requestedQuantity || 0), 0);
    const balanceMap = new Map(factoryBalances.map((b) => [b.inventorySkuId, b]));

    for (const rule of rules) {
      const cond = rule.conditions || {};
      const maxUnits = cond.maxTotalUnits ?? 50;

      // 1. Check quantity threshold
      if (totalUnits > maxUnits) {
        continue; // Exceeds threshold for this rule
      }

      // 2. Check stock margin (must have enough unreserved stock)
      let hasEnoughStock = true;
      for (const line of requestedLines) {
        const bal = balanceMap.get(line.inventorySkuId);
        const available = bal ? bal.quantityOnHand - bal.reservedQuantity : 0;
        if (available < line.requestedQuantity) {
          hasEnoughStock = false;
          break;
        }
      }

      if (!hasEnoughStock) {
        return { shouldAutoApprove: false, reason: "Factory inventory is insufficient for requested SKUs." };
      }

      // 3. Check distributor rating
      if (distributorId) {
        const distributor = await client.distributor.findUnique({
          where: { id: distributorId },
          select: { qualityRating: true, status: true },
        });

        const minRating = cond.minDistributorRating ?? 4.0;
        if (distributor && Number(distributor.qualityRating || 5.0) < minRating) {
          return { shouldAutoApprove: false, reason: `Distributor quality rating below threshold (${minRating}).` };
        }
      }

      if (rule.action === "AUTO_APPROVE") {
        return {
          shouldAutoApprove: true,
          ruleName: rule.ruleName,
          reason: `Auto-approved under policy '${rule.ruleName}' (Quantity: ${totalUnits} units <= ${maxUnits}).`,
        };
      }
    }

    return { shouldAutoApprove: false, reason: "Request does not meet any auto-approval policy criteria." };
  } catch (error) {
    logger.warn("Error evaluating stock transfer auto-approval", { error: error.message });
    return { shouldAutoApprove: false, reason: error.message };
  }
};

/**
 * Evaluates whether a Customer Return (RMA) can be auto-approved.
 */
export const evaluateCustomerReturnAutoApproval = async ({
  order,
  reasonCode,
  refundAmount,
  hasEvidence = false,
  client = prisma,
}) => {
  try {
    const rules = await client.approvalPolicyRule.findMany({
      where: { module: "CUSTOMER_RETURN", isActive: true },
      orderBy: { priority: "asc" },
    });

    if (rules.length === 0) {
      return { shouldAutoApprove: false, reason: "No active return policies." };
    }

    const orderDeliveryDate = order?.deliveredAt ? new Date(order.deliveredAt) : (order?.updatedAt || new Date());
    const daysSinceDelivery = Math.max(0, (Date.now() - orderDeliveryDate.getTime()) / (1000 * 60 * 60 * 24));
    const amount = Number(refundAmount || 0);

    for (const rule of rules) {
      const cond = rule.conditions || {};
      const maxDays = cond.maxReturnWindowDays ?? 7;
      const maxAmt = cond.maxRefundAmountNPR ?? 5000;
      const allowedReasons = cond.allowedReasons || ["SIZE_EXCHANGE", "DEFECTIVE", "DAMAGED_IN_DELIVERY"];

      if (daysSinceDelivery > maxDays) continue;
      if (amount > maxAmt) continue;
      if (!allowedReasons.includes(String(reasonCode || "").toUpperCase())) continue;
      if (cond.requireEvidence && !hasEvidence && ["DEFECTIVE", "DAMAGED_IN_DELIVERY"].includes(reasonCode)) {
        continue;
      }

      if (rule.action === "AUTO_APPROVE") {
        return {
          shouldAutoApprove: true,
          ruleName: rule.ruleName,
          reason: `Auto-approved return: Delivered ${daysSinceDelivery.toFixed(1)} days ago (<= ${maxDays}d), amount Rs ${amount} (<= Rs ${maxAmt}).`,
        };
      }
    }

    return { shouldAutoApprove: false, reason: "Return request falls outside automated policy thresholds." };
  } catch (error) {
    logger.warn("Error evaluating customer return auto-approval", { error: error.message });
    return { shouldAutoApprove: false, reason: error.message };
  }
};
