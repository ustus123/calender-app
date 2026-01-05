-- CreateTable
CREATE TABLE "DeliverySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "rangeDays" INTEGER NOT NULL DEFAULT 30,
    "cutoffTime" TEXT NOT NULL DEFAULT '15:00',
    "holidaysJson" TEXT NOT NULL DEFAULT '[]',
    "blackoutJson" TEXT NOT NULL DEFAULT '[]',
    "timeSlotsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySettings_shop_key" ON "DeliverySettings"("shop");
