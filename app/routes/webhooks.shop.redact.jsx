import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[Webhook] Received ${topic} for ${shop}`);

  try {
    await prisma.$transaction([
      prisma.savedVehicle.deleteMany({ where: { shop } }),
      prisma.searchLog.deleteMany({ where: { shop } }),
      prisma.vinLookupLog.deleteMany({ where: { shop } }),
      prisma.session.deleteMany({ where: { shop } }),
    ]);
    console.log(`[GDPR shop/redact] Redacted shop-level customer and session records for ${shop}`);
  } catch (err) {
    console.error("[GDPR shop/redact error]", err);
  }

  return new Response(null, { status: 200 });
};
