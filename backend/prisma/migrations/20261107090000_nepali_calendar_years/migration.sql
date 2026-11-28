CREATE TABLE `NepaliCalendarYear` (
    `year` INTEGER NOT NULL,
    `adStartDate` DATE NOT NULL,
    `monthDays` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`year`),
    INDEX `NepaliCalendarYear_adStartDate_idx` (`adStartDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
