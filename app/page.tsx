"use client";

import { useEffect, useState } from "react";
import { decide, type Facts, type Result } from "@/lib/rules.ts";
import { STRINGS, type Lang } from "@/lib/i18n.ts";
import type { Extraction } from "@/lib/extract.ts";
import { buildSnap29Pdf } from "@/lib/pdf.ts";

type Step = "lang" | "story" | "ask" | "confirm" | "result" | "send";
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

const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso + "T23:59:59").getTime() - Date.now()) / 86_400_000);
  return d >= 0 ? d : null;
};

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
  const t = STRINGS[lang];
  const result: Result | null = facts ? decide(facts) : null;

  async function submitStory() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, letterImage: letter ? { mediaType: letter.mediaType, data: letter.data } : undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t.error);
      setExtraction(json);
      setFacts(json.facts);
      setCaseNumber(json.letter.case_number ?? "");
      setStep(decide(json.facts).status === "NEED_MORE_INFO" ? "ask" : "confirm");
    } catch (e) {
      setError((e as Error).message || t.error);
    } finally {
      setBusy(false);
    }
  }

  function answer(key: string, value: string | number) {
    const next = { ...facts!, [key]: value } as Facts;
    setFacts(next);
    if (decide(next).status !== "NEED_MORE_INFO") setStep("confirm");
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
        if (st.status === "successful") { setFax({ state: "delivered", id: json.friendlyID || json.faxID, rawId: json.faxID }); return; }
        if (st.status === "failed") { setFax({ state: "failed" }); return; }
      }
    } catch {
      setFax({ state: "failed" });
    }
  }

  async function getForm() {
    if (!facts || !result || !("exemptions" in result)) return;
    const bytes = await formBytes();
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
    setStep("lang"); setStory(""); setLetter(null); setProof(null); setExtraction(null); setFacts(null); setCaseNumber(""); setName(""); setError(""); setConsent(false); setFax(null);
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

      {step === "ask" && result?.status === "NEED_MORE_INFO" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t.askTitle}</h2>
          <Question key={result.ask[0]} k={result.ask[0]} t={t} onAnswer={answer} />
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
        <section className="flex flex-1 flex-col gap-3">
          <ResultCard result={result} t={t} />
          {daysUntil(extraction?.letter.hearing_request_deadline ?? null) != null && (
            <p className="rounded-xl bg-red-50 p-3 font-semibold text-red-800">{t.daysLeft(daysUntil(extraction!.letter.hearing_request_deadline)!)}</p>
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
          <div className="mt-auto flex flex-col gap-2">
            {faxCfg?.enabled && (
              <>
                {(faxCfg.simulated || !faxCfg.isCounty) && <p className="rounded-lg bg-neutral-200 p-2 text-xs text-neutral-700">{faxCfg.simulated ? t.simNote : t.demoNote}</p>}
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
          {(!name.trim() || !caseNumber.trim()) && <p className="text-sm text-neutral-600">{t.needNameCase}</p>}
        </section>
      )}
    </main>
  );
}

function Question({ k, t, onAnswer }: { k: string; t: (typeof STRINGS)["en"]; onAnswer: (k: string, v: string | number) => void }) {
  const [num, setNum] = useState("");
  const numeric = k === "age" || k === "work_hours_per_week" || k === "weekly_earnings";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-base">{t.q[k]}</p>
      {numeric ? (
        <>
          <input inputMode="decimal" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9.]/g, ""))}
            className="rounded-lg border border-neutral-300 p-3 text-lg" />
          <button className={primary} disabled={!num} onClick={() => onAnswer(k, Number(num))}>{t.continue}</button>
        </>
      ) : k === "unemployment_status" ? (
        (["receiving", "applied", "no"] as const).map((v) => <button key={v} className={secondary} onClick={() => onAnswer(k, v)}>{t.ui[v]}</button>)
      ) : (
        <div className="flex gap-2">
          <button className={secondary} onClick={() => onAnswer(k, "yes")}>{t.yes}</button>
          <button className={secondary} onClick={() => onAnswer(k, "no")}>{t.no}</button>
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
        <div className={`rounded-xl p-4 ${claim ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>
          <p className="text-lg font-bold">{claim ? t.claimTitle : t.exemptTitle}</p>
          {result.exemptions.map((e) => <p key={e.id}>{t.ex[e.id]}</p>)}
          {claim && <p className="mt-1 text-sm">{t.claimNote}</p>}
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
