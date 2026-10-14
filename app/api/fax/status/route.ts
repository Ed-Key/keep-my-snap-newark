import { faxStatus } from "@/lib/fax.ts";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    return Response.json(await faxStatus(id));
  } catch (e) {
    console.error("fax status failed", e);
    return Response.json({ error: "Couldn't check the fax status." }, { status: 502 });
  }
}
