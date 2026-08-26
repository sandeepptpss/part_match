-- CreateTable
CREATE TABLE `FitmentRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `year` VARCHAR(191) NOT NULL,
    `make` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FitmentRecord_shop_idx`(`shop`),
    INDEX `FitmentRecord_shop_year_idx`(`shop`, `year`),
    INDEX `FitmentRecord_shop_year_make_idx`(`shop`, `year`, `make`),
    UNIQUE INDEX `FitmentRecord_shop_year_make_model_key`(`shop`, `year`, `make`, `model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FitmentProduct` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fitmentId` INTEGER NOT NULL,
    `shopifyProductId` VARCHAR(191) NOT NULL,
    `shopifyHandle` VARCHAR(191) NOT NULL DEFAULT '',
    `productTitle` VARCHAR(191) NOT NULL DEFAULT '',

    INDEX `FitmentProduct_fitmentId_idx`(`fitmentId`),
    INDEX `FitmentProduct_shopifyProductId_idx`(`shopifyProductId`),
    UNIQUE INDEX `FitmentProduct_fitmentId_shopifyProductId_key`(`fitmentId`, `shopifyProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UniversalProduct` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `shopifyProductId` VARCHAR(191) NOT NULL,
    `shopifyHandle` VARCHAR(191) NOT NULL DEFAULT '',
    `productTitle` VARCHAR(191) NOT NULL DEFAULT '',

    INDEX `UniversalProduct_shop_idx`(`shop`),
    UNIQUE INDEX `UniversalProduct_shop_shopifyProductId_key`(`shop`, `shopifyProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `year` VARCHAR(191) NOT NULL,
    `make` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `resultCount` INTEGER NOT NULL DEFAULT 0,
    `hasResults` BOOLEAN NOT NULL DEFAULT false,
    `sessionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SearchLog_shop_idx`(`shop`),
    INDEX `SearchLog_shop_hasResults_idx`(`shop`, `hasResults`),
    INDEX `SearchLog_shop_createdAt_idx`(`shop`, `createdAt`),
    INDEX `SearchLog_shop_year_make_model_idx`(`shop`, `year`, `make`, `model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WidgetSettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `heading` VARCHAR(191) NOT NULL DEFAULT 'Find Your Part',
    `subheading` VARCHAR(191) NOT NULL DEFAULT 'Search by Application',
    `yearLabel` VARCHAR(191) NOT NULL DEFAULT 'Year',
    `makeLabel` VARCHAR(191) NOT NULL DEFAULT 'Make',
    `modelLabel` VARCHAR(191) NOT NULL DEFAULT 'Model',
    `searchButtonText` VARCHAR(191) NOT NULL DEFAULT 'Search',
    `clearButtonText` VARCHAR(191) NOT NULL DEFAULT 'Clear',
    `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#008060',
    `textColor` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
    `backgroundColor` VARCHAR(191) NOT NULL DEFAULT '#f4f6f8',
    `borderRadius` INTEGER NOT NULL DEFAULT 4,
    `layout` VARCHAR(191) NOT NULL DEFAULT 'horizontal',
    `showHeading` BOOLEAN NOT NULL DEFAULT true,
    `showSubheading` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `WidgetSettings_shop_key`(`shop`),
    INDEX `WidgetSettings_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FitmentProduct` ADD CONSTRAINT `FitmentProduct_fitmentId_fkey` FOREIGN KEY (`fitmentId`) REFERENCES `FitmentRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
