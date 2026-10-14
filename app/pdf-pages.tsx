"use client";

import { useEffect, useState } from "react";

// Shows a PDF as page images. Phones won't reliably render a PDF in an iframe,
// so pdf.js draws each page to a canvas instead.
export function PdfPages({ makeBytes, loading }: { makeBytes: () => Promise<Uint8Array>; loading: string }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ data: (await makeBytes()).slice() }).promise;
        const out: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.6 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
          out.push(canvas.toDataURL("image/png"));
        }
        if (!cancelled) setPages(out);
      } catch (e) {
        console.error(e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // Render once per mount; the parent remounts it when the form changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null;
  if (!pages) return <p className="text-base text-ink">{loading}</p>;
  return (
    <div className="flex flex-col gap-3">
      {pages.map((src, i) => (
        <img key={i} src={src} alt={`Page ${i + 1}`} className="w-full rounded-xl border border-line bg-white shadow-sm" />
      ))}
    </div>
  );
}
