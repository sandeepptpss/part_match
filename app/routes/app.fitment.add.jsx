import { redirect, useLoaderData, Form, useNavigation, useActionData, Link } from "react-router";
const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const initialYear = url.searchParams.get("year") || "";
  const initialMake = url.searchParams.get("make") || "";
  const initialModel = url.searchParams.get("model") || "";
  return json({ initialYear, initialMake, initialModel });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const year = formData.get("year")?.toString().trim();
  const make = formData.get("make")?.toString().trim();
  const model = formData.get("model")?.toString().trim();

  const errors = {};
  if (!year) errors.year = "Year is required";
  if (!make) errors.make = "Make is required";
  if (!model) errors.model = "Model is required";

  if (Object.keys(errors).length > 0) {
    return json({ errors, values: { year, make, model } }, { status: 422 });
  }

  const existing = await prisma.fitmentRecord.findUnique({
    where: { shop_year_make_model: { shop, year, make, model } },
  });

  if (!existing) {
    const { plan } = await getShopPlan(shop);
    const limits = planLimits(plan);
    if (Number.isFinite(limits.fitmentLimit)) {
      const currentCount = await prisma.fitmentRecord.count({ where: { shop } });
      if (currentCount >= limits.fitmentLimit) {
        return json(
          {
            errors: {
              general: `You've reached the ${limits.fitmentLimit.toLocaleString()} fitment record limit for the ${limits.label} plan. Upgrade your plan to add more records.`,
            },
            values: { year, make, model },
          },
          { status: 422 },
        );
      }
    }
  }

  try {
    const record = await prisma.fitmentRecord.upsert({
      where: { shop_year_make_model: { shop, year, make, model } },
      create: { shop, year, make, model },
      update: {},
    });
    if (record && record.id) {
      return redirect(`/app/fitment/${record.id}/products`);
    } else {
      return json({ errors: { general: "Failed to save record" }, values: { year, make, model } });
    }
  } catch (err) {
    console.error("[fitment/add]", err);
    return json({ errors: { general: err.message || "Failed to save record" }, values: { year, make, model } });
  }
};

export default function FitmentAdd() {
  const { initialYear, initialMake, initialModel } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";
  const errors = actionData?.errors || {};
  const values = actionData?.values || {};

  const yearValue = values.year ?? initialYear ?? new Date().getFullYear();
  const makeValue = values.make ?? initialMake ?? "";
  const modelValue = values.model ?? initialModel ?? "";

  return (
    <div style={{ padding: "32px 24px", maxWidth: "680px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      <Link to="/app/fitment" style={{ color: "#2563eb", fontSize: "14px", fontWeight: "600", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "20px" }}>
        ← Back to Fitment Catalog
      </Link>

      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)" }}>
        <div style={{ borderBottom: "1px solid #f1f5f9", pb: "20px", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span style={{ fontSize: "24px" }}>📝</span>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>Add Fitment Specification</h1>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Define a Year → Make → Model combination to map compatible Shopify catalog products.
          </p>
        </div>

        {errors.general && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "14px 18px", borderRadius: "10px", marginBottom: "20px", fontSize: "14px", fontWeight: "500" }}>
            ⚠️ {errors.general}
          </div>
        )}

        <Form method="post">
          <div style={fieldGroup}>
            <label style={label}>Model Year <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              name="year"
              type="number"
              min="1900"
              max="2099"
              defaultValue={yearValue}
              placeholder="e.g. 2025"
              style={{ ...input, borderColor: errors.year ? "#dc2626" : "#cbd5e1" }}
            />
            {errors.year && <span style={errText}>{errors.year}</span>}
          </div>

          <div style={fieldGroup}>
            <label style={label}>Manufacturer / Make <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              name="make"
              defaultValue={makeValue}
              placeholder="e.g. Ford, Polaris, Arctic Cat"
              style={{ ...input, borderColor: errors.make ? "#dc2626" : "#cbd5e1" }}
            />
            {errors.make && <span style={errText}>{errors.make}</span>}
          </div>

          <div style={fieldGroup}>
            <label style={label}>Vehicle Model <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              name="model"
              defaultValue={modelValue}
              placeholder="e.g. F-150, Sportsman 850, Norseman 400"
              style={{ ...input, borderColor: errors.model ? "#dc2626" : "#cbd5e1" }}
            />
            {errors.model && <span style={errText}>{errors.model}</span>}
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "28px", paddingTop: "20px", borderTop: "1px solid #f1f5f9" }}>
            <button type="submit" disabled={saving} style={submitBtn}>
              {saving ? "Saving Specification…" : "Save & Assign Products →"}
            </button>
            <Link to="/app/fitment" style={cancelBtn}>Cancel</Link>
          </div>
        </Form>
      </div>
    </div>
  );
}

const fieldGroup = { marginBottom: "20px" };
const label = { display: "block", fontSize: "14px", fontWeight: "700", color: "#1e293b", marginBottom: "8px" };
const input = {
  width: "100%",
  padding: "11px 14px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "14px",
  boxSizing: "border-box",
  outline: "none",
};
const errText = { color: "#dc2626", fontSize: "13px", marginTop: "6px", fontWeight: "600", display: "block" };
const submitBtn = {
  background: "#008060",
  color: "#ffffff",
  border: "none",
  padding: "11px 22px",
  borderRadius: "8px",
  fontSize: "14px",
  fontWeight: "700",
  cursor: "pointer",
  boxShadow: "0 2px 6px rgba(0, 128, 96, 0.25)",
};
const cancelBtn = {
  display: "inline-flex",
  alignItems: "center",
  background: "#ffffff",
  color: "#475569",
  border: "1px solid #cbd5e1",
  padding: "11px 20px",
  borderRadius: "8px",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
};
