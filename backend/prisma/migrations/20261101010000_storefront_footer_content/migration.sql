ALTER TABLE `StorefrontContentConfig`
    ADD COLUMN `footerDescription` TEXT NULL,
    ADD COLUMN `contactPhone` VARCHAR(80) NOT NULL DEFAULT '+1-8515-56789',
    ADD COLUMN `contactEmail` VARCHAR(254) NOT NULL DEFAULT 'contact@aamacollections.com';

UPDATE `StorefrontContentConfig`
SET `footerDescription` = 'At Aama Collections, we redefine everyday fashion with a focus on refined structure, confident silhouettes, and long-wearing essentials. Each piece is designed to move seamlessly from daily life to elevated moments, helping you feel polished, comfortable, and effortlessly styled.'
WHERE `footerDescription` IS NULL;

ALTER TABLE `StorefrontContentConfig`
    MODIFY COLUMN `footerDescription` TEXT NOT NULL;
