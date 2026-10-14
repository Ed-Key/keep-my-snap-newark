// Server-only fax sending via Notifyre. The destination comes from FAX_TO on the server, never from the browser.
import { NotifyreAPI, RecipientType, ContentType } from "notifyre-nodejs-sdk";

export const ESSEX_DFAB_FAX = "+19735049316";

export function faxConfig() {
  const token = process.env.NOTIFYRE_API_TOKEN;
  const to = process.env.FAX_TO;
  return token && to ? { token, to, isCounty: to === ESSEX_DFAB_FAX } : null;
}

// ponytail: in-memory cap per server run so a public demo link can't drain the account; use a real rate limit if this outlives the demo.
let sentThisRun = 0;
export const MAX_FAXES_PER_RUN = 25;

export async function sendFax(pdfBase64: string, reference: string) {
  const cfg = faxConfig();
  if (!cfg) throw new Error("Fax is not set up");
  if (sentThisRun >= MAX_FAXES_PER_RUN) throw new Error("Fax limit reached for this demo");
  sentThisRun++;
  const fax = new NotifyreAPI(cfg.token).getFaxService();
  const res = await fax.submitFax({
    templateName: "",
    recipients: [{ type: RecipientType.FaxNumber, value: cfg.to }],
    sendFrom: "",
    isHighQuality: false,
    clientReference: reference,
    documents: [{ base64Str: pdfBase64, contentType: ContentType.Pdf }],
    header: "Keep My SNAP - NJ SNAP-29 exemption",
    subject: "NJ SNAP-29 ABAWD exemption screening",
    scheduledDate: null,
    campaignName: "",
  });
  if (!res.success || !res.payload) throw new Error(res.message || "Fax was not accepted");
  return { faxID: res.payload.faxID, friendlyID: res.payload.friendlyID, isCounty: cfg.isCounty };
}

export async function faxStatus(faxID: string) {
  const cfg = faxConfig();
  if (!cfg) throw new Error("Fax is not set up");
  const now = Math.floor(Date.now() / 1000);
  const res = await new NotifyreAPI(cfg.token).getFaxService().listSentFaxes({
    fromDate: now - 6 * 3600, toDate: now + 60, sort: "desc", limit: 50, skip: 0,
  });
  const f = res.payload?.faxes.find((x) => x.id === faxID);
  return f ? { status: f.status, pages: f.pages, failedMessage: f.failedMessage } : { status: "queued" };
}
