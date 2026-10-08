import { prisma } from "../config/db.js";

export const syncDistributorRating = async (distributorId, client = prisma) => {
  const aggregate = await client.distributorReview.aggregate({
    where: { distributorId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const ratingCount = aggregate._count._all;
  const qualityRating = ratingCount
    ? Number(Number(aggregate._avg.rating).toFixed(2))
    : 0;

  await client.distributor.update({
    where: { id: distributorId },
    data: { qualityRating, ratingCount },
  });

  return { qualityRating, ratingCount };
};
