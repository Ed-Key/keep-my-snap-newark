import { simulatedPdf } from "@/lib/fax.ts";

// Demo only: shows the exact PDF a simulated fax would have sent.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const pdf = /^SIM-\d{6}$/.test(id) ? simulatedPdf(id) : undefined;
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(pdf, "base64"), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${id}.pdf"`, "Cache-Control": "no-store" } });
}
