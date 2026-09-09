const json = (data, init) => Response.json(data, init);
import { useLoaderData, useFetcher, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const WIDGET_DEFAULTS = {
  heading: "Find Your Part",
  subheading: "Search by Application",
  primaryColor: "#008060",
  backgroundColor: "#f4f6f8",
  layout: "horizontal",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let fitmentCount = 0;
  let productAssignmentCount = 0;
  let widgetCustomized = false;
  let themeExtensionConfirmed = false;

  try {
    fitmentCount = await prisma.fitmentRecord?.count({ where: { shop } }) ?? 0;
    productAssignmentCount = await prisma.fitmentProduct?.count({
      where: { fitment: { shop } },
    }) ?? 0;

    const widgetSettings = await prisma.widgetSettings?.findUnique({ where: { shop } });
    widgetCustomized = !!widgetSettings && Object.entries(WIDGET_DEFAULTS).some(
      ([key, defaultValue]) => widgetSettings[key] !== defaultValue,
    );

    const appSettings = await prisma.appSettings?.findUnique({ where: { shop } });
    themeExtensionConfirmed = !!appSettings?.themeExtensionConfirmed;
  } catch (err) {
    console.error("[onboarding loader] error:", err);
  }

  return json({ shop, fitmentCount, productAssignmentCount, widgetCustomized, themeExtensionConfirmed });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  if (formData.get("intent") === "confirm_theme_extension") {
    await prisma.appSettings?.upsert({
      where: { shop },
      create: { shop, themeExtensionConfirmed: true },
      update: { themeExtensionConfirmed: true },
    });
  }

  return json({ ok: true });
};

export default function Onboarding() {
  const { shop, fitmentCount, productAssignmentCount, widgetCustomized, themeExtensionConfirmed } = useLoaderData();
  const fetcher = useFetcher();

  const steps = [
    {
      step: 1,
      title: "Configure Search Fields",
      desc: "Your app is pre-configured with Year → Make → Model. Go to Settings to customize behavior.",
      action: "Go to Settings",
      href: "/app/settings",
      done: true,
    },
    {
      step: 2,
      title: "Add Your Fitment Data",
      desc: "Manually add Year/Make/Model records or import a CSV file with your fitment data.",
      action: "Import CSV",
      href: "/app/fitment/import",
      action2: "Add Manually",
      href2: "/app/fitment/add",
      done: fitmentCount > 0,
    },
    {
      step: 3,
      title: "Connect Products to Fitments",
      desc: "Assign which Shopify products are compatible with each vehicle fitment.",
      action: "Manage Products",
      href: "/app/fitment",
      done: productAssignmentCount > 0,
    },
    {
      step: 4,
      title: "Customize the Search Widget",
      desc: "Set colors, labels, and layout to match your store brand.",
      action: "Customize Widget",
      href: "/app/widget",
      done: widgetCustomized,
    },
    {
      step: 5,
      title: "Enable the Theme App Extension",
      desc: "Go to Online Store → Themes → Customize → Add the PartMatch Search block to your pages.",
      action: "Open Theme Editor",
      href: `https://${shop}/admin/themes`,
      external: true,
      done: themeExtensionConfirmed,
      confirmable: !themeExtensionConfirmed,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <div style={{ padding: "28px 24px 60px", width: "100%", maxWidth: "100%", boxSizing: "border-box", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "800", margin: "0 0 8px" }}>Welcome to PartMatch</h1>
        <p style={{ color: "#6d7175", fontSize: "16px", margin: 0 }}>
          Year → Make → Model fitment search for your Shopify store.
        </p>
      </div>

      {/* Progress */}
      <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px 20px", marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: "500" }}>Setup Progress</span>
          <span style={{ fontSize: "14px", color: "#6d7175" }}>{completed}/{steps.length} steps</span>
        </div>
        <div style={{ background: "#f1f2f3", borderRadius: "4px", height: "8px" }}>
          <div style={{ background: "#008060", borderRadius: "4px", height: "8px", width: `${pct}%`, transition: "width 0.5s" }} />
        </div>
      </div>

      {/* Steps */}
      {steps.map((s) => (
        <div
          key={s.step}
          style={{
            background: "#fff",
            border: `1px solid ${s.done ? "#008060" : "#e1e3e5"}`,
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "12px",
            display: "flex",
            gap: "16px",
            alignItems: "flex-start",
          }}
        >
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: s.done ? "#008060" : "#f1f2f3",
            color: s.done ? "#fff" : "#6d7175",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "700",
            fontSize: "14px",
            flexShrink: 0,
          }}>
            {s.done ? "✓" : s.step}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: "600", fontSize: "15px", marginBottom: "4px", color: s.done ? "#008060" : "#202223" }}>
              {s.title} {s.done && <span style={{ fontSize: "12px", background: "#d4edda", color: "#155724", padding: "2px 8px", borderRadius: "10px", marginLeft: "8px" }}>Done</span>}
            </div>
            <div style={{ fontSize: "14px", color: "#6d7175", marginBottom: "12px" }}>{s.desc}</div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {s.external ? (
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    background: s.done ? "#f1f2f3" : "#008060",
                    color: s.done ? "#6d7175" : "#fff",
                    padding: "7px 16px",
                    borderRadius: "6px",
                    textDecoration: "none",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  {s.action} ↗
                </a>
              ) : (
                <Link
                  to={s.href}
                  style={{
                    display: "inline-block",
                    background: s.done ? "#f1f2f3" : "#008060",
                    color: s.done ? "#6d7175" : "#fff",
                    padding: "7px 16px",
                    borderRadius: "6px",
                    textDecoration: "none",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  {s.action} →
                </Link>
              )}
              {s.step === 2 && (
                <div style={{ width: "100%", marginTop: "10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>📥 Ready-to-Use Catalog Templates (Zero Friction)</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                    Download a pre-formatted template with sample vehicles and products, fill in your data, and upload:
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                    <a
                      href="/partmatch_sample_template.csv"
                      download="partmatch_sample_template.csv"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        color: "#0f172a",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "700",
                        textDecoration: "none",
                      }}
                    >
                      📄 Download Standard PartMatch CSV
                    </a>
                    <a
                      href="/aces_sample_template.csv"
                      download="aces_sample_template.csv"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: "#ffffff",
                        border: "1px solid #86efac",
                        color: "#166534",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "700",
                        textDecoration: "none",
                      }}
                    >
                      🚗 Download ACES Industry CSV
                    </a>
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    <strong>Supported columns:</strong> <code style={{ background: "#e2e8f0", padding: "2px 5px", borderRadius: "4px" }}>year</code>, <code style={{ background: "#e2e8f0", padding: "2px 5px", borderRadius: "4px" }}>make</code>, <code style={{ background: "#e2e8f0", padding: "2px 5px", borderRadius: "4px" }}>model</code>, <code style={{ background: "#e2e8f0", padding: "2px 5px", borderRadius: "4px" }}>trim</code>, <code style={{ background: "#e2e8f0", padding: "2px 5px", borderRadius: "4px" }}>product_handle</code>, <code style={{ background: "#e2e8f0", padding: "2px 5px", borderRadius: "4px" }}>sku</code>
                  </div>
                </div>
              )}
              {s.action2 && (
                <Link
                  to={s.href2}
                  style={{
                    display: "inline-block",
                    background: "#f1f2f3",
                    color: "#333",
                    padding: "7px 16px",
                    borderRadius: "6px",
                    textDecoration: "none",
                    fontSize: "14px",
                  }}
                >
                  {s.action2}
                </Link>
              )}
              {s.confirmable && (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="confirm_theme_extension" />
                  <button
                    type="submit"
                    disabled={fetcher.state !== "idle"}
                    style={{
                      background: "#fff",
                      border: "1px solid #c9cccf",
                      color: "#333",
                      padding: "7px 16px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                  >
                    I've added the blocks →
                  </button>
                </fetcher.Form>
              )}
            </div>
          </div>
        </div>
      ))}

        <div style={{ textAlign: "center", marginTop: "28px" }}>
          <Link
            to="/app"
            style={{
              display: "inline-block",
              background: "#fff",
              border: "1px solid #c9cccf",
              padding: "10px 24px",
              borderRadius: "6px",
              textDecoration: "none",
              color: "#333",
              fontSize: "14px",
            }}
          >
            Skip to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
