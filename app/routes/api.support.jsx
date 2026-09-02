import { authenticate } from "../shopify.server";
import { sendSupportEmailToAdmin } from "../email.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  let shop = "Unknown Store";
  let defaultSessionEmail = "";

  try {
    const { session } = await authenticate.admin(request);
    if (session?.shop) shop = session.shop;
    if (session?.email) defaultSessionEmail = session.email;
  } catch (err) {
    console.warn("[api.support] Admin auth session fallback:", err?.message);
  }

  let name = "";
  let email = "";
  let subject = "";
  let message = "";

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    name = body.name?.trim();
    email = body.email?.trim();
    subject = body.subject?.trim();
    message = body.message?.trim();
  } else {
    const formData = await request.formData();
    name = formData.get("name")?.toString().trim();
    email = formData.get("email")?.toString().trim();
    subject = formData.get("subject")?.toString().trim();
    message = formData.get("message")?.toString().trim();
  }

  if (!email && defaultSessionEmail) {
    email = defaultSessionEmail;
  }

  if (!name || !email || !subject || !message) {
    return Response.json(
      { success: false, error: "Please fill out all required fields (Name, Contact Email, Subject, Query Details)." },
      { status: 400 }
    );
  }

  const result = await sendSupportEmailToAdmin({
    merchantShop: shop,
    senderName: name,
    senderEmail: email,
    subject: subject,
    message: message,
  });

  if (!result.success) {
    return Response.json(
      { success: false, error: result.error || "Failed to send support email." },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    message: "Your support query has been submitted! Our team will reply to your contact email shortly.",
  });
};
