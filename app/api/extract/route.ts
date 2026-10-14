import { extract, type LetterImage } from "@/lib/extract.ts";

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  let body: { story?: unknown; letterImage?: { mediaType?: unknown; data?: unknown } };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const story = typeof body.story === "string" ? body.story.trim() : "";
  if (!story || story.length > 4000) return Response.json({ error: "Tell us what's happening (up to 4,000 characters)." }, { status: 400 });

  let image: LetterImage | undefined;
  if (body.letterImage) {
    const { mediaType, data } = body.letterImage;
    if (typeof mediaType !== "string" || !MEDIA.has(mediaType) || typeof data !== "string" || data.length > 4_000_000) {
      return Response.json({ error: "That photo couldn't be read. Try a JPEG or PNG under 3 MB." }, { status: 400 });
    }
    image = { mediaType: mediaType as LetterImage["mediaType"], data };
  }

  try {
    return Response.json(await extract(story, image));
  } catch (e) {
    console.error("extract failed", e);
    return Response.json({ error: "Something went wrong reading your story. Please try again." }, { status: 502 });
  }
}
