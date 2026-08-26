import { redirect } from "react-router";
const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({});
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
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";
  const errors = actionData?.errors || {};
  const values = actionData?.values || {};

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <a href="/app/fitment" style={{ color: "#2c6ecb", fontSize: "14px" }}>← Back to Fitment Records</a>

      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "16px 0 4px" }}>Add Fitment Record</h1>
      <p style={{ color: "#6d7175", margin: "0 0 24px" }}>Define a Year → Make → Model combination, then assign compatible products.</p>

      {errors.general && (
        <div style={{ background: "#f8d7da", color: "#721c24", padding: "12px 16px", borderRadius: "6px", marginBottom: "16px" }}>
          {errors.general}
        </div>
      )}

      <Form method="post">
        <div style={fieldGroup}>
          <label style={label}>Year <span style={{ color: "#c0392b" }}>*</span></label>
          <input
            name="year"
            type="number"
            min="1900"
            max="2099"
            defaultValue={values.year || new Date().getFullYear()}
            placeholder="e.g. 2025"
            style={{ ...input, borderColor: errors.year ? "#c0392b" : "#c9cccf" }}
          />
          {errors.year && <span style={errText}>{errors.year}</span>}
        </div>

        <div style={fieldGroup}>
          <label style={label}>Make <span style={{ color: "#c0392b" }}>*</span></label>
          <input
            name="make"
            defaultValue={values.make}
            placeholder="e.g. Arctic Cat"
            style={{ ...input, borderColor: errors.make ? "#c0392b" : "#c9cccf" }}
          />
          {errors.make && <span style={errText}>{errors.make}</span>}
        </div>

        <div style={fieldGroup}>
          <label style={label}>Model <span style={{ color: "#c0392b" }}>*</span></label>
          <input
            name="model"
            defaultValue={values.model}
            placeholder="e.g. Norseman 400"
            style={{ ...input, borderColor: errors.model ? "#c0392b" : "#c9cccf" }}
          />
          {errors.model && <span style={errText}>{errors.model}</span>}
        </div>

        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <button type="submit" disabled={saving} style={submitBtn}>
            {saving ? "Saving…" : "Save & Assign Products →"}
          </button>
          <a href="/app/fitment" style={cancelBtn}>Cancel</a>
        </div>
      </Form>
    </div>
  );
}

const fieldGroup = { marginBottom: "20px" };
const label = { display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "6px" };
const input = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "14px",
  boxSizing: "border-box",
};
const errText = { color: "#c0392b", fontSize: "13px", marginTop: "4px", display: "block" };
const submitBtn = {
  background: "#008060",
  color: "#fff",
  border: "none",
  padding: "10px 20px",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: "500",
  cursor: "pointer",
};
const cancelBtn = {
  display: "inline-block",
  background: "#f4f6f8",
  color: "#333",
  border: "1px solid #c9cccf",
  padding: "10px 20px",
  borderRadius: "6px",
  fontSize: "14px",
  textDecoration: "none",
};
