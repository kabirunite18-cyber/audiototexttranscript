import { createServerFn } from "@tanstack/react-start";

type Segment = { start: number; end: number; text: string };

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

    // whisper-1 supports verbose_json with segment timestamps.
    // The newer gpt-4o transcribe models only return plain text.
    const useWhisper = true;
    const upstreamModel = useWhisper ? "openai/whisper-1" : model;

    const upstream = new FormData();
    upstream.append("file", file, file.name || "upload");
    upstream.append("model", upstreamModel);
    upstream.append("response_format", "verbose_json");
    upstream.append("timestamp_granularities[]", "segment");

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

    const json = (await res.json()) as { text?: string; segments?: Segment[] };
    const text = (json.text || "").trim();
    const segments = json.segments || [];

    const fmt = (sec: number) => {
      const s = Math.max(0, Math.floor(sec));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      const pad = (n: number) => n.toString().padStart(2, "0");
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
    };

    const lines = segments.length
      ? segments
          .map((s) => ({ time: fmt(s.start), text: (s.text || "").trim() }))
          .filter((l) => l.text)
      : text
          .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/g)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => ({ time: "", text: t }));

    return { text, lines };
  });
