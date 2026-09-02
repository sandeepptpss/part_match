const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { sendSupportEmailToAdmin } from "../email.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  return json({
    shop,
    defaultEmail: session.email || "",
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const subject = formData.get("subject")?.toString().trim();
  const message = formData.get("message")?.toString().trim();

  if (!name || !email || !subject || !message) {
    return json(
      { success: false, error: "All fields (Name, Contact Email, Subject, Query Details) are required." },
      { status: 400 }
    );
  }

  // Trigger email notification in background via Resend API to Admin
  const result = await sendSupportEmailToAdmin({
    merchantShop: shop,
    senderName: name,
    senderEmail: email,
    subject: subject,
    message: message,
  });

  if (!result.success) {
    return json(
      { success: false, error: result.error || "Failed to submit support query. Please try again." },
      { status: 500 }
    );
  }

  return json({
    success: true,
    message: "Thank you! Your query has been submitted successfully. Our support team will review your request and get back to you shortly at your contact email.",
  });
};

export default function SupportPage() {
  const { shop, defaultEmail } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSubmitting = navigation.state !== "idle";

  const [formValues, setFormValues] = useState({
    name: "",
    email: defaultEmail || "",
    subject: "",
    message: "",
  });

  const handleChange = (field, val) => {
    setFormValues((prev) => ({ ...prev, [field]: val }));
  };

  return (
    <div
      style={{
        padding: "28px 24px 60px",
        maxWidth: "1100px",
        margin: "0 auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#0f172a",
      }}
    >
      {/* Executive Header Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: "16px",
          padding: "32px",
          color: "#ffffff",
          marginBottom: "28px",
          boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h1 style={{ margin: 0, fontSize: "26px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                Merchant Support & Help Desk
              </h1>
              <span
                style={{
                  background: "rgba(16, 185, 129, 0.2)",
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                  color: "#34d399",
                  padding: "4px 12px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: "700",
                }}
              >
                Live Assistance
              </span>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
              Need help setting up vehicle fitments, customizing search widgets, or importing CSV data? Submit your query below.
            </p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.08)", padding: "10px 16px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.15)", fontSize: "13px", color: "#cbd5e1" }}>
            Connected Store: <strong style={{ color: "#ffffff" }}>{shop}</strong>
          </div>
        </div>
      </div>

      {/* Success Notification Alert */}
      {actionData?.success && (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            color: "#047857",
            padding: "20px 24px",
            borderRadius: "14px",
            marginBottom: "28px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            boxShadow: "0 4px 14px rgba(4, 120, 87, 0.08)",
          }}
        >
          <div
            style={{
              background: "#047857",
              color: "#ffffff",
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "14px",
              flexShrink: 0,
            }}
          >
            ✓
          </div>
          <div>
            <strong style={{ fontSize: "16px", display: "block", marginBottom: "2px" }}>Query Received!</strong>
            <span style={{ fontSize: "13px", opacity: 0.9 }}>
              {actionData.message}
            </span>
          </div>
        </div>
      )}

      {/* Error Notification Alert */}
      {actionData?.error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            padding: "18px 20px",
            borderRadius: "14px",
            marginBottom: "28px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            boxShadow: "0 4px 14px rgba(185, 28, 28, 0.08)",
          }}
        >
          <div
            style={{
              background: "#b91c1c",
              color: "#ffffff",
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "13px",
              flexShrink: 0,
            }}
          >
            ✕
          </div>
          <div>
            <strong style={{ fontSize: "15px", display: "block" }}>Submission Failed</strong>
            <span style={{ fontSize: "13px" }}>{actionData.error}</span>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "28px" }}>
        
        {/* Support Form Card */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <div style={iconBadge("#eff6ff", "#2563eb")}>
              <MailIcon />
            </div>
            <div>
              <h2 style={cardTitleStyle}>Send Support Query</h2>
              <p style={cardSubStyle}>Fill out your details to contact our merchant support team.</p>
            </div>
          </div>

          <Form method="post" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Merchant Name Field */}
            <div>
              <label style={labelStyle}>
                Merchant Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                name="name"
                required
                value={formValues.name}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="e.g. John Doe / Store Owner"
                style={inputStyle}
              />
            </div>

            {/* Merchant Email Field */}
            <div>
              <label style={labelStyle}>
                Contact Email <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="email"
                name="email"
                required
                value={formValues.email}
                onChange={(e) => handleChange("email", e.target.value)}
                placeholder="e.g. owner@yourstore.com"
                style={inputStyle}
              />
              <span style={{ fontSize: "12px", color: "#64748b", marginTop: "4px", display: "block" }}>
                We will send our response to this email address.
              </span>
            </div>

            {/* Query Subject Field */}
            <div>
              <label style={labelStyle}>
                Query Subject <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                name="subject"
                required
                value={formValues.subject}
                onChange={(e) => handleChange("subject", e.target.value)}
                placeholder="e.g. Fitment Search Widget styling / CSV import assistance"
                style={inputStyle}
              />
            </div>

            {/* Related Query / Message Details Field */}
            <div>
              <label style={labelStyle}>
                Query Details & Description <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                name="message"
                required
                rows={5}
                value={formValues.message}
                onChange={(e) => handleChange("message", e.target.value)}
                placeholder="Please describe your question, issue, or request in detail..."
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                background: isSubmitting ? "#94a3b8" : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                color: "#ffffff",
                border: "none",
                padding: "14px 24px",
                borderRadius: "10px",
                fontSize: "15px",
                fontWeight: "700",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px rgba(0, 128, 96, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "all 0.2s ease",
                marginTop: "6px",
              }}
            >
              {isSubmitting ? "Submitting Query..." : "Submit Support Query →"}
            </button>
          </Form>
        </div>

        {/* Support Direct Contact & Information Card */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Merchant Support Info Card */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={iconBadge("#f0fdf4", "#16a34a")}>
                <ClockIcon />
              </div>
              <div>
                <h3 style={cardTitleStyle}>Support Commitment</h3>
                <p style={cardSubStyle}>Fast & reliable assistance for your store</p>
              </div>
            </div>

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>Support Status</span>
                <span style={{ fontSize: "12px", background: "#dcfce7", color: "#15803d", border: "1px solid #a7f3d0", padding: "3px 10px", borderRadius: "12px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#16a34a" }} />
                  Online & Available Now
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>Average Response Time</span>
                <span style={{ fontSize: "13px", color: "#0f172a", fontWeight: "700" }}>Under 2 Hours</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>Support Hours</span>
                <span style={{ fontSize: "13px", color: "#0f172a", fontWeight: "600" }}>24/7 Technical Assistance</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>Support Coverage</span>
                <span style={{ fontSize: "13px", color: "#2563eb", fontWeight: "700" }}>Priority Technical Support</span>
              </div>
            </div>
          </div>

          {/* Quick FAQ / Self-Help Accordion */}
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div style={iconBadge("#fff7ed", "#ea580c")}>
                <HelpIcon />
              </div>
              <div>
                <h3 style={cardTitleStyle}>Frequently Asked Questions</h3>
                <p style={cardSubStyle}>Quick resolution for common merchant queries</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <FaqItem
                question="How do I display the fitment search widget on my homepage?"
                answer="Go to Online Store → Themes → Customize, click 'Add block' or 'Add section', and select 'PartMatch Search' from the App Embeds or App Blocks menu."
              />
              <FaqItem
                question="How do I import thousands of Year/Make/Model records?"
                answer="Navigate to Fitment Catalog → Import CSV to bulk upload vehicle fitment mapping files using standard CSV templates."
              />
              <FaqItem
                question="Can I customize search widget colors and labels?"
                answer="Yes! Visit the Search Widget menu in the app navigation to customize text, primary color, button text, and layout style in real-time."
              />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

function MailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "10px",
        overflow: "hidden",
        background: open ? "#f8fafc" : "#ffffff",
        transition: "all 0.15s ease",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "12px 16px",
          background: "none",
          border: "none",
          textAlign: "left",
          fontSize: "14px",
          fontWeight: "700",
          color: "#0f172a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        <span>{question}</span>
        <span style={{ fontSize: "16px", color: "#64748b", marginLeft: "10px" }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px", fontSize: "13px", color: "#475569", lineHeight: "1.5" }}>
          {answer}
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "28px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const cardHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "18px",
  marginBottom: "22px",
};

const iconBadge = (bg, color) => ({
  width: "40px",
  height: "40px",
  borderRadius: "12px",
  background: bg,
  color: color,
  fontWeight: "800",
  fontSize: "18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});

const cardTitleStyle = {
  fontSize: "18px",
  fontWeight: "800",
  margin: "0 0 2px",
  color: "#0f172a",
  letterSpacing: "-0.3px",
};

const cardSubStyle = {
  fontSize: "13px",
  color: "#64748b",
  margin: 0,
};

const labelStyle = {
  display: "block",
  fontSize: "14px",
  fontWeight: "700",
  color: "#0f172a",
  marginBottom: "6px",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  fontSize: "14px",
  boxSizing: "border-box",
  color: "#0f172a",
  outline: "none",
  background: "#ffffff",
  transition: "border-color 0.2s ease",
};
