import { createServerFn } from "@tanstack/react-start";

export const transcribeVideo = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    return data;
  })
  .handler(async ({ data }) => {
    const file = data.get("file");
    const model = (data.get("model") as string) || "openai/gpt-4o-mini-transcribe";
    if (!(file instanceof File)) throw new Error("No file uploaded");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const upstream = new FormData();
    upstream.append("file", file, file.name || "upload");
    upstream.append("model", model);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("Out of AI credits. Please add credits in Settings.");
      if (res.status === 429) throw new Error("Rate limited. Try again in a moment.");
      throw new Error(`Transcription failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as { text?: string };
    const text = (json.text || "").trim();

    // Split into lines: by sentence-ending punctuation, fallback to newlines/long chunks.
    const sentences = text
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/g)
      .flatMap((s) => s.split(/\n+/))
      .map((s) => s.trim())
      .filter(Boolean);

    return { text, lines: sentences };
  });
