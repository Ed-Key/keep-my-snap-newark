// Runs evals/rule_cases.json against decide(). Must be 100%. Usage: node scripts/run-rules.ts
import { readFileSync } from "node:fs";
import { decide, type Facts } from "../lib/rules.ts";

const { cases } = JSON.parse(readFileSync(new URL("../evals/rule_cases.json", import.meta.url), "utf8"));

// Fixture convention only: unlisted yes/no facts are "no", unlisted numbers are 0.
const fixtureDefaults: Facts = {
  age: null, work_hours_per_week: 0, hourly_wage: null, weekly_earnings: 0, monthly_earnings: null,
  q1_child_under_14_in_snap_household: "no", q2_unable_to_work: "no", q3_disability_benefits: "no",
  unemployment_status: "no", q6_student_half_time: "no", q7_wfnj_tanf_compliant: "no",
  q8_drug_alcohol_treatment: "no", q9_pregnant: "no", q10_caring_for_ill_person: "no", q11_native_american: "no",
};

let fail = 0;
for (const c of cases) {
  const facts = { ...fixtureDefaults, ...c.facts } as Facts;
  // An explicit wage or monthly figure means the weekly figure wasn't stated.
  if (!("weekly_earnings" in c.facts) && (c.facts.hourly_wage != null || c.facts.monthly_earnings != null)) facts.weekly_earnings = null;
  const r = decide(facts);
  const exp = c.expected;
  const ids = "exemptions" in r ? r.exemptions.map((e) => e.id).sort() : [];
  const problems: string[] = [];
  if (r.status !== exp.status) problems.push(`status ${r.status}`);
  if (JSON.stringify(ids) !== JSON.stringify([...(exp.exemptions ?? [])].sort())) problems.push(`exemptions ${ids}`);
  if (exp.ask && JSON.stringify("ask" in r ? [...r.ask].sort() : []) !== JSON.stringify([...exp.ask].sort())) problems.push(`ask ${"ask" in r ? r.ask : "-"}`);
  if (exp.meets_80_hours && !("meets80Hours" in r && r.meets80Hours)) problems.push("meets80Hours false");
  if ("exemptions" in r && r.exemptions.some((e) => !e.cite || !e.proof || !e.proofHolder)) problems.push("empty cite/proof");
  if (problems.length) { fail++; console.log(`FAIL ${c.id} (${c.why}): ${problems.join("; ")}`); }
}
console.log(`${cases.length - fail}/${cases.length} rule cases pass`);
process.exit(fail ? 1 : 0);
