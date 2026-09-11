import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[Webhook] Received ${topic} for ${shop}`);

  try {
    const customerId = payload?.customer?.id ? String(payload.customer.id) : null;
    if (customerId) {
      const savedVehicles = await prisma.savedVehicle.findMany({
        where: { shop, customerId },
        select: { year: true, make: true, model: true, trim: true, createdAt: true },
      });
      console.log(`[GDPR data_request] Found ${savedVehicles.length} saved vehicles for customer ${customerId}`);
    }
  } catch (err) {
    console.error("[GDPR data_request error]", err);
  }

  return new Response(null, { status: 200 });
};
