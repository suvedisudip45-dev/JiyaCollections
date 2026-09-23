-- Subcategory names may repeat under different parent categories.
ALTER TABLE `subcategory` DROP INDEX `SubCategory_name_key`;
CREATE UNIQUE INDEX `SubCategory_categoryId_name_key` ON `subcategory`(`categoryId`, `name`);