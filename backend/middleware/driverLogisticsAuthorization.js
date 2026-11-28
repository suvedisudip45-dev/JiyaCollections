import { prisma } from "../config/db.js";

export const requireAssignedDriverStop = (client = prisma, allowedManifestStatuses = ["IN_TRANSIT", "COMPLETED"]) => async (req, res, next) => {
  try {
    const driverId = req.auth?.driverId;
    const distributorId = req.distributorId;
    if (!driverId || !distributorId) {
      return res.status(403).json({ success: false, message: "An active driver assignment is required.", code: "DRIVER_ASSIGNMENT_REQUIRED" });
    }

    const stop = await client.deliveryManifestStop.findFirst({
      where: {
        id: req.params.stopId,
        manifestId: req.params.manifestId,
        assignmentId: { not: null },
        manifest: {
          is: {
            id: req.params.manifestId,
            driverId,
            distributorId,
            status: { in: allowedManifestStatuses },
          },
        },
      },
      select: { id: true, orderId: true, assignmentId: true },
    });
    if (!stop) {
      return res.status(404).json({ success: false, message: "Assigned delivery stop not found.", code: "DRIVER_STOP_NOT_FOUND" });
    }

    const assignment = await client.orderAssignment.findFirst({
      where: {
        id: stop.assignmentId,
        orderId: stop.orderId,
        distributorId,
        deliveryType: "SELF_DELIVERY",
      },
      select: { id: true },
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: "Assigned delivery stop not found.", code: "DRIVER_STOP_NOT_FOUND" });
    }
    req.params.id = stop.orderId;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "The delivery assignment could not be verified.", code: "DRIVER_ASSIGNMENT_CHECK_FAILED" });
  }
};
