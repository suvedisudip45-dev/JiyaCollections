import { prisma } from "../config/db.js";
import { postCustomerReturnAccounting } from "../services/accountingPostingEngine.js";
import { getPagination, paginatedResponse } from "../utils/pagination.js";

// ==========================================
// 1. CUSTOMER RETURNS (RMA & REFUNDS)
// ==========================================
export const createCustomerReturn = async (req, res) => {
  try {
    const {
      orderId,
      userId,
      customerName,
      customerPhone,
      items,
      refundMethod = "CASH",
      refundFromAccountId,
      recordAsPayable = false,
      reason,
      inventoryAction = "RESTOCKED", // RESTOCKED, WRITTEN_OFF_DAMAGED
      notes,
    } = req.body;

    if (!customerName || !items || !Array.isArray(items) || items.length === 0) {
      return res.json({ success: false, message: "Customer Name and valid items are required" });
    }

    let totalRefund = 0;
    const processedItems = [];

    for (const item of items) {
      const unitRefund = Number(item.refundAmount || item.unitPrice || 0);
      const qty = Number(item.quantity || 1);
      const lineRefund = unitRefund * qty;
      totalRefund += lineRefund;

      processedItems.push({
        productId: item.productId || item._id || item.id,
        name: item.name || "Returned Item",
        size: item.size || "",
        color: item.color || "",
        quantity: qty,
        unitPrice: Number(item.unitPrice || unitRefund),
        refundAmount: lineRefund,
        condition: item.condition || (inventoryAction === "WRITTEN_OFF_DAMAGED" ? "DAMAGED" : "RESTOCKABLE"),
      });
    }

    // 13% VAT portion embedded in refund
    const vatRefunded = Number((totalRefund - (totalRefund / 1.13)).toFixed(2));

    // Overdraft balance check if refunding immediately from cash account
    if (refundFromAccountId && !recordAsPayable && totalRefund > 0) {
      const refundAccount = await prisma.financialAccount.findUnique({ where: { id: refundFromAccountId } });
      if (!refundAccount) {
        return res.json({ success: false, message: "Selected refund account not found" });
      }
      if (refundAccount.currentBalance < totalRefund) {
        return res.json({
          success: false,
          message: `Insufficient liquid cash in ${refundAccount.accountName} (Balance: Rs ${refundAccount.currentBalance.toLocaleString()}) to pay refund of Rs ${totalRefund.toLocaleString()}. Select 'Record as Payable / Store Credit' to process RMA without immediate cash deduction.`,
        });
      }
    }

    // 1. Create Return Record
    const returnRecord = await prisma.customerReturn.create({
      data: {
        orderId: orderId || null,
        userId: userId || null,
        customerName: customerName.trim(),
        customerPhone: customerPhone || "",
        items: processedItems,
        totalRefundAmount: totalRefund,
        vatRefunded,
        refundMethod,
        refundStatus: "COMPLETED",
        inventoryAction,
        reason: reason || "Customer Return",
        notes: notes || null,
      },
    });

    // 2. Adjust Inventory based on item condition / action
    for (const item of processedItems) {
      if (item.productId) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (product) {
          if (item.condition === "RESTOCKABLE" || inventoryAction === "RESTOCKED") {
            const updatedStock = product.stockQuantity + item.quantity;
            
            let variants = [];
            if (typeof product.variants === "string") {
              try { variants = JSON.parse(product.variants); } catch { variants = []; }
            } else if (Array.isArray(product.variants)) {
              variants = product.variants;
            }

            if (variants.length > 0 && item.size && item.color) {
              variants = variants.map((v) => {
                if (v.size === item.size && v.color === item.color) {
                  return { ...v, quantity: (Number(v.quantity) || 0) + item.quantity };
                }
                return v;
              });
            }

            await prisma.product.update({
              where: { id: product.id },
              data: {
                stockQuantity: updatedStock,
                variants,
              },
            });

            await prisma.stockLog.create({
              data: {
                productId: product.id,
                productName: product.name,
                variantLabel: item.size && item.color ? `${item.size} / ${item.color}` : "",
                previousQty: product.stockQuantity,
                newQty: updatedStock,
                changeQty: item.quantity,
                reason: `Customer Return Restock (RMA #${returnRecord.id.slice(0, 8)})`,
                orderId: orderId || null,
                source: "return",
              },
            });
          } else {
            await prisma.stockLog.create({
              data: {
                productId: product.id,
                productName: product.name,
                variantLabel: item.size && item.color ? `${item.size} / ${item.color}` : "",
                previousQty: product.stockQuantity,
                newQty: product.stockQuantity,
                changeQty: 0,
                reason: `Customer Return Damaged Scrap Loss (RMA #${returnRecord.id.slice(0, 8)})`,
                orderId: orderId || null,
                note: `Written off as unsaleable damage: ${item.quantity} units`,
                source: "damage_scrap",
              },
            });
          }
        }
      }
    }

    // 3. Deduct from Treasury OR Record in Accounts Payable (Liability)
    if (refundFromAccountId && !recordAsPayable && totalRefund > 0) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: refundFromAccountId },
          data: { currentBalance: { decrement: totalRefund } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: totalRefund,
            type: "OUTFLOW",
            fromAccountId: refundFromAccountId,
            category: "REFUND",
            referenceId: returnRecord.id,
            description: `Customer Refund for RMA #${returnRecord.id.slice(0, 8)} (${customerName})`,
          },
        }),
      ]);
    } else if (totalRefund > 0) {
      // Record as Accounts Payable liability
      await prisma.accountPayable.create({
        data: {
          title: `Customer Refund: RMA #${returnRecord.id.slice(0, 8)} (${customerName})`,
          payeeName: customerName.trim(),
          category: "OPERATING_EXPENSE",
          referenceType: "CUSTOMER_REFUND",
          referenceId: returnRecord.id,
          totalAmount: totalRefund,
          paidAmount: 0,
          remainingBalance: totalRefund,
          status: "UNPAID",
          priority: "HIGH",
          notes: `Customer return refund due. Refund Method: ${refundMethod}. Phone: ${customerPhone || "N/A"}`,
        },
      });
    }

    // Post to Double-Entry General Ledger (Sales Returns & Allowances / Output VAT / Cash or AP)
    postCustomerReturnAccounting(returnRecord, {
      refundFromAccountId,
      recordAsPayable,
    }).catch((glErr) => {
      console.error("General Ledger customer return posting error:", glErr);
    });

    res.json({
      success: true,
      message: refundFromAccountId && !recordAsPayable
        ? "Customer return processed and refund deducted from liquid treasury"
        : "Customer return processed and refund recorded under Accounts Payable (Liability)",
      returnRecord,
    });
  } catch (error) {
    console.error("Create Customer Return Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getCustomerReturns = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const [returns, total] = await prisma.$transaction([
      prisma.customerReturn.findMany({ orderBy: { returnDate: "desc" }, skip: pagination.skip, take: pagination.limit }),
      prisma.customerReturn.count(),
    ]);
    res.json(paginatedResponse("returns", returns, pagination, total));
  } catch (error) {
    console.error("Get Customer Returns Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const updateCustomerReturnStatus = async (req, res) => {
  try {
    const { id, refundStatus } = req.body;
    const updated = await prisma.customerReturn.update({
      where: { id },
      data: { refundStatus },
    });
    res.json({ success: true, message: "Status updated", returnRecord: updated });
  } catch (error) {
    console.error("Update Customer Return Status Error:", error);
    res.json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. SUPPLIER RETURNS (DEBIT NOTES & RECEIVABLES)
// ==========================================
export const createSupplierReturn = async (req, res) => {
  try {
    const {
      shipmentBatchId,
      supplierName,
      items,
      settlementType = "CREDIT_NOTE_OFFSET_PAYABLE", // CASH_REFUND, CREDIT_NOTE_OFFSET_PAYABLE
      depositAccountId,
      reason,
      notes,
    } = req.body;

    if (!supplierName || !items || !Array.isArray(items) || items.length === 0) {
      return res.json({ success: false, message: "Supplier Name and valid items are required" });
    }

    let totalDebit = 0;
    const processedItems = [];

    for (const item of items) {
      const unitCost = Number(item.unitCostPrice || 0);
      const qty = Number(item.quantity || 1);
      const lineDebit = unitCost * qty;
      totalDebit += lineDebit;

      processedItems.push({
        productId: item.productId || item._id || item.id,
        name: item.name || "Returned Product",
        quantity: qty,
        unitCostPrice: unitCost,
        totalDebitCost: lineDebit,
      });
    }

    const vatReversal = Number((totalDebit - (totalDebit / 1.13)).toFixed(2));

    // 1. Create Supplier Return Record (Debit Note)
    const supplierReturnRecord = await prisma.supplierReturn.create({
      data: {
        shipmentBatchId: shipmentBatchId || null,
        supplierName: supplierName.trim(),
        items: processedItems,
        totalDebitAmount: totalDebit,
        vatReversal,
        settlementType,
        status: "COMPLETED",
        reason: reason || "Defective batch / Supplier Return",
        notes: notes || null,
      },
    });

    // 2. Reduce product inventory
    for (const item of processedItems) {
      if (item.productId) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (product) {
          const newQty = Math.max(0, product.stockQuantity - item.quantity);
          await prisma.product.update({
            where: { id: product.id },
            data: { stockQuantity: newQty },
          });

          await prisma.stockLog.create({
            data: {
              productId: product.id,
              productName: product.name,
              previousQty: product.stockQuantity,
              newQty,
              changeQty: -item.quantity,
              reason: `Supplier Return / Debit Note #${supplierReturnRecord.id.slice(0, 8)} (${supplierName})`,
              source: "supplier_return",
            },
          });
        }
      }
    }

    // 3. Deposit to Treasury OR Record in Accounts Receivable
    if (settlementType === "CASH_REFUND" && depositAccountId && totalDebit > 0) {
      await prisma.$transaction([
        prisma.financialAccount.update({
          where: { id: depositAccountId },
          data: { currentBalance: { increment: totalDebit } },
        }),
        prisma.cashTransaction.create({
          data: {
            amount: totalDebit,
            type: "INFLOW",
            toAccountId: depositAccountId,
            category: "SUPPLIER_PAYMENT",
            referenceId: supplierReturnRecord.id,
            description: `Supplier Cash Refund for Debit Note #${supplierReturnRecord.id.slice(0, 8)} (${supplierName})`,
          },
        }),
      ]);
    } else if (totalDebit > 0) {
      // Record as Accounts Receivable asset
      await prisma.accountReceivable.create({
        data: {
          title: `Supplier Credit Note: Debit Note #${supplierReturnRecord.id.slice(0, 8)} (${supplierName})`,
          payerName: supplierName.trim(),
          category: "SUPPLIER_DEBIT_REFUND",
          referenceType: "SUPPLIER_RETURN",
          referenceId: supplierReturnRecord.id,
          totalAmount: totalDebit,
          receivedAmount: 0,
          remainingBalance: totalDebit,
          status: "UNPAID",
          notes: `Credit note receivable from supplier ${supplierName}. Offset against next inventory invoice or collect into liquid cash.`,
        },
      });
    }

    res.json({
      success: true,
      message: settlementType === "CASH_REFUND" && depositAccountId
        ? "Supplier return processed and cash refunded into treasury"
        : "Supplier return processed and registered under Accounts Receivable (Credit Note)",
      supplierReturnRecord,
    });
  } catch (error) {
    console.error("Create Supplier Return Error:", error);
    res.json({ success: false, message: error.message });
  }
};

export const getSupplierReturns = async (req, res) => {
  try {
    const pagination = getPagination(req.query);
    const [returns, total] = await prisma.$transaction([
      prisma.supplierReturn.findMany({ orderBy: { returnDate: "desc" }, skip: pagination.skip, take: pagination.limit }),
      prisma.supplierReturn.count(),
    ]);
    res.json(paginatedResponse("returns", returns, pagination, total));
  } catch (error) {
    console.error("Get Supplier Returns Error:", error);
    res.json({ success: false, message: error.message });
  }
};
