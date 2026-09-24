-- Add category-aware merchandising metadata to product subcategories.
ALTER TABLE `subcategory` ADD COLUMN `description` TEXT NULL;
ALTER TABLE `subcategory` ADD COLUMN `image` TEXT NULL;
ALTER TABLE `subcategory` ADD COLUMN `categoryId` VARCHAR(191) NULL;
CREATE INDEX `SubCategory_categoryId_idx` ON `SubCategory`(`categoryId`);
ALTER TABLE `subcategory` ADD CONSTRAINT `SubCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
