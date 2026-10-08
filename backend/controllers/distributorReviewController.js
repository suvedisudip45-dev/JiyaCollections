import { prisma } from "../config/db.js";
import { sanitizeText } from "../middleware/sanitize.js";
import { syncDistributorRating } from "../services/distributorRatingService.js";

const isDelivered = (order, assignment) =>
  [order.status, order.fulfillmentStatus, order.deliveryOrder?.state, assignment?.status]
    .some((status) => String(status || "").toLowerCase() === "delivered");

export const submitDistributorReview = async (req, res) => {
  try {
    const orderId = String(req.params.orderId || "").trim();
    const userId = req.auth?.userId;
    const rating = Number(req.body.rating);
    const comment = sanitizeText(req.body.comment, { stripAllHtml: true }) || null;

    if (!orderId || !userId) {
      return res.status(400).json({ success: false, message: "A valid delivered order is required." });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Please choose a rating between 1 and 5 stars." });
    }
    if (comment && comment.length > 2000) {
      return res.status(400).json({ success: false, message: "Review comments cannot exceed 2,000 characters." });
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        status: true,
        fulfillmentStatus: true,
        distributorId: true,
        deliveryOrder: { select: { state: true } },
      },
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }
    const assignment = await prisma.orderAssignment.findUnique({
      where: { orderId },
      select: { distributorId: true, status: true },
    });
    if (!isDelivered(order, assignment)) {
      return res.status(409).json({ success: false, message: "You can review the hub after your order is delivered." });
    }

    const distributorId = order.distributorId || assignment?.distributorId;
    if (!distributorId) {
      return res.status(409).json({ success: false, message: "This order was not fulfilled by a distributor hub." });
    }

    const review = await prisma.$transaction(async (tx) => {
      const savedReview = await tx.distributorReview.upsert({
        where: { orderId },
        create: { orderId, userId, distributorId, rating, comment },
        update: { rating, comment },
        select: { id: true, orderId: true, distributorId: true, rating: true, comment: true, updatedAt: true },
      });
      await syncDistributorRating(distributorId, tx);
      return savedReview;
    }, { isolationLevel: "Serializable" });

    return res.json({ success: true, message: "Your distributor hub review was saved.", review });
  } catch (error) {
    console.error("submitDistributorReview error:", error);
    return res.status(500).json({ success: false, message: "Unable to save your distributor review." });
  }
};
