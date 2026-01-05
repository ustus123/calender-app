import { PrismaClient } from "@prisma/client";

// Node.js の global に PrismaClient を保持（dev での多重生成防止）
const globalForPrisma = global;

const prisma =
  globalForPrisma.prismaGlobal ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaGlobal = prisma;
}

export default prisma;
