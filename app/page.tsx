"use client";

import { useEffect, useState, type ReactNode } from "react";
import { decide, type Facts, type Result } from "@/lib/rules.ts";
import { STRINGS, type Lang } from "@/lib/i18n.ts";
import type { Extraction } from "@/lib/extract.ts";
import { buildSnap29Pdf } from "@/lib/pdf.ts";
import { PdfPages } from "./pdf-pages";

type Step = "lang" | "story" | "ask" | "confirm" | "result" | "send" | "done";
type Photo = { mediaType: "image/jpeg"; data: string; preview: string };

// Shrinks a phone photo to a JPEG under ~1 MB so it fits the request limit.
async function toPhoto(file: File): Promise<Photo> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: url.split(",")[1], preview: url };
}

// Whole calendar days from today to the deadline date (Oct 14 -> Oct 24 is 10).
const daysUntil = (iso: string | null) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  return days >= 0 ? days : null;
};

const CheckIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// Brand mark: a shield (protection) with a check (exemption granted). Same art as app/icon.svg.
const Logo = ({ className }: { className: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
    <path d="M16 2.5 27 6.5v8.6c0 7.1-4.7 12.6-11 14.4C9.7 27.7 5 22.2 5 15.1V6.5Z" fill="#13233F" />
    <path d="m10.6 16.2 3.8 3.8 7.2-7.6" fill="none" stroke="#F0A574" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Chevron = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 shrink-0 text-ink"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const CameraIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="12.3" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
);

const btn = "w-full min-h-13 rounded-xl px-5 py-3.5 text-center text-[17px] font-semibold leading-snug transition-colors disabled:cursor-not-allowed";
const primary = `${btn} bg-navy text-white shadow-sm hover:bg-navy-700 active:bg-navy-700 disabled:bg-[#8a93a3] disabled:shadow-none`;
const secondary = `${btn} border-2 border-line bg-white text-navy hover:border-navy/50 active:bg-sand disabled:text-ink/60 disabled:hover:border-line`;
const card = "rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(19,35,63,0.05)]";
const field = "w-full rounded-lg border-2 border-line bg-white px-3 py-3 text-lg text-navy focus:border-navy";
const fieldLabel = "text-base font-semibold text-navy";
const textLink = "min-h-12 py-2 text-center text-base font-semibold text-navy underline decoration-peach decoration-2 underline-offset-4 hover:decoration-accent";
const heading = "font-serif text-2xl font-bold leading-snug text-balance text-navy";
// Keeps the main action at the bottom of the screen, under the thumb, even on long screens.
const actionBar = "sticky bottom-0 -mx-5 mt-auto bg-paper/95 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm";


export default function Home() {
  const [lang, setLang] = useState<Lang>("es");
  const [step, setStep] = useState<Step>("lang");
  const [story, setStory] = useState("");
  const [letter, setLetter] = useState<Photo | null>(null);
  const [proof, setProof] = useState<Photo | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [faxCfg, setFaxCfg] = useState<{ enabled: boolean; simulated?: boolean; isCounty: boolean } | null>(null);
  const [consent, setConsent] = useState(false);
  const [fax, setFax] = useState<{ state: "sending" | "queued" | "delivered" | "failed"; id?: string; rawId?: string } | null>(null);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [history, setHistory] = useState<{ key: string; prev: unknown }[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const t = STRINGS[lang];
  const result: Result | null = facts ? decide(facts) : null;
  // Questions still to ask: what the rules need, minus anything answered "not sure".
  const pending = result?.status === "NEED_MORE_INFO" ? result.ask.filter((k) => !skipped.includes(k)) : [];

  async function submitStory() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, letterImage: letter ? { mediaType: letter.mediaType, data: letter.data } : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(t.error);
      setExtraction(json);
      setFacts(json.facts);
      setCaseNumber(json.letter.case_number ?? "");
      setSkipped([]); setHistory([]);
      setStep(decide(json.facts).status === "NEED_MORE_INFO" ? "ask" : "confirm");
    } catch (e) {
      console.error(e); setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  function answer(key: string, value: string | number) {
    setHistory([...history, { key, prev: (facts as Record<string, unknown>)[key] }]);
    const nextSkipped = value === "unknown" ? [...skipped, key] : skipped;
    setSkipped(nextSkipped);
    const next = (value === "unknown" ? facts! : { ...facts!, [key]: value }) as Facts;
    setFacts(next);
    const r = decide(next);
    if (r.status !== "NEED_MORE_INFO" || r.ask.every((k) => nextSkipped.includes(k))) setStep("confirm");
  }

  function goBack() {
    const last = history[history.length - 1];
    if (!last) { setStep("story"); return; }
    setHistory(history.slice(0, -1));
    setSkipped(skipped.filter((k) => k !== last.key));
    setFacts({ ...facts!, [last.key]: last.prev } as Facts);
  }

  useEffect(() => {
    if (step === "send" && !faxCfg) fetch("/api/fax").then((r) => r.json()).then(setFaxCfg).catch(() => setFaxCfg({ enabled: false, isCounty: false }));
  }, [step, faxCfg]);

  const formBytes = () => buildSnap29Pdf({ name, caseNumber, facts: facts!, exemptions: result && "exemptions" in result ? result.exemptions : [], proofJpegBase64: proof?.data });

  async function sendToCounty() {
    setFax({ state: "sending" });
    try {
      const bytes = await formBytes();
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const res = await fetch("/api/fax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdf: btoa(bin), reference: caseNumber, consent }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setFax({ state: "queued", id: json.friendlyID || json.faxID });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const st = await fetch(`/api/fax/status?id=${encodeURIComponent(json.faxID)}`).then((r) => r.json()).catch(() => ({}));
        if (st.status === "successful") { setFax({ state: "delivered", id: json.friendlyID || json.faxID, rawId: json.faxID }); setSentAt(new Date()); setStep("done"); return; }
        if (st.status === "failed") { setFax({ state: "failed" }); return; }
      }
    } catch {
      setFax({ state: "failed" });
    }
  }

  async function getForm() {
    if (!facts || !result || !("exemptions" in result)) return;
    let bytes: Uint8Array;
    try { bytes = await formBytes(); } catch (e) { console.error(e); setError(t.error); return; }
    const file = new File([bytes as BlobPart], `SNAP-29-${caseNumber || "form"}.pdf`, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); return; } catch { /* fall back to download */ }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function restart() {
    setStep("lang"); setStory(""); setLetter(null); setProof(null); setExtraction(null); setFacts(null); setCaseNumber(""); setName(""); setError(""); setConsent(false); setFax(null); setSkipped([]); setHistory([]); setShowPreview(false); setSentAt(null);
  }


  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pt-5 pb-6 text-navy">
      {step !== "lang" && (
        <header className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <h1 className="font-serif text-lg font-bold tracking-tight">Keep My SNAP</h1>
          </div>
          <button onClick={restart} className="rounded-md px-1 text-base font-semibold text-navy underline decoration-peach decoration-2 underline-offset-4 hover:decoration-accent">{t.startOver}</button>
        </header>
      )}

      {step === "lang" && (
        <section className="flex flex-1 flex-col">
          <div className="flex flex-col items-center pt-8 text-center">
            <Logo className="h-20 w-20" />
            <p className="mt-5 text-sm font-bold uppercase tracking-[0.16em] text-accent-ink">Essex County · NJ</p>
            <h1 className="mt-1 font-serif text-[2.25rem] font-bold leading-tight">Keep My SNAP</h1>
            <div className="mt-4 h-1 w-12 rounded-full bg-accent" aria-hidden="true" />
            <ul className="mt-5 space-y-1.5 text-[17px] text-ink">
              {(["es", "pt", "en"] as Lang[]).map((l) => <li key={l} lang={l}>{STRINGS[l].tagline}</li>)}
            </ul>
          </div>
          <div className="mt-auto flex flex-col gap-3 pt-10">
            <p className="flex flex-wrap justify-center gap-x-1.5 text-center text-base font-semibold text-ink">
              {(["es", "pt", "en"] as Lang[]).map((l, i) => <span key={l} lang={l} className="whitespace-nowrap">{STRINGS[l].chooseLang}{i < 2 && " · "}</span>)}
            </p>
            {(["es", "pt", "en"] as Lang[]).map((l) => (
              <button key={l} lang={l} className={`${secondary} flex items-center justify-between py-4 text-left text-xl`} onClick={() => { setLang(l); setStep("story"); }}>
                {{ es: "Español", pt: "Português", en: "English" }[l]}
                <Chevron />
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "story" && (
        <section className="flex flex-1 flex-col gap-3">
          <h2 className={heading}>{t.letterQ}</h2>
          {letter ? (
            <div className={`${card} flex items-center gap-4`}>
              <img src={letter.preview} alt="" className="h-24 w-20 shrink-0 rounded-md border border-line object-cover" />
              <label className={`${secondary} cursor-pointer`}>
                {t.letterChange}
                <input type="file" accept="image/*" className="sr-only"
                  onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLetter(await toPhoto(f)); }} />
              </label>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-navy/35 bg-white p-4 hover:border-navy">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy text-white"><CameraIcon className="h-6 w-6" /></span>
              <span className="flex flex-col">
                <span className="text-lg font-semibold text-navy">{t.letterPhoto}</span>
                <span className="text-base text-ink">{t.letterHint}</span>
              </span>
              <input type="file" accept="image/*" className="sr-only"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLetter(await toPhoto(f)); }} />
            </label>
          )}
          <label htmlFor="story" className={`${heading} mt-4`}>{t.storyQ}</label>
          <textarea id="story" value={story} onChange={(e) => setStory(e.target.value)} rows={5} maxLength={4000}
            placeholder={t.storyPlaceholder} className={`${field} p-4 text-base leading-relaxed placeholder:text-[#6b7280]`} />
          {error && <p role="alert" className="text-base font-semibold text-[#9b1c1c]">{error}</p>}
          <div className={actionBar}>
            <button className={primary} disabled={busy || !story.trim()} onClick={submitStory}>
              {busy ? t.reading : t.continue}
            </button>
          </div>
        </section>
      )}

      {step === "ask" && pending.length > 0 && (
        <section className="flex flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="flex min-h-11 items-center gap-1 rounded-full border-2 border-line bg-white pl-2.5 pr-4 text-base font-semibold text-navy hover:border-navy/50">
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {t.back}
            </button>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-sand">
              <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${(history.length / (history.length + pending.length)) * 100}%` }} />
            </div>
          </div>
          <p className="text-base font-semibold text-ink">{t.questionOf(history.length + 1, history.length + pending.length)}</p>
          <Question key={pending[0] + history.length} k={pending[0]} t={t} onAnswer={answer} />
        </section>
      )}

      {step === "confirm" && facts && (
        <section className="flex flex-1 flex-col gap-3">
          <h2 className={heading}>{t.confirmTitle}</h2>
          <div className={`${card} flex flex-col gap-4`}>
            <div>
              <label htmlFor="name" className={fieldLabel}>{t.yourName}</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={`${field} mt-1.5`} />
            </div>
            <div>
              <label htmlFor="case" className={fieldLabel}>{t.caseNumber} {extraction?.letter.case_number && <span className="font-normal text-ok">{t.fromLetter}</span>}</label>
              <input id="case" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} className={`${field} mt-1.5 font-mono`} />
              {!caseNumber && <p className="mt-1.5 text-base text-ink">{t.caseNumberHint}</p>}
            </div>
          </div>
          <FactRows facts={facts} t={t} />
          <div className={`${actionBar} flex gap-3`}>
            <button className={`${secondary} flex-1`} onClick={() => setStep("story")}>{t.fix}</button>
            <button className={`${primary} flex-[2]`} onClick={() => setStep("result")}>{t.correct}</button>
          </div>
        </section>
      )}

      {step === "result" && result && (
        <section className="flex flex-1 flex-col gap-4">
          <ResultCard result={result} t={t}>
          {daysUntil(extraction?.letter.hearing_request_deadline ?? null) != null && (
            <div className="flex gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-accent"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <div>
                <p className="text-lg font-bold leading-snug text-accent-ink">{t.daysLeft(daysUntil(extraction!.letter.hearing_request_deadline)!)}</p>
                <p className="mt-1 text-base text-navy">{t.hearingHow}</p>
              </div>
            </div>
          )}
          </ResultCard>
          {(result.status === "EXEMPT" || result.status === "CLAIM_COUNTY_DECIDES") && (
            <div className={actionBar}>
              <button className={primary} onClick={() => setStep("send")}>{t.seeWhatToDo}</button>
            </div>
          )}
        </section>
      )}

      {step === "send" && result && "exemptions" in result && (
        <section className="flex flex-1 flex-col gap-3">
          <h2 className={heading}>{t.stepsTitle}</h2>
          <ol className="flex flex-col gap-3">
            <li className={`${card} flex gap-3`}>
              <StepNum n={1} />
              <div className="flex-1">
                <p className="text-lg font-semibold">{t.step1}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-ink">
                  {result.exemptions.map((e) => <li key={e.id}>{t.proof[e.id] ?? e.proof}</li>)}
                </ul>
                <label className={`${proof ? secondary : primary} mt-3 flex cursor-pointer items-center justify-center gap-2`}>
                  {proof ? <CheckIcon className="h-5 w-5 text-ok" /> : <CameraIcon className="h-5 w-5" />}
                  {proof ? t.proofAdded : t.takeProof}
                  <input type="file" accept="image/*" className="sr-only"
                    onChange={async (e) => { const f = e.target.files?.[0]; if (f) setProof(await toPhoto(f)); }} />
                </label>
              </div>
            </li>
            <li className={`${card} flex gap-3`}>
              <StepNum n={2} />
              <div className="flex-1">
                <p className="text-lg font-semibold">{t.step2}</p>
                <p className="text-base text-ink">{t.step2Body}</p>
              </div>
            </li>
            <li className={`${card} flex gap-3`}>
              <StepNum n={3} />
              <div className="flex-1">
                <p className="text-lg font-semibold">{t.step3}</p>
                <p className="text-base text-ink">{t.step3Body}</p>
              </div>
            </li>
          </ol>
          <div className={`${card} flex flex-col gap-1.5`}>
            <label htmlFor="name2" className={fieldLabel}>{t.yourName}</label>
            <input id="name2" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
            <label htmlFor="case2" className={`${fieldLabel} mt-2.5`}>{t.caseNumber}</label>
            <input id="case2" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} className={`${field} font-mono`} />
          </div>
          <button className={secondary} disabled={!name.trim() || !caseNumber.trim()} onClick={() => setShowPreview(!showPreview)}>{showPreview ? t.hidePreview : t.previewForm}</button>
          {showPreview && <PdfPages key={`${name}|${caseNumber}|${proof ? "p" : ""}`} makeBytes={formBytes} loading={t.loadingForm} />}
          {error && <p role="alert" className="text-base font-semibold text-[#9b1c1c]">{error}</p>}
          <div className="mt-auto flex flex-col gap-3 pt-2">
            {faxCfg?.enabled && (
              <>
                {!faxCfg.simulated && !faxCfg.isCounty && <p className="rounded-lg bg-sand p-3 text-base text-navy">{t.demoNote}</p>}
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4 text-base text-navy">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-navy" />
                  <span>{t.consent}</span>
                </label>
                <button className={primary} disabled={!consent || !name.trim() || !caseNumber.trim() || (fax !== null && fax.state !== "failed")} onClick={sendToCounty}>{t.sendCounty}</button>
                {fax && (
                  <p role="status" className={`rounded-xl p-3 text-base font-semibold ${fax.state === "delivered" ? "bg-ok-soft text-ok" : fax.state === "failed" ? "bg-[#fdecea] text-[#9b1c1c]" : "bg-sand text-navy"}`}>
                    {fax.state === "sending" ? t.faxSending : fax.state === "queued" ? t.faxQueued : fax.state === "delivered" ? t.faxDelivered(fax.id!) : t.faxFailed}
                  </p>
                )}
                {fax?.state === "delivered" && faxCfg.simulated && (
                  <a href={`/api/fax/sent?id=${encodeURIComponent(fax.rawId!)}`} target="_blank" rel="noopener" className={textLink}>{t.viewSent}</a>
                )}
              </>
            )}
            <button className={faxCfg?.enabled ? secondary : primary} disabled={!name.trim() || !caseNumber.trim()} onClick={getForm}>{faxCfg?.enabled ? t.shareInstead : t.downloadForm}</button>
          </div>

        </section>
      )}

      {step === "done" && (
        <section className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col items-center gap-3 pt-4 pb-2 text-center">
            <CheckIcon className="h-20 w-20 text-ok" />
            <h2 className={`${heading} text-[1.7rem]`}>{t.sentTitle}</h2>
          </div>
          <dl className="divide-y divide-line rounded-2xl border border-line bg-white text-base">
            <div className="flex justify-between gap-3 p-4"><dt className="text-ink">{t.receiptLabel}</dt><dd className="font-mono font-semibold">{fax?.id}</dd></div>
            <div className="flex justify-between gap-3 p-4"><dt className="text-ink">{t.sentAt}</dt><dd className="text-right font-semibold">{sentAt?.toLocaleString(lang === "en" ? "en-US" : lang === "es" ? "es-US" : "pt-BR", { dateStyle: "medium", timeStyle: "short" })}</dd></div>
            <div className="flex justify-between gap-3 p-4"><dt className="text-ink">{t.caseNumber}</dt><dd className="font-mono font-semibold">{caseNumber}</dd></div>
          </dl>
          <div className="rounded-2xl bg-navy p-4 text-white">
            <p className="font-serif text-lg font-bold text-peach">{t.nextTitle}</p>
            <p className="mt-1 text-base">{t.nextBody}</p>
          </div>
          <h3 className="mt-2 font-serif text-xl font-bold">{t.yourForm}</h3>
          <PdfPages makeBytes={formBytes} loading={t.loadingForm} />
          <div className="mt-2 flex flex-col gap-3">
            <button className={primary} onClick={getForm}>{t.saveCopy}</button>
            <button className={secondary} onClick={restart}>{t.startOver}</button>
          </div>
        </section>
      )}
    </main>
  );
}

const StepNum = ({ n }: { n: number }) => (
  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy font-serif text-base font-bold text-white">{n}</span>
);

function Question({ k, t, onAnswer }: { k: string; t: (typeof STRINGS)["en"]; onAnswer: (k: string, v: string | number) => void }) {
  const [num, setNum] = useState("");
  const numeric = k === "age" || k === "work_hours_per_week" || k === "weekly_earnings";
  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="font-serif text-[1.65rem] font-bold leading-snug text-navy">{t.q[k]}</p>
      {t.help[k] && <p className="text-base text-ink">{t.help[k]}</p>}
      {numeric ? (
        <>
          <input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label={t.q[k]} className={`${field} mt-2 p-4 text-3xl font-semibold`} />
          <button className={primary} disabled={!num || Number.isNaN(Number(num))} onClick={() => onAnswer(k, Number(num))}>{t.continue}</button>
          {k !== "age" && <button className={textLink} onClick={() => onAnswer(k, "unknown")}>{t.dontKnow}</button>}
        </>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {(k === "unemployment_status" ? (["receiving", "applied", "no"] as const).map((v) => [v, t.ui[v]] as const) : ([["yes", t.yes], ["no", t.no]] as const)).map(([v, label]) => (
            <button key={v} className={`${secondary} flex items-center justify-between gap-3 py-4 text-left text-lg`} onClick={() => onAnswer(k, v)}>{label}<Chevron /></button>
          ))}
          <button className={textLink} onClick={() => onAnswer(k, "unknown")}>{t.dontKnow}</button>
        </div>
      )}
    </div>
  );
}

function FactRows({ facts, t }: { facts: Facts; t: (typeof STRINGS)["en"] }) {
  const rows: [string, string][] = [];
  if (facts.age != null) rows.push([t.age, String(facts.age)]);
  if (facts.work_hours_per_week != null) rows.push([t.hours, String(facts.work_hours_per_week)]);
  if (facts.hourly_wage != null) rows.push([t.wage, `$${facts.hourly_wage}`]);
  if (facts.weekly_earnings != null) rows.push([t.weekly, `$${facts.weekly_earnings}`]);
  if (facts.monthly_earnings != null) rows.push([t.monthly, `$${facts.monthly_earnings}`]);
  if (facts.unemployment_status !== "unknown") rows.push([t.q.unemployment_status, t.ui[facts.unemployment_status]]);
  for (const [k, v] of Object.entries(facts)) {
    if (k.startsWith("q") && (v === "yes" || v === "no")) rows.push([t.q[k], v === "yes" ? t.yes : t.no]);
  }
  return (
    <dl className="divide-y divide-line rounded-2xl border border-line bg-white">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-4 py-3 text-base"><dt className="text-ink">{label}</dt><dd className="text-right font-semibold text-navy">{value}</dd></div>
      ))}
    </dl>
  );
}

function ResultCard({ result, t, children }: { result: Result; t: (typeof STRINGS)["en"]; children?: ReactNode }) {
  if (result.status === "EXEMPT" || result.status === "CLAIM_COUNTY_DECIDES") {
    const claim = result.status === "CLAIM_COUNTY_DECIDES";
    return (
      <>
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          {claim
            ? <div aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-full bg-peach font-serif text-4xl font-bold text-navy">?</div>
            : <CheckIcon className="h-20 w-20 text-ok" />}
          <h2 className={heading}>{claim ? t.claimTitle : t.exemptTitle}</h2>
          {claim && <p className="text-base text-ink">{t.claimNote}</p>}
        </div>
        <div className={card}>
          <p className="text-base font-semibold text-ink">{t.qualifyFor}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {result.exemptions.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-lg font-semibold"><CheckIcon className={`mt-1 h-5 w-5 shrink-0 ${claim ? "text-accent" : "text-ok"}`} /><span>{t.ex[e.id]}</span></li>
            ))}
          </ul>
        </div>
        {children}
        <div className="rounded-2xl border-l-4 border-accent bg-white p-4 shadow-[0_1px_2px_rgba(19,35,63,0.05)]">
          <p className="text-lg font-bold text-accent-ink">{t.onlyCounts}</p>
          <p className="text-base text-navy">{t.doThisWeek}</p>
        </div>
        <p className="text-base text-ink">{t.countyFinal}</p>
        <p className="text-sm text-ink">{result.exemptions.map((e) => e.cite).join(" · ")}</p>
      </>
    );
  }
  if (result.status === "NOT_EXEMPT") {
    return (
      <>
      <div className={card}>
        <h2 className="font-serif text-xl font-bold">{t.notExemptTitle}</h2>
        <p className="mt-1">{t.notExemptBody}</p>
        {result.meets80Hours && <p className="mt-2 font-semibold text-ok">{t.meets80}</p>}
        <p className="mt-4 font-semibold">{t.neHow}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-ink">
          <li>{t.neTraining}</li>
          <li>{t.neVolunteer}
            <ul className="mt-1 list-[circle] space-y-1 pl-5">{t.neSites.map((x) => <li key={x}>{x}</li>)}</ul>
          </li>
        </ul>
        <p className="mt-3 text-base">{t.neGoodReason}</p>
        <p className="mt-2 text-base">{t.neStopped}</p>
      </div>
      {children}
      </>
    );
  }
  if (result.status === "NEED_MORE_INFO") {
    return (
      <>
      <div className={card}>
        <h2 className="font-serif text-xl font-bold">{t.unsureTitle}</h2>
        <p className="mt-1">{t.unsureBody}</p>
        <p className="mt-3 text-base">{t.neStopped}</p>
      </div>
      {children}
      </>
    );
  }
  if (result.status === "NOT_SUBJECT") {
    return (
      <>
      <div className={card}>
        <h2 className="font-serif text-xl font-bold">{t.notSubjectTitle}</h2>
        <p className="mt-1">{t.notSubjectBody}</p>
      </div>
      {children}
      </>
    );
  }
  return <>{children}</>;
}
