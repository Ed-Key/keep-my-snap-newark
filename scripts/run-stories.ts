// Grades extraction on evals/stories.json, then simulates follow-ups through decide().
// Pass bar: >= 95% of listed facts correct, zero confidently wrong, every final result matches.
// Usage: node scripts/run-stories.ts [STORY-ID ...]
import { readFileSync } from "node:fs";
import { extract } from "../lib/extract.ts";
import { decide, type Facts } from "../lib/rules.ts";

const { stories } = JSON.parse(readFileSync(new URL("../evals/stories.json", import.meta.url), "utf8"));
const only = process.argv.slice(2);
const todo = only.length ? stories.filter((s: { id: string }) => only.includes(s.id)) : stories;

let listed = 0, correct = 0, wrong = 0, resultFails = 0;
const results = await Promise.all(todo.map(async (s: any) => {
  const lines: string[] = [];
  let facts: Facts;
  try { facts = (await extract(s.story)).facts; } catch (e) { return { s, lines: [`ERROR ${(e as Error).message}`], bad: true }; }
  let bad = false;

  for (const [k, v] of Object.entries(facts)) {
    const accepted: unknown[] | undefined = s.expected_facts[k];
    if (accepted) {
      listed++;
      if (accepted.includes(v)) correct++;
      else if (v === "unknown" || v === null) lines.push(`  miss  ${k}: got ${v}, expected ${JSON.stringify(accepted)}`);
      else { wrong++; bad = true; lines.push(`  WRONG ${k}: got ${v}, expected ${JSON.stringify(accepted)}`); }
    } else if (!(v === "unknown" || v === null)) {
      wrong++; bad = true; lines.push(`  WRONG ${k}: got ${v} but the story never states it`);
    }
  }

  // Follow-up loop: answer only what decide() asks for.
  const asked = new Set<string>();
  const unknownAfterExtraction = new Set(Object.entries(facts).filter(([, v]) => v === "unknown" || v === null).map(([k]) => k));
  let r = decide(facts);
  for (let i = 0; i < 5 && r.status === "NEED_MORE_INFO"; i++) {
    const answerable = r.ask.filter((k) => k in s.followup_answers && !asked.has(k));
    if (!answerable.length) break;
    for (const k of answerable) { asked.add(k); (facts as any)[k] = s.followup_answers[k]; }
    r = decide(facts);
  }
  for (const k of s.must_ask) if (unknownAfterExtraction.has(k) && !asked.has(k)) { bad = true; lines.push(`  never asked ${k}`); }

  const ids = "exemptions" in r ? r.exemptions.map((e) => e.id).sort() : [];
  const exp = s.expected_result;
  if (r.status !== exp.status || JSON.stringify(ids) !== JSON.stringify([...exp.exemptions].sort())) {
    resultFails++; bad = true; lines.push(`  RESULT got ${r.status} ${ids.join(",")} (asked: ${[...asked].join(",") || "-"}), expected ${exp.status} ${exp.exemptions.join(",")}`);
  }
  return { s, lines, bad };
}));

for (const { s, lines, bad } of results) console.log(`${bad ? "FAIL" : "ok  "} ${s.id} ${s.name}\n${lines.join("\n")}`.trimEnd());
const pct = listed ? (100 * correct) / listed : 0;
console.log(`\nFacts correct: ${correct}/${listed} (${pct.toFixed(1)}%) | confidently wrong: ${wrong} | result mismatches: ${resultFails}`);
const pass = pct >= 95 && wrong === 0 && resultFails === 0;
console.log(pass ? "PASS" : "NOT PASSING");
process.exit(pass ? 0 : 1);
