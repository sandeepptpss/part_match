import { PrismaClient } from "@prisma/client";

// Ensure PrismaClient re-loads updated schema models
if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = new PrismaClient();
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
