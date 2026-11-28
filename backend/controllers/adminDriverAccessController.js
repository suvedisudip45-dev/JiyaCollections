import {
  listDriverProvisioningDistributors,
  listUnlinkedDrivers,
  provisionDriverAccount,
} from "../services/adminDriverAccessService.js";

const sendError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.statusCode ? error.message : "The driver account operation could not be completed.",
  code: error.code || "DRIVER_ACCOUNT_OPERATION_FAILED",
});

export const getDriverProvisioningDistributors = async (_req, res) => {
  try {
    return res.json({ success: true, distributors: await listDriverProvisioningDistributors() });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getUnlinkedDrivers = async (req, res) => {
  try {
    return res.json({ success: true, drivers: await listUnlinkedDrivers({ distributorId: req.query.distributorId }) });
  } catch (error) {
    return sendError(res, error);
  }
};

export const createDriverWorkspaceAccount = async (req, res) => {
  try {
    const driver = await provisionDriverAccount({
      actorAccountId: req.auth.accountId,
      distributorId: req.body.distributorId,
      driverId: req.body.driverId,
      email: req.body.email,
    });
    return res.status(201).json({
      success: true,
      message: "Driver workspace account created. The driver can use Forgot password to set a password securely in this environment.",
      driver,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
