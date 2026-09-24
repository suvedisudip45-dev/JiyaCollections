import api from "./client";

export const campaignsApi = {
  list: (params = {}) => api.get("/api/marketing-cards/partner/campaigns", { params }),
  get:  (id)          => api.get(`/api/marketing-cards/partner/campaigns/${id}`),
};

export const cardsApi = {
  list: (params = {}) => api.get("/api/marketing-cards/partner/cards", { params }),
  get:  (id)          => api.get(`/api/marketing-cards/partner/cards/${id}`),
};

export const metricsApi = {
  get: () => api.get("/api/marketing-cards/partner/metrics"),
};

export const redemptionsApi = {
  list: (params = {}) => api.get("/api/marketing-cards/partner/redemptions", { params }),
};

export const qrApi = {
  validate: (cardCode) =>
    api.post("/api/marketing-cards/partner/qr/validate", { cardCode }),
  redeem: ({ cardCode, benefitId }) =>
    api.post("/api/marketing-cards/partner/redemptions/redeem", { cardCode, benefitId }),
};

export const profileApi = {
  get: () => api.get("/api/marketing-cards/partner/profile"),
  update: (data) => api.put("/api/marketing-cards/partner/profile", data),
  changePassword: (data) => api.post("/api/marketing-cards/partner/change-password", data),
};
