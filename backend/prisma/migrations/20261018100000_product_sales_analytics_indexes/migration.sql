CREATE INDEX `CustomerReturn_refundStatus_returnDate_idx`
  ON `CustomerReturn`(`refundStatus`, `returnDate`);

CREATE INDEX `CustomerReturn_distributorId_refundStatus_returnDate_idx`
  ON `CustomerReturn`(`distributorId`, `refundStatus`, `returnDate`);
