// Builds the resident's SNAP-29 statement: cover letter, the 11 SNAP-29 questions, and the proof photo.
// Not a copy of the state form: no seal, clearly labeled as the resident's own written statement.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { q4, type Facts, type Exemption, type YNU } from "./rules.ts";

const QUESTIONS: [string, (f: Facts) => YNU][] = [
  ["Living with a child in the SNAP household under the age of 14?", (f) => f.q1_child_under_14_in_snap_household],
  ["Physically or mentally unable to work (including due to homelessness or family violence)?", (f) => f.q2_unable_to_work],
  ["Receiving temporary or permanent disability benefits?", (f) => f.q3_disability_benefits],
  ["Already working at least 30 hours a week or earning at least the federal minimum wage multiplied by 30 hours (at least $217.50/week)?", q4],
  ["Receiving or has applied for unemployment benefits?", (f) => (f.unemployment_status === "unknown" ? "unknown" : f.unemployment_status === "no" ? "no" : "yes")],
  ["Going to school, college or a training program at least half-time?", (f) => f.q6_student_half_time],
  ["Meeting the rules for the Work First New Jersey/Temporary Assistance for Needy Families (WFNJ/TANF) Program?", (f) => f.q7_wfnj_tanf_compliant],
  ["Participating in a drug or alcohol treatment program?", (f) => f.q8_drug_alcohol_treatment],
  ["Pregnant?", (f) => f.q9_pregnant],
  ["Taking care of someone who is ill or unable to care for themselves?", (f) => f.q10_caring_for_ill_person],
  ["An \"Indian,\" \"Urban Indian\" or \"California Indian\" as defined in the Indian Health Care Improvement Act?", (f) => f.q11_native_american],
];

export type FormInput = { name: string; caseNumber: string; facts: Facts; exemptions: Exemption[]; proofJpegBase64?: string; date?: Date };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function writer(page: PDFPage, font: PDFFont, bold: PDFFont) {
  let y = 740;
  const write = (text: string, opts: { size?: number; b?: boolean; x?: number; width?: number; gap?: number } = {}) => {
    const size = opts.size ?? 11, f = opts.b ? bold : font, x = opts.x ?? 60;
    for (const l of wrap(text, f, size, opts.width ?? 492)) { page.drawText(l, { x, y, size, font: f }); y -= size + 4; }
    y -= opts.gap ?? 6;
  };
  return { write, get y() { return y; }, set y(v: number) { y = v; } };
}

export async function buildSnap29Pdf(input: FormInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const date = (input.date ?? new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Page 1: cover letter
  const p1 = doc.addPage([612, 792]);
  const w1 = writer(p1, font, bold);
  w1.write("Essex County Division of Family Assistance and Benefits", { b: true, gap: 0 });
  w1.write("320 University Avenue, 2nd Floor, Newark, NJ 07102 · Fax (973) 504-9316", { size: 10, gap: 16 });
  w1.write(`From: ${input.name}`, { gap: 0 });
  w1.write(`SNAP case number: ${input.caseNumber}`, { gap: 0 });
  w1.write(`Date: ${date}`, { gap: 16 });
  w1.write("Re: Exemption from the ABAWD time limit (NJ SNAP-29 questions)", { b: true, gap: 12 });
  w1.write("I am a SNAP recipient who may be subject to the ABAWD Time Limit Rules. I believe I am exempt for the reason(s) below. My signed answers to the SNAP-29 questions are on page 2, and my proof is attached. Please record the exemption in my case.");
  for (const e of input.exemptions) {
    w1.write(`• ${e.label}`, { b: true, gap: 0 });
    w1.write(`Rule: ${e.cite}. Proof: ${e.proof}`, { size: 10, x: 72, width: 480 });
  }
  w1.write("Thank you,", { gap: 0 });
  w1.write(input.name, { gap: 24 });
  w1.write("Prepared with Keep My SNAP. This is the resident's own written statement answering the questions on NJ SNAP-29 (11/25); it is not an official state form.", { size: 9 });

  // Page 2: the 11 questions
  const p2 = doc.addPage([612, 792]);
  const w2 = writer(p2, font, bold);
  w2.write("Answers to NJ SNAP-29: Screening for Exemption(s) from ABAWD Time Limits", { b: true, size: 12, gap: 4 });
  w2.write(`Name: ${input.name}    Case number: ${input.caseNumber}    Date: ${date}`, { size: 10, gap: 4 });
  w2.write("Answers refer to the resident named above. Questions the resident did not answer are left blank.", { size: 9, gap: 10 });
  for (const [i, [q, get]] of QUESTIONS.entries()) {
    const a = get(input.facts);
    const top = w2.y;
    p2.drawText(a === "yes" ? "[X] Yes   [  ] No" : a === "no" ? "[  ] Yes   [X] No" : "[  ] Yes   [  ] No", { x: 60, y: top, size: 10, font: bold });
    w2.write(`${i + 1}. ${q}`, { size: 10, x: 170, width: 382, gap: 8 });
  }
  w2.y -= 10;
  w2.write("CERTIFICATION", { b: true, gap: 2 });
  w2.write("I hereby certify that the above information is true and accurate to the best of my knowledge.", { size: 10, gap: 14 });
  w2.write(`Signature: /s/ ${input.name}        Date: ${date}`, { gap: 0 });

  // Page 3: proof photo
  if (input.proofJpegBase64) {
    const img = await doc.embedJpg(Uint8Array.from(atob(input.proofJpegBase64), (c) => c.charCodeAt(0)));
    const p3 = doc.addPage([612, 792]);
    p3.drawText(`Proof attached by ${input.name} (case ${input.caseNumber})`, { x: 60, y: 750, size: 11, font: bold, color: rgb(0, 0, 0) });
    const s = Math.min(492 / img.width, 660 / img.height);
    p3.drawImage(img, { x: 60, y: 740 - img.height * s, width: img.width * s, height: img.height * s });
  }
  return doc.save();
}
