import prisma from "../db.server";

export function safeJsonArray(json) {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function safeJsonObject(json) {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function safeJsonStringify(v) {
  try {
    return JSON.stringify(v ?? []);
  } catch {
    return "[]";
  }
}

export function safeJsonStringifyObject(v) {
  try {
    const obj = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    return JSON.stringify(obj);
  } catch {
    return "{}";
  }
}

export async function getOrCreateDeliverySettings(shop) {
  const row = await prisma.deliverySettings.findUnique({ where: { shop } });
  if (row) return row;

  return prisma.deliverySettings.create({
    data: { shop },
  });
}

export async function updateDeliverySettings(shop, data) {
  return prisma.deliverySettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: { ...data },
  });
}
