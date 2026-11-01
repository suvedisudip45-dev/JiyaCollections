import test from "node:test";
import assert from "node:assert/strict";

import { paginatedResponse } from "../utils/pagination.js";

test("paginated responses expose records once under the endpoint-specific key", () => {
  const records = [{ id: "product-1" }];
  const response = paginatedResponse("products", records, { page: 1, limit: 12 }, 1);

  assert.deepEqual(response, {
    success: true,
    products: records,
    pagination: {
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  });
  assert.equal("data" in response, false);
});
