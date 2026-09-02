import prisma from "../db.server";

export const loader = async () => {
  try {
    const globalSettings = await prisma.appSettings.findFirst({
      where: { shop: "__GLOBAL__" },
    });
    const isOnline = globalSettings?.isSupportOnline ?? true;
    return Response.json(
      { isOnline, status: isOnline ? "online" : "offline" },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err) {
    return Response.json({ isOnline: true, status: "online" });
  }
};
