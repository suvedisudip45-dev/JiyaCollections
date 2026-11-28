const normalize = (value) => String(value || "").trim().toUpperCase();

export const resolveReturnExchangeRoute = ({ assignment, deliveryOrder } = {}) => {
  const assignmentDeliveryType = normalize(assignment?.deliveryType);
  const deliveryType = normalize(deliveryOrder?.deliveryType);
  const hasNcmOrder = Number.isInteger(Number(deliveryOrder?.ncmOrderId)) && Number(deliveryOrder.ncmOrderId) > 0;

  if (hasNcmOrder || assignmentDeliveryType === "NCM" || (deliveryType && deliveryType !== "SELF_DELIVERY")) {
    return { route: "NCM", distributorId: null };
  }

  if (assignment?.distributorId && assignmentDeliveryType === "SELF_DELIVERY") {
    return { route: "DISTRIBUTOR", distributorId: assignment.distributorId };
  }

  return null;
};
