-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeliverySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "rangeDays" INTEGER NOT NULL DEFAULT 30,
    "cutoffTime" TEXT NOT NULL DEFAULT '15:00',
    "carrierPreset" TEXT NOT NULL DEFAULT 'yamato',
    "timeSlotsJson" TEXT NOT NULL DEFAULT '[]',
    "holidaysJson" TEXT NOT NULL DEFAULT '[]',
    "blackoutJson" TEXT NOT NULL DEFAULT '[]',
    "requireDate" BOOLEAN NOT NULL DEFAULT true,
    "requireTime" BOOLEAN NOT NULL DEFAULT false,
    "placementsJson" TEXT NOT NULL DEFAULT '[]',
    "placementRequired" BOOLEAN NOT NULL DEFAULT false,
    "noticeText" TEXT NOT NULL DEFAULT '',
    "attrDateName" TEXT NOT NULL DEFAULT 'delivery_date',
    "attrTimeName" TEXT NOT NULL DEFAULT 'delivery_time',
    "attrPlacementName" TEXT NOT NULL DEFAULT 'delivery_placement',
    "denyProductTag" TEXT NOT NULL DEFAULT 'no_delivery_datetime',
    "installMode" TEXT NOT NULL DEFAULT 'auto',
    "installElementsJson" TEXT NOT NULL DEFAULT '[]',
    "saveToOrderMetafields" BOOLEAN NOT NULL DEFAULT false,
    "metafieldNamespace" TEXT NOT NULL DEFAULT 'custom',
    "metafieldDateKey" TEXT NOT NULL DEFAULT 'delivery_date',
    "metafieldTimeKey" TEXT NOT NULL DEFAULT 'delivery_time',
    "metafieldPlacementKey" TEXT NOT NULL DEFAULT 'delivery_placement',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_DeliverySettings" ("blackoutJson", "createdAt", "cutoffTime", "holidaysJson", "id", "leadTimeDays", "rangeDays", "shop", "timeSlotsJson", "updatedAt") SELECT "blackoutJson", "createdAt", "cutoffTime", "holidaysJson", "id", "leadTimeDays", "rangeDays", "shop", "timeSlotsJson", "updatedAt" FROM "DeliverySettings";
DROP TABLE "DeliverySettings";
ALTER TABLE "new_DeliverySettings" RENAME TO "DeliverySettings";
CREATE UNIQUE INDEX "DeliverySettings_shop_key" ON "DeliverySettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
