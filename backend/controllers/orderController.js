import { prisma } from "../config/db.js";
import { calculateUserLoyalty } from "./loyaltyController.js";
import {
  postSalesOrderAccounting,
  postCustomerPaymentAccounting,
} from "../services/accountingPostingEngine.js";
import { runAllocationEngine } from "./orderAssignmentController.js";
import { resolveDistrictShippingFee } from "./shippingController.js";
import { createInactiveSocialCustomerProfile } from "./userController.js";

// global variables
const deliveryCharge = 50;

// Helper to validate stock before order placement
const validateOrderStock = (items, dbProducts) => {
  for (const cartItem of items) {
    const pId = cartItem._id || cartItem.id || cartItem.productId;
    const matchedProduct = dbProducts.find((p) => p.id === pId);
    if (!matchedProduct) {
      return { valid: false, message: `Product not found: ${cartItem.name || pId}` };
    }

    const orderedQty = Math.max(1, Number(cartItem.quantity || 1));
    let parsedVariants = typeof matchedProduct.variants === "string"
      ? JSON.parse(matchedProduct.variants || "[]")
      : (matchedProduct.variants || []);
    if (!Array.isArray(parsedVariants)) parsedVariants = [];

    const itemSize = (cartItem.size || "").trim().toLowerCase();
    const itemColor = (cartItem.color || "").trim().toLowerCase();

    if (parsedVariants.length > 0) {
      let matchedVariant = null;
      if (itemSize && itemColor) {
        matchedVariant = parsedVariants.find(
          (v) => (v.size || "").trim().toLowerCase() === itemSize &&
                 (v.color || "").trim().toLowerCase() === itemColor
        );
      } else if (itemSize) {
        matchedVariant = parsedVariants.find(
          (v) => (v.size || "").trim().toLowerCase() === itemSize
        );
      } else if (itemColor) {
        matchedVariant = parsedVariants.find(
          (v) => (v.color || "").trim().toLowerCase() === itemColor
        );
      }

      if (matchedVariant) {
        const varQty = Number(matchedVariant.quantity ?? 0);
        if (varQty <= 0) {
          return {
            valid: false,
            message: `Product "${matchedProduct.name}" (${cartItem.size || ""}${cartItem.color ? ` / ${cartItem.color}` : ""}) is out of stock.`,
          };
        }
        if (orderedQty > varQty) {
          return {
            valid: false,
            message: `Requested quantity (${orderedQty}) for "${matchedProduct.name}" (${cartItem.size || ""}${cartItem.color ? ` / ${cartItem.color}` : ""}) exceeds available stock (${varQty}).`,
          };
        }
      } else {
        const totalVarStock = parsedVariants.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
        if (totalVarStock <= 0) {
          return {
            valid: false,
            message: `Product "${matchedProduct.name}" is completely out of stock.`,
          };
        }
        if (orderedQty > totalVarStock) {
          return {
            valid: false,
            message: `Requested quantity (${orderedQty}) for "${matchedProduct.name}" exceeds available stock (${totalVarStock}).`,
          };
        }
      }
    } else {
      const stock = Number(matchedProduct.stockQuantity ?? 0);
      if (stock <= 0) {
        return {
          valid: false,
          message: `Product "${matchedProduct.name}" is out of stock.`,
        };
      }
      if (orderedQty > stock) {
        return {
          valid: false,
          message: `Requested quantity (${orderedQty}) for "${matchedProduct.name}" exceeds available stock (${stock}).`,
        };
      }
    }
  }
  return { valid: true };
};

// Placing orders using COD Method with Immutable Price Snapshot
const placeOrder = async (req, res) => {
  try {
    const { userId, items, address } = req.body;

    if (!items || items.length === 0) {
      return res.json({ success: false, message: "No items in order" });
    }

    // Extract product IDs and query current DB records to freeze price snapshots
    const productIds = items.map((i) => i._id || i.id || i.productId).filter(Boolean);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    // Validate stock before proceeding
    const stockValidation = validateOrderStock(items, dbProducts);
    if (!stockValidation.valid) {
      return res.json({ success: false, message: stockValidation.message });
    }

    const frozenItemsSnapshot = items.map((cartItem) => {
      const pId = cartItem._id || cartItem.id;
      const matchedProduct = dbProducts.find((p) => p.id === pId);

      const originalUnitPrice = matchedProduct ? matchedProduct.price : Number(cartItem.price || 0);
      const discountPercentage = matchedProduct ? (matchedProduct.discount || 0) : Number(cartItem.discount || 0);

      const purchasedUnitPrice = discountPercentage > 0
        ? Math.round(originalUnitPrice * (1 - discountPercentage / 100))
        : originalUnitPrice;

      const qty = Number(cartItem.quantity || 1);

      return {
        ...cartItem,
        _id: pId,
        productId: pId,
        name: matchedProduct ? matchedProduct.name : (cartItem.name || "Product"),
        image: matchedProduct ? matchedProduct.image : (cartItem.image || []),
        category: matchedProduct ? matchedProduct.category : (cartItem.category || ""),
        subCategory: matchedProduct ? matchedProduct.subCategory : (cartItem.subCategory || ""),
        size: cartItem.size,
        quantity: qty,
        originalUnitPrice: originalUnitPrice,
        discountPercentage: discountPercentage,
        offerTag: matchedProduct?.offerTag || cartItem.offerTag || "",
        offerTitle: matchedProduct?.offerTitle || cartItem.offerTitle || "",
        purchasedUnitPrice: purchasedUnitPrice, // Price snapshot frozen at purchase time
        price: purchasedUnitPrice, // Standardized unit price snapshot
        lineTotal: purchasedUnitPrice * qty,
      };
    });

    const itemsTotal = frozenItemsSnapshot.reduce((acc, item) => acc + item.lineTotal, 0);
    
    // Resolve dynamic shipping charge from ShippingConfig (authoritative backend calculation)
    let expectedFee = deliveryCharge;
    try {
      const customerDistrict = address?.district || address?.city || "";
      const customerProvince = address?.state || address?.province || "";
      const shippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: itemsTotal,
      });
      expectedFee = shippingResult.fee;
    } catch (cfgErr) {
      console.error("Error calculating district shipping fee in placeOrder:", cfgErr);
    }

    // Check user loyalty level and reward eligibility
    let loyaltyDiscount = 0;
    let rewardApplied = null;
    try {
      if (userId) {
        const loyaltyStatus = await calculateUserLoyalty(userId);
        if (loyaltyStatus?.activeReward?.isEligible) {
          const act = loyaltyStatus.activeReward;

          if (act.freeShipping) {
            expectedFee = 0;
          }

          if (act.discountAmount > 0) {
            loyaltyDiscount = Math.min(itemsTotal, Number(act.discountAmount));
          }

          rewardApplied = {
            freeShipping: Boolean(act.freeShipping),
            discountAmount: loyaltyDiscount,
            giftAmount: act.giftAmount || 0,
            giftDescription: act.giftDescription || "",
            letterIncluded: Boolean(act.letterIncluded),
            customPerk: act.customPerk || "",
            levelName: loyaltyStatus.currentLevel.name,
            levelIcon: loyaltyStatus.currentLevel.badgeIcon,
            title: act.title || "VIP Reward",
            usage: `Use ${act.currentUseIndex} of ${act.orderLimit}`,
          };
        }
      }
    } catch (loyErr) {
      console.error("Error applying loyalty reward:", loyErr);
    }

    // Price-lock: Backend authoritative fee is locked into order amount and deliveryFee
    const resolvedFee = expectedFee;
    const finalAmount = Math.max(0, itemsTotal + resolvedFee - loyaltyDiscount);

    const orderData = {
      userId,
      items: frozenItemsSnapshot,
      amount: finalAmount,
      deliveryFee: resolvedFee,
      paymentMethod: "COD",
      payment: false,
      date: BigInt(Date.now()),
      address,
      loyaltyDiscount,
      rewardApplied: rewardApplied ? JSON.stringify(rewardApplied) : "{}",
    };

    const createdOrder = await prisma.order.create({ data: orderData });

    // Post to Double-Entry General Ledger (Sales Invoice / AR / Output VAT)
    postSalesOrderAccounting(createdOrder).catch((glErr) => {
      console.error("General Ledger sales order posting error:", glErr);
    });

    // Update user cart and saved addresses
    try {
      const userRecord = await prisma.user.findUnique({ where: { id: userId } });
      if (userRecord) {
        let addresses = [];
        if (Array.isArray(userRecord.addresses)) addresses = userRecord.addresses;
        else if (typeof userRecord.addresses === "string") {
          try {
            addresses = JSON.parse(userRecord.addresses);
          } catch {
            addresses = [];
          }
        }

        const newAddr = {
          ...address,
          id: Date.now().toString(),
          createdAt: Date.now(),
        };

        const existingIdx = addresses.findIndex(
          (a) =>
            a.city === address.city &&
            a.street === address.street &&
            a.state === address.state
        );

        if (existingIdx !== -1) {
          addresses[existingIdx] = { ...addresses[existingIdx], ...newAddr };
        } else {
          addresses = [newAddr, ...addresses].slice(0, 5);
        }

        await prisma.user.update({
          where: { id: userId },
          data: { cartData: {}, addresses },
        });
      }
    } catch (addrErr) {
      console.error("Error saving address to user profile:", addrErr);
      await prisma.user.update({
        where: { id: userId },
        data: { cartData: {} },
      });
    }

    // Aggregate all requested items by product ID and variant
    const productDeductions = {};
    for (const cartItem of frozenItemsSnapshot) {
      const pId = cartItem.productId || cartItem._id;
      const orderedQty = Number(cartItem.quantity || 1);
      if (!pId) continue;

      if (!productDeductions[pId]) {
        productDeductions[pId] = {
          totalQty: 0,
          variantDeductions: [],
        };
      }
      productDeductions[pId].totalQty += orderedQty;

      if (cartItem.size && cartItem.color) {
        productDeductions[pId].variantDeductions.push({
          size: cartItem.size,
          color: cartItem.color,
          quantity: orderedQty,
        });
      }
    }

    // Safely apply aggregated stock deduction per product in DB
    for (const [pId, deduction] of Object.entries(productDeductions)) {
      const currentProd = await prisma.product.findUnique({ where: { id: pId } });
      if (!currentProd) continue;

      let updateData = {};
      let parsedVariants = typeof currentProd.variants === "string"
        ? JSON.parse(currentProd.variants || "[]")
        : (currentProd.variants || []);

      const hasVariants = Array.isArray(parsedVariants) && parsedVariants.length > 0;

      if (hasVariants && deduction.variantDeductions.length > 0) {
        for (const vd of deduction.variantDeductions) {
          const vIdx = parsedVariants.findIndex(
            (v) =>
              (v.size || "").trim().toLowerCase() === (vd.size || "").trim().toLowerCase() &&
              (v.color || "").trim().toLowerCase() === (vd.color || "").trim().toLowerCase()
          );
          if (vIdx !== -1) {
            const currentVariantQty = Number(parsedVariants[vIdx].quantity || 0);
            parsedVariants[vIdx].quantity = Math.max(0, currentVariantQty - vd.quantity);
          }
        }
        updateData.variants = parsedVariants;

        // Synchronize stockQuantity to the total remaining across all variants
        const totalVariantStock = parsedVariants.reduce(
          (acc, v) => acc + (Number(v.quantity) || 0),
          0
        );
        updateData.stockQuantity = totalVariantStock;
      } else if (
        currentProd.stockQuantity !== undefined &&
        currentProd.stockQuantity !== null
      ) {
        const newStock = Math.max(0, Number(currentProd.stockQuantity) - deduction.totalQty);
        updateData.stockQuantity = newStock;
      }

      await prisma.product.update({
        where: { id: pId },
        data: updateData,
      });

      // Record StockLog entry
      try {
        const finalQty = updateData.stockQuantity !== undefined ? updateData.stockQuantity : (currentProd.stockQuantity || 0);
        await prisma.stockLog.create({
          data: {
            productId: pId,
            productName: currentProd.name,
            variantLabel: deduction.variantDeductions.length > 0
              ? deduction.variantDeductions.map((v) => `${v.size}/${v.color}`).join(", ")
              : null,
            previousQty: currentProd.stockQuantity || 0,
            newQty: finalQty,
            changeQty: -deduction.totalQty,
            reason: "order_sale",
            note: "Website Customer Order",
            source: "website",
          },
        });
      } catch (logErr) {
        console.error("StockLog creation failed in placeOrder:", logErr);
      }
    }

    // Trigger allocation engine asynchronously (non-blocking)
    runAllocationEngine(createdOrder.id).then((result) => {
      if (!result.success) {
        console.warn(`[Allocation] Order ${createdOrder.id} could not be auto-assigned: ${result.message}`);
      } else {
        console.log(`[Allocation] Order ${createdOrder.id} assigned to manufacturer ${result.assignment?.manufacturerId}`);
      }
    }).catch((err) => {
      console.error("[Allocation] Engine error:", err);
    });

    res.json({ success: true, message: "Order Placed Successfully" });

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// All Orders data for Admin Panel (monitor all orders - read-only context)
const allOrders = async (req, res) => {
  try {
    const rawOrders = await prisma.order.findMany({
      orderBy: { date: "desc" },
      include: {
        deliveryOrder: {
          select: {
            id: true,
            ncmOrderId: true,
            state: true,
            ncmStatus: true,
            vendorReference: true,
            originBranchName: true,
            destinationBranchName: true,
            pickedUpAt: true,
            deliveredAt: true,
          },
        },
      },
    });
    const orders = rawOrders.map((item) => ({
      ...item,
      _id: item.id,
      date: Number(item.date),
      delivery: item.deliveryOrder || null,
    }));
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

/**
 * Returns ONLY admin-created orders (Social Media / Phone / Manual orders created by admin).
 * These are the orders admin can operationally manage (status transitions, cash received, etc.).
 */
const allAdminOrders = async (req, res) => {
  try {
    const rawOrders = await prisma.order.findMany({
      orderBy: { date: "desc" },
      include: {
        deliveryOrder: {
          select: {
            id: true,
            ncmOrderId: true,
            state: true,
            ncmStatus: true,
            vendorReference: true,
            originBranchName: true,
            destinationBranchName: true,
            pickedUpAt: true,
            deliveredAt: true,
          },
        },
      },
    });

    const adminOrders = rawOrders.filter((order) => {
      // Check orderType field first
      if (order.orderType === "ADMIN_DIRECT") return true;
      // Check rewardApplied JSON flag (older format)
      try {
        const reward =
          typeof order.rewardApplied === "string"
            ? JSON.parse(order.rewardApplied)
            : order.rewardApplied;
        if (reward && reward.adminCreated === true) return true;
      } catch {}
      return false;
    });

    const orders = adminOrders.map((item) => ({
      ...item,
      _id: item.id,
      date: Number(item.date),
      delivery: item.deliveryOrder || null,
    }));
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// User Order Data For Frontend
const userOrders = async (req, res) => {
  try {
    const { userId } = req.body;
    const rawOrders = await prisma.order.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      include: {
        deliveryOrder: {
          select: {
            id: true,
            ncmOrderId: true,
            state: true,
            ncmStatus: true,
            vendorReference: true,
            originBranchName: true,
            destinationBranchName: true,
            pickedUpAt: true,
            deliveredAt: true,
          },
        },
      },
    });
    const orders = rawOrders.map((item) => ({
      ...item,
      _id: item.id,
      date: Number(item.date),
      delivery: item.deliveryOrder || null,
    }));
    res.json({ success: true, orders });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// update order status from Admin Panel
// GUARD: Admin can ONLY update status of orders they directly created.
// Website/storefront orders are managed exclusively by assigned manufacturer hubs.
const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }

    // Check if this is an admin-created order
    let isAdminCreated = order.orderType === "ADMIN_DIRECT";
    if (!isAdminCreated) {
      try {
        const reward =
          typeof order.rewardApplied === "string"
            ? JSON.parse(order.rewardApplied)
            : order.rewardApplied;
        if (reward && reward.adminCreated === true) isAdminCreated = true;
      } catch {}
    }

    if (!isAdminCreated) {
      return res.json({
        success: false,
        message:
          "Access denied: Website and storefront orders are managed exclusively by the assigned manufacturer hub. Admin can only update orders they directly created.",
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status },
    });
    res.json({ success: true, message: "Status Updated" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const cashReceived = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }
    if (order.status !== "Delivered") {
      return res.json({ success: false, message: "Order not delivered yet" });
    }
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { payment: true },
    });

    // Post Customer Payment to Double-Entry General Ledger (DR Liquid Cash, CR Accounts Receivable)
    postCustomerPaymentAccounting(updatedOrder).catch((glErr) => {
      console.error("General Ledger payment posting error:", glErr);
    });

    res.json({ success: true, message: "Cash marked as received" });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

// Admin Create Order for Social Media & Manual Phone Inquiries
const adminCreateOrder = async (req, res) => {
  try {
    const {
      client,
      items,
      discount = 0,
      deliveryFee,
      paymentMethod = "COD",
      payment = false,
      status = "Order Placed",
    } = req.body;

    if (!client || !client.firstName || !client.phone) {
      return res.json({
        success: false,
        message: "Customer first name and contact phone number are required",
      });
    }

    if (!items || items.length === 0) {
      return res.json({
        success: false,
        message: "Please select at least one product for the order",
      });
    }

    // Extract product IDs and query current DB records to freeze price snapshots
    const productIds = items.map((i) => i._id || i.id || i.productId).filter(Boolean);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    // Validate stock before proceeding
    const stockValidation = validateOrderStock(items, dbProducts);
    if (!stockValidation.valid) {
      return res.json({ success: false, message: stockValidation.message });
    }

    // Freeze snapshot of items
    const frozenItemsSnapshot = items.map((cartItem) => {
      const pId = cartItem._id || cartItem.id || cartItem.productId;
      const matchedProduct = dbProducts.find((p) => p.id === pId);

      const originalUnitPrice = matchedProduct
        ? matchedProduct.price
        : Number(cartItem.originalUnitPrice || cartItem.price || 0);
      const discountPercentage = matchedProduct
        ? matchedProduct.discount || 0
        : Number(cartItem.discountPercentage || 0);

      const calculatedUnit =
        discountPercentage > 0
          ? Math.round(originalUnitPrice * (1 - discountPercentage / 100))
          : originalUnitPrice;

      const purchasedUnitPrice =
        cartItem.purchasedUnitPrice !== undefined
          ? Number(cartItem.purchasedUnitPrice)
          : cartItem.price !== undefined
          ? Number(cartItem.price)
          : calculatedUnit;

      const qty = Number(cartItem.quantity || 1);

      return {
        ...cartItem,
        _id: pId,
        productId: pId,
        name: matchedProduct ? matchedProduct.name : cartItem.name || "Product",
        image: matchedProduct ? matchedProduct.image : cartItem.image || [],
        category: matchedProduct ? matchedProduct.category : cartItem.category || "",
        subCategory: matchedProduct ? matchedProduct.subCategory : cartItem.subCategory || "",
        size: cartItem.size || "",
        color: cartItem.color || "",
        quantity: qty,
        originalUnitPrice: originalUnitPrice,
        discountPercentage: discountPercentage,
        purchasedUnitPrice: purchasedUnitPrice,
        price: purchasedUnitPrice,
        lineTotal: purchasedUnitPrice * qty,
      };
    });

    const itemsTotal = frozenItemsSnapshot.reduce((acc, item) => acc + item.lineTotal, 0);

    // Dynamic shipping calculation according to shipment rates (ShippingConfig)
    let expectedFee = 50;
    try {
      const customerDistrict = client.district || client.city || "";
      const customerProvince = client.state || client.province || "";
      const shippingResult = await resolveDistrictShippingFee({
        district: customerDistrict,
        province: customerProvince,
        subtotal: itemsTotal,
      });
      expectedFee = shippingResult.fee;
    } catch (cfgErr) {
      console.error("Error calculating shipping config in admin order:", cfgErr);
    }

    const resolvedFee =
      deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== ""
        ? Math.max(0, Number(deliveryFee))
        : expectedFee;

    const manualDiscount = Math.max(0, Number(discount) || 0);
    const finalAmount = Math.max(0, itemsTotal + resolvedFee - manualDiscount);

    // Associate userId: check if a user with client's email exists
    let orderUserId = "admin_social_client";
    if (client.email && client.email.trim()) {
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: client.email.trim().toLowerCase() },
        });
        if (existingUser) {
          orderUserId = existingUser.id;
        }
      } catch (e) {
        console.error("Error checking user for admin order:", e);
      }
    }

    const isSocialOrder = /social|instagram|facebook|whatsapp|tiktok|messenger|phone/i.test(
      String(client.source || "Social Media")
    );

    let socialCustomerProfile = null;
    if (isSocialOrder && client.phone) {
      try {
        socialCustomerProfile = await createInactiveSocialCustomerProfile({
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
          email: client.email,
          gender: client.gender,
          province: client.province || client.state || "Bagmati Province",
          district: client.district || client.city || "Kathmandu",
          city: client.city || client.ncmBranch || client.district || "Kathmandu",
          ncmBranch: client.ncmBranch || client.city || client.district || "Kathmandu",
          state: client.state || client.province || "Bagmati Province",
          country: client.country || "Nepal",
          address: {
            firstName: client.firstName,
            lastName: client.lastName,
            phone: client.phone,
            province: client.province || client.state || "Bagmati Province",
            district: client.district || client.city || "Kathmandu",
            city: client.city || client.ncmBranch || client.district || "Kathmandu",
            ncmBranch: client.ncmBranch || client.city || client.district || "Kathmandu",
            state: client.state || client.province || "Bagmati Province",
            country: client.country || "Nepal",
            street: client.street || "",
            landmark: client.landmark || "",
            zipcode: client.zipcode || "44600",
          },
          socialUsername: client.socialUsername || "",
          source: client.source || "Social Media",
          loyaltyTier: client.loyaltyTier || "",
          orderId: "",
        });

        if (socialCustomerProfile?.success && socialCustomerProfile.user) {
          orderUserId = socialCustomerProfile.user.id;
        }
      } catch (profileErr) {
        console.error("Error creating inactive social customer profile in admin order:", profileErr);
      }
    }

    const addressSnapshot = {
      firstName: client.firstName.trim(),
      lastName: (client.lastName || "").trim(),
      email: (client.email || "").trim(),
      phone: client.phone.trim(),
      gender: client.gender || "PREFER_NOT_TO_SAY",
      street: client.street || "",
      landmark: client.landmark || "",
      province: client.province || client.state || "Bagmati Province",
      district: client.district || client.city || "Kathmandu",
      city: client.city || client.ncmBranch || client.district || "Kathmandu",
      ncmBranch: client.ncmBranch || client.city || client.district || "Kathmandu",
      state: client.state || client.province || "Bagmati Province",
      zipcode: client.zipcode || "44600",
      country: client.country || "Nepal",
      source: client.source || "Social Media",
      socialUsername: client.socialUsername || "",
      orderNotes: client.orderNotes || "",
    };

    const newOrder = await prisma.order.create({
      data: {
        userId: orderUserId,
        items: frozenItemsSnapshot,
        amount: finalAmount,
        deliveryFee: resolvedFee,
        paymentMethod: paymentMethod || "COD",
        payment: Boolean(payment),
        status: status || "Order Placed",
        date: BigInt(Date.now()),
        address: addressSnapshot,
        loyaltyDiscount: manualDiscount,
        orderType: "ADMIN_DIRECT", // Mark as admin-created for guard in updateStatus
        rewardApplied: JSON.stringify({
          source: client.source || "Social Media",
          manualDiscount,
          deliveryFee: resolvedFee,
          adminCreated: true,
        }),
      },
    });


    // Post to Double-Entry General Ledger (Sales & optional Instant Payment)
    postSalesOrderAccounting(newOrder).catch((glErr) => {
      console.error("General Ledger admin sales order posting error:", glErr);
    });

    if (newOrder.payment) {
      postCustomerPaymentAccounting(newOrder).catch((glErr) => {
        console.error("General Ledger admin payment posting error:", glErr);
      });
    }

    // Deduct stock
    const productDeductions = {};
    for (const cartItem of frozenItemsSnapshot) {
      const pId = cartItem.productId || cartItem._id;
      const orderedQty = Number(cartItem.quantity || 1);
      if (!pId) continue;

      if (!productDeductions[pId]) {
        productDeductions[pId] = {
          totalQty: 0,
          variantDeductions: [],
        };
      }
      productDeductions[pId].totalQty += orderedQty;

      if (cartItem.size && cartItem.color) {
        productDeductions[pId].variantDeductions.push({
          size: cartItem.size,
          color: cartItem.color,
          quantity: orderedQty,
        });
      }
    }

    for (const [pId, deduction] of Object.entries(productDeductions)) {
      const currentProd = await prisma.product.findUnique({ where: { id: pId } });
      if (!currentProd) continue;

      let updateData = {};
      let parsedVariants =
        typeof currentProd.variants === "string"
          ? JSON.parse(currentProd.variants || "[]")
          : currentProd.variants || [];

      const hasVariants = Array.isArray(parsedVariants) && parsedVariants.length > 0;

      if (hasVariants && deduction.variantDeductions.length > 0) {
        for (const vd of deduction.variantDeductions) {
          const vIdx = parsedVariants.findIndex(
            (v) =>
              (v.size || "").trim().toLowerCase() === (vd.size || "").trim().toLowerCase() &&
              (v.color || "").trim().toLowerCase() === (vd.color || "").trim().toLowerCase()
          );
          if (vIdx !== -1) {
            const currentVariantQty = Number(parsedVariants[vIdx].quantity || 0);
            parsedVariants[vIdx].quantity = Math.max(0, currentVariantQty - vd.quantity);
          }
        }
        updateData.variants = parsedVariants;
        const totalVariantStock = parsedVariants.reduce(
          (acc, v) => acc + (Number(v.quantity) || 0),
          0
        );
        updateData.stockQuantity = totalVariantStock;
      } else if (
        currentProd.stockQuantity !== undefined &&
        currentProd.stockQuantity !== null
      ) {
        const newStock = Math.max(0, Number(currentProd.stockQuantity) - deduction.totalQty);
        updateData.stockQuantity = newStock;
      }

      await prisma.product.update({
        where: { id: pId },
        data: updateData,
      });

      // Record StockLog entry
      try {
        const channelSource = (client.source || "admin").toLowerCase().replace(/\s+/g, "_");
        const finalQty = updateData.stockQuantity !== undefined ? updateData.stockQuantity : (currentProd.stockQuantity || 0);
        await prisma.stockLog.create({
          data: {
            productId: pId,
            productName: currentProd.name,
            variantLabel: deduction.variantDeductions.length > 0
              ? deduction.variantDeductions.map((v) => `${v.size}/${v.color}`).join(", ")
              : null,
            previousQty: currentProd.stockQuantity || 0,
            newQty: finalQty,
            changeQty: -deduction.totalQty,
            reason: "order_sale",
            note: `Manual Order (${client.source || "Social Media"})`,
            source: channelSource || "admin",
          },
        });
      } catch (logErr) {
        console.error("StockLog creation failed in adminCreateOrder:", logErr);
      }
    }

    // Trigger smart allocation engine asynchronously
    runAllocationEngine(newOrder.id)
      .then((result) => {
        if (!result.success) {
          console.warn(`[Allocation] Admin Order ${newOrder.id} could not be auto-assigned: ${result.message}`);
        } else {
          console.log(`[Allocation] Admin Order ${newOrder.id} assigned to manufacturer ${result.assignment?.manufacturerId}`);
        }
      })
      .catch((err) => {
        console.error("[Allocation] Engine error on admin order:", err);
      });

    res.json({
      success: true,
      message: "Order created successfully",
      orderId: newOrder.id,
      order: {
        ...newOrder,
        _id: newOrder.id,
        date: Number(newOrder.date),
      },
    });
  } catch (error) {
    console.error("Admin create order error:", error);
    res.json({ success: false, message: error.message });
  }
};

export {
  placeOrder,
  allOrders,
  allAdminOrders,
  userOrders,
  updateStatus,
  cashReceived,
  adminCreateOrder,
};
