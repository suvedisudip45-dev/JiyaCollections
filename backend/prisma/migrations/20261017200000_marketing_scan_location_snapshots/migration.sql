ALTER TABLE `MarketingCardCustomer`
  ADD COLUMN `scannedProvince` VARCHAR(120) NULL,
  ADD COLUMN `scannedDistrict` VARCHAR(120) NULL;

CREATE INDEX `MarketingCardCustomer_scannedProvince_scannedDistrict_idx`
  ON `MarketingCardCustomer`(`scannedProvince`, `scannedDistrict`);

CREATE INDEX `MarketingCard_partnerId_campaignId_physicalStatus_idx`
  ON `MarketingCard`(`partnerId`, `campaignId`, `physicalStatus`);
