const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getPagination = (query = {}) => {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE);
  const requestedLimit = parsePositiveInteger(query.limit, DEFAULT_LIMIT);
  const limit = Math.min(requestedLimit, MAX_LIMIT);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

export const getPaginationMeta = ({ page, limit, total }) => {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
};

export const paginatedResponse = (key, records, pagination, total) => ({
  success: true,
  [key]: records,
  data: records,
  pagination: getPaginationMeta({ ...pagination, total }),
});

export { DEFAULT_LIMIT, MAX_LIMIT };