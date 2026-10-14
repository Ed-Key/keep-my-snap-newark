"use client";

import { useEffect, useState } from "react";
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

const btn = "w-full rounded-xl px-4 py-3 text-center text-base font-semibold";
const primary = `${btn} bg-blue-700 text-white active:bg-blue-800 disabled:opacity-50`;
const secondary = `${btn} border border-neutral-300 bg-white text-neutral-900 active:bg-neutral-100`;

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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 bg-neutral-50 px-4 py-6 text-neutral-900">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{step === "lang" ? "Conserve su SNAP · Mantenha seu SNAP · Keep your SNAP" : t.title}</h1>
        {step !== "lang" && <button onClick={restart} className="text-sm text-blue-700 underline">{t.startOver}</button>}
      </header>

      {step === "lang" && (
        <section className="flex flex-1 flex-col gap-3">
          <p className="text-neutral-600">Gratis. Privado. · Grátis. Privado. · Free. Private.</p>
          <div className="mt-auto flex flex-col gap-3">
            {(["es", "pt", "en"] as Lang[]).map((l) => (
              <button key={l} className={secondary} onClick={() => { setLang(l); setStep("story"); }}>
                {{ es: "Español", pt: "Português", en: "English" }[l]}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "story" && (
        <section className="flex flex-1 flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.letterQ}</h2>
          <label className={letter ? secondary : primary}>
            {letter ? t.letterChange : t.letterPhoto}
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLetter(await toPhoto(f)); }} />
          </label>
          {letter ? <img src={letter.preview} alt="" className="max-h-40 rounded-lg object-contain" /> : <p className="text-sm text-neutral-600">{t.letterHint}</p>}
          <label htmlFor="story" className="mt-2 text-lg font-semibold">{t.storyQ}</label>
          <textarea id="story" value={story} onChange={(e) => setStory(e.target.value)} rows={5} maxLength={4000}
            placeholder={t.storyPlaceholder} className="rounded-xl border border-neutral-300 bg-white p-3 text-base" />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className={`${primary} mt-auto`} disabled={busy || !story.trim()} onClick={submitStory}>
            {busy ? t.reading : t.continue}
          </button>
        </section>
      )}

      {step === "ask" && pending.length > 0 && (
        <section className="flex flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm">← {t.back}</button>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${(history.length / (history.length + pending.length)) * 100}%` }} />
            </div>
          </div>
          <p className="text-sm font-medium text-neutral-600">{t.questionOf(history.length + 1, history.length + pending.length)}</p>
          <Question key={pending[0] + history.length} k={pending[0]} t={t} onAnswer={answer} />
        </section>
      )}

      {step === "confirm" && facts && (
        <section className="flex flex-1 flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.confirmTitle}</h2>
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <label htmlFor="name" className="text-sm font-medium">{t.yourName}</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-base" />
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <label htmlFor="case" className="text-sm font-medium">{t.caseNumber} {extraction?.letter.case_number && <span className="text-neutral-500">{t.fromLetter}</span>}</label>
            <input id="case" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-base" />
            {!caseNumber && <p className="mt-1 text-xs text-neutral-600">{t.caseNumberHint}</p>}
          </div>
          <FactRows facts={facts} t={t} />
          <div className="mt-auto flex gap-2">
            <button className={secondary} onClick={() => setStep("story")}>{t.fix}</button>
            <button className={primary} onClick={() => setStep("result")}>{t.correct}</button>
          </div>
        </section>
      )}

      {step === "result" && result && (
        <section className="flex flex-1 flex-col gap-4">
          <ResultCard result={result} t={t} />
          {daysUntil(extraction?.letter.hearing_request_deadline ?? null) != null && (
            <div className="rounded-xl bg-red-50 p-3 text-red-800"><p className="font-semibold">{t.daysLeft(daysUntil(extraction!.letter.hearing_request_deadline)!)}</p><p className="text-sm">{t.hearingHow}</p></div>
          )}
          {(result.status === "EXEMPT" || result.status === "CLAIM_COUNTY_DECIDES") && (
            <button className={`${primary} mt-auto`} onClick={() => setStep("send")}>{t.seeWhatToDo}</button>
          )}
        </section>
      )}

      {step === "send" && result && "exemptions" in result && (
        <section className="flex flex-1 flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.stepsTitle}</h2>
          <ol className="flex flex-col gap-3">
            <li className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="font-semibold">1. {t.step1}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
                {result.exemptions.map((e) => <li key={e.id}>{t.proof[e.id] ?? e.proof}</li>)}
              </ul>
              <label className={`${proof ? secondary : primary} mt-2 block`}>
                {proof ? `✓ ${t.proofAdded}` : t.takeProof}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={async (e) => { const f = e.target.files?.[0]; if (f) setProof(await toPhoto(f)); }} />
              </label>
            </li>
            <li className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="font-semibold">2. {t.step2}</p>
              <p className="text-sm text-neutral-700">{t.step2Body}</p>
            </li>
            <li className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="font-semibold">3. {t.step3}</p>
              <p className="text-sm text-neutral-700">{t.step3Body}</p>
            </li>
          </ol>
          <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3">
            <label htmlFor="name2" className="text-sm font-medium">{t.yourName}</label>
            <input id="name2" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="w-full rounded-lg border border-neutral-300 p-2 text-base" />
            <label htmlFor="case2" className="text-sm font-medium">{t.caseNumber}</label>
            <input id="case2" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} className="w-full rounded-lg border border-neutral-300 p-2 text-base" />
          </div>
          <button className={secondary} disabled={!name.trim() || !caseNumber.trim()} onClick={() => setShowPreview(!showPreview)}>{showPreview ? t.hidePreview : t.previewForm}</button>
          {showPreview && <PdfPages key={`${name}|${caseNumber}|${proof ? "p" : ""}`} makeBytes={formBytes} loading={t.loadingForm} />}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="mt-auto flex flex-col gap-2">
            {faxCfg?.enabled && (
              <>
                {!faxCfg.simulated && !faxCfg.isCounty && <p className="rounded-lg bg-neutral-200 p-2 text-xs text-neutral-700">{t.demoNote}</p>}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5" />
                  <span>{t.consent}</span>
                </label>
                <button className={primary} disabled={!consent || !name.trim() || !caseNumber.trim() || (fax !== null && fax.state !== "failed")} onClick={sendToCounty}>{t.sendCounty}</button>
                {fax && (
                  <p role="status" className={`rounded-lg p-3 text-sm font-semibold ${fax.state === "delivered" ? "bg-green-50 text-green-900" : fax.state === "failed" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>
                    {fax.state === "sending" ? t.faxSending : fax.state === "queued" ? t.faxQueued : fax.state === "delivered" ? t.faxDelivered(fax.id!) : t.faxFailed}
                  </p>
                )}
                {fax?.state === "delivered" && faxCfg.simulated && (
                  <a href={`/api/fax/sent?id=${encodeURIComponent(fax.rawId!)}`} target="_blank" rel="noopener" className="text-center text-sm text-blue-700 underline">{t.viewSent}</a>
                )}
              </>
            )}
            <button className={faxCfg?.enabled ? secondary : primary} disabled={!name.trim() || !caseNumber.trim()} onClick={getForm}>{faxCfg?.enabled ? t.shareInstead : t.downloadForm}</button>
          </div>

        </section>
      )}

      {step === "done" && (
        <section className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckIcon className="h-20 w-20 text-green-600" />
            <h2 className="text-2xl font-bold">{t.sentTitle}</h2>
          </div>
          <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white text-sm">
            <div className="flex justify-between p-3"><span className="text-neutral-600">{t.receiptLabel}</span><span className="font-mono font-semibold">{fax?.id}</span></div>
            <div className="flex justify-between p-3"><span className="text-neutral-600">{t.sentAt}</span><span className="font-semibold">{sentAt?.toLocaleString(lang === "en" ? "en-US" : lang === "es" ? "es-US" : "pt-BR", { dateStyle: "medium", timeStyle: "short" })}</span></div>
            <div className="flex justify-between p-3"><span className="text-neutral-600">{t.caseNumber}</span><span className="font-semibold">{caseNumber}</span></div>
          </div>
          <div className="rounded-xl bg-blue-50 p-4 text-blue-950">
            <p className="font-semibold">{t.nextTitle}</p>
            <p className="mt-1 text-sm">{t.nextBody}</p>
          </div>
          <h3 className="font-semibold">{t.yourForm}</h3>
          <PdfPages makeBytes={formBytes} loading={t.loadingForm} />
          <div className="mt-2 flex flex-col gap-2">
            <button className={primary} onClick={getForm}>{t.saveCopy}</button>
            <button className={secondary} onClick={restart}>{t.startOver}</button>
          </div>
        </section>
      )}
    </main>
  );
}

function Question({ k, t, onAnswer }: { k: string; t: (typeof STRINGS)["en"]; onAnswer: (k: string, v: string | number) => void }) {
  const [num, setNum] = useState("");
  const numeric = k === "age" || k === "work_hours_per_week" || k === "weekly_earnings";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-2xl font-bold leading-snug">{t.q[k]}</p>
      {t.help[k] && <p className="text-base text-neutral-600">{t.help[k]}</p>}
      {numeric ? (
        <>
          <input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label={t.q[k]} className="mt-2 rounded-xl border border-neutral-300 bg-white p-4 text-2xl" />
          <button className={primary} disabled={!num || Number.isNaN(Number(num))} onClick={() => onAnswer(k, Number(num))}>{t.continue}</button>
          {k !== "age" && <button className="py-2 text-center text-base text-blue-700 underline" onClick={() => onAnswer(k, "unknown")}>{t.dontKnow}</button>}
        </>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {(k === "unemployment_status" ? (["receiving", "applied", "no"] as const).map((v) => [v, t.ui[v]] as const) : ([["yes", t.yes], ["no", t.no]] as const)).map(([v, label]) => (
            <button key={v} className={`${secondary} py-4 text-left text-lg`} onClick={() => onAnswer(k, v)}>{label}</button>
          ))}
          <button className="py-2 text-center text-base text-blue-700 underline" onClick={() => onAnswer(k, "unknown")}>{t.dontKnow}</button>
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
    <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 p-3 text-sm"><span>{label}</span><span className="font-semibold">{value}</span></div>
      ))}
    </div>
  );
}

function ResultCard({ result, t }: { result: Result; t: (typeof STRINGS)["en"] }) {
  if (result.status === "EXEMPT" || result.status === "CLAIM_COUNTY_DECIDES") {
    const claim = result.status === "CLAIM_COUNTY_DECIDES";
    return (
      <>
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          {claim
            ? <div aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500 text-4xl font-bold text-white">?</div>
            : <CheckIcon className="h-20 w-20 text-green-600" />}
          <h2 className="text-2xl font-bold leading-snug">{claim ? t.claimTitle : t.exemptTitle}</h2>
          {claim && <p className="text-sm text-neutral-700">{t.claimNote}</p>}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-sm font-semibold text-neutral-600">{t.qualifyFor}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {result.exemptions.map((e) => (
              <li key={e.id} className="flex items-start gap-2"><CheckIcon className={`mt-0.5 h-5 w-5 shrink-0 ${claim ? "text-amber-500" : "text-green-600"}`} /><span>{t.ex[e.id]}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-orange-50 p-4 text-orange-900">
          <p className="text-lg font-bold">{t.onlyCounts}</p>
          <p>{t.doThisWeek}</p>
        </div>
        <p className="text-sm text-neutral-600">{t.countyFinal}</p>
        <p className="text-xs text-neutral-500">{result.exemptions.map((e) => e.cite).join(" · ")}</p>
      </>
    );
  }
  if (result.status === "NOT_EXEMPT") {
    return (
      <div className="rounded-xl bg-white p-4">
        <p className="text-lg font-bold">{t.notExemptTitle}</p>
        <p>{t.notExemptBody}</p>
        {result.meets80Hours && <p className="mt-2 text-green-800">{t.meets80}</p>}
        <p className="mt-3 font-semibold">{t.neHow}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          <li>{t.neTraining}</li>
          <li>{t.neVolunteer}
            <ul className="mt-1 list-[circle] space-y-1 pl-5">{t.neSites.map((x) => <li key={x}>{x}</li>)}</ul>
          </li>
        </ul>
        <p className="mt-3 text-sm">{t.neGoodReason}</p>
        <p className="mt-2 text-sm">{t.neStopped}</p>
      </div>
    );
  }
  if (result.status === "NEED_MORE_INFO") {
    return (
      <div className="rounded-xl bg-white p-4">
        <p className="text-lg font-bold">{t.unsureTitle}</p>
        <p>{t.unsureBody}</p>
        <p className="mt-3 text-sm">{t.neStopped}</p>
      </div>
    );
  }
  if (result.status === "NOT_SUBJECT") {
    return (
      <div className="rounded-xl bg-white p-4">
        <p className="text-lg font-bold">{t.notSubjectTitle}</p>
        <p>{t.notSubjectBody}</p>
      </div>
    );
  }
  return null;
}
