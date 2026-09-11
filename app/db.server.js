import { PrismaClient } from "@prisma/client";

function getClient() {
  if (process.env.NODE_ENV === "production") {
    if (!global.prismaGlobal) {
      global.prismaGlobal = new PrismaClient();
    }
    return global.prismaGlobal;
  }
  if (!global.prismaGlobal || !global.prismaGlobal.quoteRequest) {
    if (global.prismaGlobal) {
      try {
        global.prismaGlobal.$disconnect();
      } catch (e) {
        // ignore
      }
    }
    global.prismaGlobal = new PrismaClient();
  }
  return global.prismaGlobal;
}

const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getClient();
      const val = client[prop];
      return typeof val === "function" ? val.bind(client) : val;
    },
  }
);

export default prisma;

