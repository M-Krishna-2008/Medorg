import { PrismaClient } from "@prisma/client";
import { config } from "../config";

const globalPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalPrisma.prisma ?? new PrismaClient({
  datasourceUrl: config.databaseUrl,
});

if (process.env.NODE_ENV !== "production") globalPrisma.prisma = prisma;
export default prisma;