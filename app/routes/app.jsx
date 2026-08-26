import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const shop = session.shop;

  // Show onboarding badge if no fitment data yet
  let fitmentCount = 0;
  try {
    fitmentCount = await prisma.fitmentRecord?.count({ where: { shop } });
  } catch (err) {
    console.error("[app loader] fitment count error:", err);
  }

  return { apiKey, fitmentCount };
};

export default function App() {
  const { apiKey, fitmentCount } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        {fitmentCount === 0 && <s-link href="/app/onboarding">🚀 Get Started</s-link>}
        <s-link href="/app/fitment">Fitment Data</s-link>
        <s-link href="/app/fitment/add">Add Record</s-link>
        <s-link href="/app/fitment/import">Import CSV</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/products/universal">Universal Products</s-link>
        <s-link href="/app/widget">Search Widget</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
