import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`[Webhook] Received ${topic} for ${shop}`);

  try {
    const customerId = payload?.customer?.id ? String(payload.customer.id) : null;
    if (customerId) {
      const deleteResult = await prisma.savedVehicle.deleteMany({
        where: { shop, customerId },
      });
      console.log(`[GDPR customers/redact] Redacted ${deleteResult.count} saved vehicles for customer ${customerId}`);
    }
  } catch (err) {
    console.error("[GDPR customers/redact error]", err);
  }

  return new Response(null, { status: 200 });
};
