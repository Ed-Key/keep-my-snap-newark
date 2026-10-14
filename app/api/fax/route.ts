import { faxConfig, sendFax } from "@/lib/fax.ts";

export async function GET() {
  const cfg = faxConfig();
  return Response.json({ enabled: !!cfg, isCounty: cfg?.isCounty ?? false });
}

export async function POST(request: Request) {
  if (!faxConfig()) return Response.json({ error: "Fax is not set up yet." }, { status: 503 });
  let body: { pdf?: unknown; reference?: unknown; consent?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const pdf = typeof body.pdf === "string" ? body.pdf : "";
  // Must be a PDF ("%PDF" in base64 is "JVBER") and under ~6 MB.
  if (!pdf.startsWith("JVBER") || pdf.length > 8_000_000) return Response.json({ error: "Invalid form file." }, { status: 400 });
  if (body.consent !== true) return Response.json({ error: "Consent is required to send." }, { status: 400 });
  const reference = typeof body.reference === "string" ? body.reference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) : "";
  try {
    return Response.json(await sendFax(pdf, reference));
  } catch (e) {
    console.error("fax send failed", e);
    return Response.json({ error: "The fax couldn't be sent. Try again, or bring the form to 320 University Ave." }, { status: 502 });
  }
}
