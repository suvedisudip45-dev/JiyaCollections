ALTER TABLE `MarketingCampaign`
    ADD COLUMN `maxScansPerCustomer` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `MarketingCard`
    ADD COLUMN `isPublic` BOOLEAN NOT NULL DEFAULT false,
    ADD INDEX `MarketingCard_campaignId_isPublic_physicalStatus_idx`
        (`campaignId`, `isPublic`, `physicalStatus`);
