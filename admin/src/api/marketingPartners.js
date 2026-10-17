import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL;

export const getMarketingPartnerAnalytics = (token, partnerId) => (
  axios.get(
    `${backendUrl}/api/marketing-cards/admin/partners/${encodeURIComponent(partnerId)}/analytics`,
    { headers: { token } }
  )
);
