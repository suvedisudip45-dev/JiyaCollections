import { randomUUID } from "node:crypto";

export const createOrderIdentity = () => {
  const id = randomUUID();
  return {
    id,
    orderReference: id.replace(/-/g, "").slice(-15).toUpperCase(),
  };
};
