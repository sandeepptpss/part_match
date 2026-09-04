import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import GlobalSupportWidget from "../components/GlobalSupportWidget";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const shop = session.shop;

  // eslint-disable-next-line no-undef
  const adminEmail = process.env.ADMIN_EMAIL || "sandeepptpss@gmail.com";
  // eslint-disable-next-line no-undef
  const adminStore = process.env.ADMIN_STORE_NAME || "quickstart-749ac396";
  const sessionEmail = session.email || adminEmail;

  const isAdmin =
    shop.includes(adminStore) ||
    shop.includes("quickstart-749ac396") ||
    sessionEmail.toLowerCase() === "sandeepptpss@gmail.com" ||
    sessionEmail === adminEmail;

  // Show onboarding badge if no fitment data yet
  let fitmentCount = 0;
  try {
    fitmentCount = await prisma.fitmentRecord?.count({ where: { shop } });
  } catch (err) {
    console.error("[app loader] fitment count error:", err);
  }

  return { apiKey, fitmentCount, isAdmin, shop, sessionEmail };
};

export default function App() {
  const { apiKey, fitmentCount, isAdmin, shop, sessionEmail } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        {fitmentCount === 0 && <s-link href="/app/onboarding">Get Started</s-link>}
        <s-link href="/app/fitment">Fitment Catalog</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/widget">Search Widget</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/plans">Plans & Pricing</s-link>
        <s-link href="/app/support">Help & Support</s-link>
        {isAdmin && <s-link href="/app/admin">App Admin</s-link>}
      </s-app-nav>
      <Outlet />
      <GlobalSupportWidget shop={shop} sessionEmail={sessionEmail} />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
