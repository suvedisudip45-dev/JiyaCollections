import { prisma } from "../config/db.js";
import { listDriverAssignedManifests } from "../services/distributorLogisticsService.js";

export const getDriverProfile = (req, res) => {
  const { id, name, phone, status, vehicleType, vehicleRegistration } = req.driver;
  return res.json({
    success: true,
    driver: { id, distributorId: req.distributorId, name, phone, status, vehicleType, vehicleRegistration },
  });
};

export const getDriverManifests = async (req, res) => {
  try {
    const manifests = await listDriverAssignedManifests({
      driverId: req.driverId,
      distributorId: req.distributorId,
      client: prisma,
    });
    return res.json({ success: true, manifests });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Assigned delivery manifests could not be loaded.",
      code: "DRIVER_MANIFESTS_LOAD_FAILED",
    });
  }
};
