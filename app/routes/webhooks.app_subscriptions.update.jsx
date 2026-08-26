import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resolveTierFromBillingName } from "../plans.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = payload?.app_subscription;
  if (subscription) {
    const tier = subscription.status === "ACTIVE" ? resolveTierFromBillingName(subscription.name) : null;

    const data = tier
      ? {
          plan: tier.plan,
          billingCycle: tier.billingCycle,
          subscriptionId: subscription.admin_graphql_api_id ? String(subscription.admin_graphql_api_id) : null,
        }
      : { plan: "free", billingCycle: "monthly", subscriptionId: null };

    await prisma.shopPlan.upsert({
      where: { shop },
      update: data,
      create: { shop, ...data },
    });
  }

  return new Response();
};
