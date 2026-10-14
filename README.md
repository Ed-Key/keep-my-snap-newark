# Keep My SNAP

Built at the Code and Coffee Hackathon (Newark Tech Week, Oct 14, 2026).

Since 2026, adults on SNAP in New Jersey must log 80 hours a month of work, training, or volunteering, or lose benefits after three months. Many people are exempt, but an exemption only counts if they file the state's SNAP-29 form with proof. More than 6,800 Essex County residents lost SNAP in May and June 2026 alone.

Keep My SNAP works like TurboTax for that form. A resident photographs their county letter and describes their situation in Spanish, Portuguese, or English. The app shows which exemption applies and why, then sends the filled form and proof to the county.

**Demo video (65 s):** [`demo/keep-my-snap-demo.mp4`](demo/keep-my-snap-demo.mp4). It shows Maria's flow on the real app: letter photo, Spanish story, read-back, the exemption result with her deadline, and filing with a receipt. The fax is simulated in the demo.

## How it works

The AI understands, and plain code decides:

1. **Extract** (`lib/extract.ts`): Claude turns the story and the letter photo into a fixed fact sheet, the 11 SNAP-29 questions plus age, hours, and pay. Each fact is yes, no, or unknown, and the AI never does arithmetic.
2. **Confirm**: the resident sees every fact and fixes anything wrong before a rule runs.
3. **Decide** (`lib/rules.ts`): a plain function applies NJ's ABAWD exemptions (nj.gov ABAWD page, 7 CFR 273.7(b)(1), NJ SNAP-28/29). Every result cites its rule. Judgment calls such as "unable to work" are labeled "the county decides".
4. **File** (`lib/pdf.ts`, `lib/fax.ts`): the app builds the resident's signed SNAP-29 statement with the proof photo and faxes it to Essex County. **By default the fax is simulated; nothing is sent.**

## Run it

You need Node 24+.

```bash
npm install
```

The AI step uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk). Either set `ANTHROPIC_API_KEY` in `.env.local`, or install Claude Code and log in (`claude`, then `/login`) so the SDK uses that login.

```bash
npm run dev
```

Open http://localhost:3000 on a phone-sized window. For the demo, use the sample county letter, a clearly labeled fake letter for a fictional resident. Print `demo/sample-county-letter.pdf` and photograph it, or on a laptop pick `demo/sample-county-letter.png` in the photo step.

## Tests

```bash
npm run test:rules     # 33 rule cases, must pass 100%
npm run test:stories   # 17 messy stories in 3 languages; pass bar: 95%+ facts right, zero confidently wrong answers
```

The test plan and the answer key are in `evals/`. The last run scored 59/59 facts, 0 confidently wrong, and 17/17 correct results.

## Real faxing (optional)

Set these in `.env.local` to send real faxes through [Notifyre](https://notifyre.com), which costs about $0.03 a page:

```
NOTIFYRE_API_TOKEN=...
FAX_TO=+1XXXXXXXXXX   # a test number you control; Essex DFAB is +19735049316
```

The destination is set only on the server, a send needs the resident's consent, and each server run is capped at 25 faxes.

## Limits

- Not legal advice. The county makes the final decision.
- The SNAP-29 replica is the resident's own written statement answering the state's questions. It is not an official state form. NJ accepts a written statement unless it is "questionable".
- No data is stored. Simulated faxes are held in memory only until the server restarts.
