-- Add admin-controlled storefront navigation merchandising flag.
ALTER TABLE `product` ADD COLUMN `showInNavigation` BOOLEAN NOT NULL DEFAULT false;