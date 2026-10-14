// SNAP ABAWD exemption rules for NJ. Plain code decides; the AI only supplies facts.
// Sources: nj.gov ABAWD page, 7 CFR 273.7(b)(1), NJ SNAP-28/29 (11/25). Spec: evals/README.md.

export type YNU = "yes" | "no" | "unknown";

export type Facts = {
  age: number | null;
  work_hours_per_week: number | null;
  hourly_wage: number | null;
  weekly_earnings: number | null;
  monthly_earnings: number | null;
  q1_child_under_14_in_snap_household: YNU;
  q2_unable_to_work: YNU;
  q3_disability_benefits: YNU;
  unemployment_status: "receiving" | "applied" | "no" | "unknown";
  q6_student_half_time: YNU;
  q7_wfnj_tanf_compliant: YNU;
  q8_drug_alcohol_treatment: YNU;
  q9_pregnant: YNU;
  q10_caring_for_ill_person: YNU;
  q11_native_american: YNU;
};

export type Exemption = {
  id: string;
  label: string;
  cite: string;
  proof: string;
  proofHolder: string;
  countyDecides: boolean;
};

export type Result =
  | { status: "NOT_SUBJECT" }
  | { status: "EXEMPT" | "CLAIM_COUNTY_DECIDES"; exemptions: Exemption[] }
  | { status: "NOT_EXEMPT"; meets80Hours: boolean }
  | { status: "NEED_MORE_INFO"; ask: string[] };

export const EARNINGS_THRESHOLD = 217.5; // federal minimum wage x 30 hours, per SNAP-29 Q4

const E: Record<string, Omit<Exemption, "id">> = {
  q1_child_under_14: { label: "A child under 14 lives in your SNAP household", cite: "NJ ABAWD exemption 3; SNAP-29 Q1", proof: "None needed. The county already has your household on file.", proofHolder: "county", countyDecides: false },
  q2_unable_to_work: { label: "You are physically or mentally unable to work", cite: "NJ ABAWD exemption 6; 7 CFR 273.7(b)(1)(ii); SNAP-29 Q2", proof: "A statement from a doctor or clinic, proof of disability benefits, or a letter from your shelter or caseworker", proofHolder: "your doctor or caseworker", countyDecides: true },
  q3_disability_benefits: { label: "You receive disability benefits", cite: "NJ ABAWD exemption 6; SNAP-29 Q3", proof: "Your disability benefits award letter", proofHolder: "you", countyDecides: false },
  q4_working_30h_or_earning: { label: "You work 30+ hours a week or earn at least $217.50 a week", cite: "7 CFR 273.7(b)(1)(vii); NJ ABAWD exemption 4; SNAP-29 Q4", proof: "Your recent pay stubs", proofHolder: "you", countyDecides: false },
  q5_unemployment_receiving: { label: "You receive unemployment benefits", cite: "7 CFR 273.7(b)(1)(v); NJ ABAWD exemption 4; SNAP-29 Q5", proof: "Your unemployment benefits letter, or your claim status from myunemployment.nj.gov", proofHolder: "you", countyDecides: false },
  q5_unemployment_applied: { label: "You applied for unemployment benefits", cite: "7 CFR 273.7(b)(1)(v); NJ ABAWD exemption 4; SNAP-29 Q5", proof: "Your unemployment application confirmation. You must also be doing the unemployment job search.", proofHolder: "you", countyDecides: true },
  q6_student_half_time: { label: "You are in school or training at least half-time", cite: "7 CFR 273.7(b)(1)(viii); NJ ABAWD exemption 4; SNAP-29 Q6", proof: "Enrollment verification from your school or program", proofHolder: "your school", countyDecides: false },
  q7_wfnj_tanf: { label: "You meet the WorkFirst NJ / TANF work rules", cite: "7 CFR 273.7(b)(1)(iii); NJ ABAWD exemption 4; SNAP-29 Q7", proof: "None needed. The county has your WFNJ record.", proofHolder: "county", countyDecides: false },
  q8_drug_alcohol_treatment: { label: "You are in a drug or alcohol treatment program", cite: "7 CFR 273.7(b)(1)(vi); NJ ABAWD exemption 4; SNAP-29 Q8", proof: "A letter from your treatment program", proofHolder: "your program", countyDecides: false },
  q9_pregnant: { label: "You are pregnant", cite: "NJ ABAWD exemption 5; SNAP-29 Q9", proof: "A note from your doctor or clinic", proofHolder: "your doctor", countyDecides: false },
  q10_caring_for_ill_person: { label: "You care for someone who is ill or can't care for themselves", cite: "7 CFR 273.7(b)(1)(iv); NJ ABAWD exemption 4; SNAP-29 Q10", proof: "A note from the doctor of the person you care for", proofHolder: "their doctor", countyDecides: true },
  q11_native_american: { label: "You are Indian, Urban Indian, or California Indian", cite: "NJ ABAWD exemption 7; SNAP-29 Q11", proof: "Your tribal enrollment document", proofHolder: "you", countyDecides: false },
};

const YN_FACTS: [keyof Facts, string][] = [
  ["q1_child_under_14_in_snap_household", "q1_child_under_14"],
  ["q2_unable_to_work", "q2_unable_to_work"],
  ["q3_disability_benefits", "q3_disability_benefits"],
  ["q6_student_half_time", "q6_student_half_time"],
  ["q7_wfnj_tanf_compliant", "q7_wfnj_tanf"],
  ["q8_drug_alcohol_treatment", "q8_drug_alcohol_treatment"],
  ["q9_pregnant", "q9_pregnant"],
  ["q10_caring_for_ill_person", "q10_caring_for_ill_person"],
  ["q11_native_american", "q11_native_american"],
];

export function weeklyEarnings(f: Facts): number | null {
  if (f.weekly_earnings != null) return f.weekly_earnings;
  if (f.monthly_earnings != null) return (f.monthly_earnings * 12) / 52;
  if (f.work_hours_per_week != null && f.hourly_wage != null) return f.work_hours_per_week * f.hourly_wage;
  return null;
}

// SNAP-29 Q4 as yes/no/unknown.
export function q4(f: Facts): YNU {
  const h = f.work_hours_per_week;
  const w = weeklyEarnings(f);
  if ((h != null && h >= 30) || (w != null && w >= EARNINGS_THRESHOLD)) return "yes";
  if (h === 0 || w != null) return "no";
  return "unknown";
}

export function decide(f: Facts): Result {
  if (f.age == null) return { status: "NEED_MORE_INFO", ask: ["age"] };
  if (f.age < 18 || f.age >= 65) return { status: "NOT_SUBJECT" };

  const found: string[] = [];
  const unknown: string[] = [];

  const work = q4(f);
  if (work === "yes") found.push("q4_working_30h_or_earning");
  else if (work === "unknown") unknown.push(...(f.work_hours_per_week == null ? ["work_hours_per_week", "weekly_earnings"] : ["weekly_earnings"]));

  for (const [key, id] of YN_FACTS) {
    if (f[key] === "yes") found.push(id);
    else if (f[key] === "unknown") unknown.push(key);
  }

  if (f.unemployment_status === "receiving") found.push("q5_unemployment_receiving");
  else if (f.unemployment_status === "applied") found.push("q5_unemployment_applied");
  else if (f.unemployment_status === "unknown") unknown.push("unemployment_status");

  if (found.length) {
    const exemptions = found.map((id) => ({ id, ...E[id] }));
    const objective = exemptions.some((e) => !e.countyDecides);
    return { status: objective ? "EXEMPT" : "CLAIM_COUNTY_DECIDES", exemptions };
  }
  if (unknown.length) return { status: "NEED_MORE_INFO", ask: unknown };

  const h = f.work_hours_per_week ?? 0;
  return { status: "NOT_EXEMPT", meets80Hours: (h * 52) / 12 >= 80 };
}
