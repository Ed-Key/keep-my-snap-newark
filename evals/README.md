# Keep My SNAP: evaluator spec (one page)

This is a spec written as data. No code was written tonight; the runner gets built at the event. It was revised after the Codex plan review (`codex-review.md`).

## The split being tested
The AI turns a story into **facts**. Plain code turns facts into a **result**. Each half has its own test.

## Facts the AI extracts
Facts describe **the resident**, not their household. The one exception is Q1, which is about the household by definition. SNAP-29 asks about "you or anyone in your household," so the PDF states that its answers refer to the resident named on it.

| Key | Values | Feeds |
|---|---|---|
| `age` | number or null | Needed for the 18 to 64 range. The county already knows it, so it isn't on SNAP-29 |
| `work_hours_per_week` | number or null | Q4 |
| `hourly_wage` | number or null | Q4 |
| `weekly_earnings` | number or null, only if stated weekly | Q4 |
| `monthly_earnings` | number or null, only if stated monthly | Q4 |
| `q1_child_under_14_in_snap_household` | yes / no / unknown | Q1. A person's own child under 22 living with them is in the same SNAP household. Other relatives may not be |
| `q2_unable_to_work` | yes / no / unknown | Q2, including homelessness or family violence |
| `q3_disability_benefits` | yes / no / unknown | Q3 |
| `unemployment_status` | receiving / applied / no / unknown | Q5 is yes if receiving or applied |
| `q6_student_half_time` | yes / no / unknown | Q6 |
| `q7_wfnj_tanf_compliant` | yes / no / unknown | Q7 |
| `q8_drug_alcohol_treatment` | yes / no / unknown | Q8. Means a regular program, not occasional meetings |
| `q9_pregnant` | yes / no / unknown | Q9 |
| `q10_caring_for_ill_person` | yes / no / unknown | Q10 |
| `q11_native_american` | yes / no / unknown | Q11 |

The **code** does all the arithmetic. The AI never computes:
- **Weekly earnings** = the stated weekly figure, or monthly x 12 / 52, or hours x wage.
- **Q4** is yes if `work_hours_per_week >= 30` or weekly earnings `>= 217.50`.
- **`meets_80_hours`** is true if hours per week x 52 / 12 `>= 80`.

## Results
- `NOT_SUBJECT`: age under 18 or 65 and over.
- `EXEMPT`: at least one exemption the county can verify from records or documents: Q1, Q3, Q4, Q6, Q7, Q8, Q9, Q11, or receiving unemployment.
- `CLAIM_COUNTY_DECIDES`: the only exemptions are judgment calls the county makes: Q2 (unfit), Q10 (incapacity of the person cared for), or unemployment applied but not yet received (compliance must be verified). **The screen must say this in words**, not as a hidden flag.
- `NOT_EXEMPT`: show the 80-hour log. Add "you're already meeting it" when `meets_80_hours` is true.
- `NEED_MORE_INFO`: list the unknown facts that could change the result. Age is always required. An unknown is never asked about once an exemption applies.

Every result lists all the exemptions that apply. Each one has a rule citation, the proof needed, and who holds that proof. **The runner checks that none of these are empty.**

Ages 60 to 64 are still subject to the rule. Age alone does not exempt them, but any other exemption does (NJ ABAWD exemption 4).

## Grading
- **Rule cases** (`rule_cases.json`): must pass 100%. The fixtures default unlisted facts to "no". **At runtime, a missing fact is always unknown.**
- **Stories** (`stories.json`): each fact listed under `expected_facts` names the answers we accept.
  - **Score:** % of listed facts answered correctly. Unlisted facts aren't counted toward the score, but they must come back `unknown`.
  - **Confidently wrong (zero allowed):** a yes or no outside the accepted list, an unlisted fact answered yes or no, a wrong number for age, hours, wage or earnings, or `unemployment_status` set to receiving or applied when it shouldn't be.
  - **Pass bar:** at least 95% and zero confidently wrong.
- **Follow-ups:**
  - Each entry in `followup_answers` is fed back only if the tool actually asked that question.
  - `must_ask` facts must be asked whenever extraction left them unknown.
  - The final result must match `expected_result`.
- **PDF check:** unknown facts are left blank on the replica. They're never filled in as yes or no. Check the boxes in the final PDF against the confirmed facts.
- **Gate:** Maria's story (ES-1) on a phone-width screen produces a correct PDF in under 3 minutes.
- **Stretch, not a gate:** a live fax to our own number, with a delivery receipt.

## Sources
- NJ ABAWD page: https://www.nj.gov/humanservices/njsnap/apply/eligibility/abawd.shtml
- 7 CFR 273.7(b)(1): basic work rule exemptions. Applying for unemployment counts only with compliance with the unemployment work requirements.
- NJ SNAP-29 and SNAP-28 (11/25): `research/forms/`

## Answer-key changes during the build (Oct 14)
- ES-1, ES-2, ES-5: accept `work_hours_per_week: 0` for "I lost my job / was let go / can't work outside the house". The key contradicted the spec, which says not working means 0 (EN-2 and PT-2 already expected 0).
- EN-6: accept `q1 = no` for "my wife is pregnant with our first". "Our first" states there are no children yet.
- EN-5: accept `q2 = unknown` for "I'm not sick" (not sick says nothing about homelessness or family violence) and add the follow-up answer the app would collect.
Result after these fixes: 59/59 facts, 0 confidently wrong, 17/17 results, on two consecutive runs.
