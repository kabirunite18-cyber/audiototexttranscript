import { createServerFn } from "@tanstack/react-start";

export const transcribeVideo = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    return data;
  })
  .handler(async ({ data }) => {
    const file = data.get("file");
    const mode = (data.get("model") as string) || "fast";
    if (!(file instanceof File)) throw new Error("No file uploaded");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const model =
      mode === "accurate" || mode.includes("pro")
        ? "google/gemini-2.5-pro"
        : "google/gemini-3-flash-preview";

    // Base64-encode the uploaded media for inline multimodal input.
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);
    const mime = file.type || "audio/mpeg";
    const dataUrl = `data:${mime};base64,${base64}`;

    const systemPrompt =
      "You are an expert transcriber. Transcribe the provided audio/video verbatim in the original language. " +
      "Break the transcript into short, natural lines (one sentence or clause per line, ~6-15 words). " +
      "Prefix every line with its start timestamp in the format [MM:SS] (or [HH:MM:SS] if longer than an hour). " +
      "Separate lines with a single blank line. Output ONLY the transcript — no preamble, no commentary, no markdown.";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe this and return timestamped lines as instructed." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("Out of AI credits. Please add credits in Settings.");
      if (res.status === 429) throw new Error("Rate limited. Try again in a moment.");
      throw new Error(`Transcription failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (json.choices?.[0]?.message?.content || "").trim();

    // Parse "[MM:SS] text" or "[HH:MM:SS] text" lines.
    const lineRegex = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/;
    const lines = text
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(lineRegex);
        return m ? { time: m[1], text: m[2].trim() } : { time: "", text: l };
      })
      .filter((l) => l.text);

    return { text, lines };
  });
