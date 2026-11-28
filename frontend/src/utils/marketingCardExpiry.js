export const getMarketingCardExpiry = (...values) => {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()));

  return dates.length
    ? new Date(Math.min(...dates.map((date) => date.getTime())))
    : null;
};

export const formatMarketingCardExpiry = (date) => date.toLocaleString();

export const formatMarketingCardTimeLeft = (date, now = Date.now()) => {
  const remainingMinutes = Math.ceil((date.getTime() - now) / 60_000);
  if (remainingMinutes <= 0) return "Expired";

  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
};
