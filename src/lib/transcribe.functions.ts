import { createServerFn } from "@tanstack/react-start";

export const transcribeVideo = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    return data;
  })
  .handler(async ({ data }) => {
    const file = data.get("file");
    const mode = (data.get("model") as string) || "fast";
    const duration = parseFloat(data.get("duration") as string) || 0;
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

    function fmtTime(totalSeconds: number) {
      const hrs = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = Math.floor(totalSeconds % 60);
      if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
      }
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }

    function parseTimeToSeconds(time: string) {
      const parts = time.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return 0;
    }

    function fillMissingTimes(
      lines: { time: string; text: string }[],
      totalDuration: number,
    ) {
      if (totalDuration <= 0 || lines.length === 0) return lines;
      const parsed = lines.map((l) => ({
        ...l,
        seconds: l.time ? parseTimeToSeconds(l.time) : null,
      }));

      let firstKnown = -1;
      let lastKnown = -1;
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].seconds !== null) {
          if (firstKnown === -1) firstKnown = i;
          lastKnown = i;
        }
      }

      if (firstKnown === -1) {
        for (let i = 0; i < parsed.length; i++) {
          parsed[i].seconds = (i * totalDuration) / parsed.length;
        }
      } else {
        const firstTime = parsed[firstKnown].seconds!;
        for (let i = 0; i < firstKnown; i++) {
          parsed[i].seconds = (i * firstTime) / firstKnown;
        }
        let prev = firstKnown;
        for (let i = firstKnown + 1; i <= lastKnown; i++) {
          if (parsed[i].seconds !== null) {
            const startTime = parsed[prev].seconds!;
            const endTime = parsed[i].seconds!;
            const gap = i - prev;
            for (let j = prev + 1; j < i; j++) {
              parsed[j].seconds =
                startTime + ((j - prev) * (endTime - startTime)) / gap;
            }
            prev = i;
          }
        }
        const lastTime = parsed[lastKnown].seconds!;
        const remaining = parsed.length - lastKnown - 1;
        if (remaining > 0) {
          const step = (totalDuration - lastTime) / (remaining + 1);
          for (let i = lastKnown + 1; i < parsed.length; i++) {
            parsed[i].seconds = lastTime + (i - lastKnown) * step;
          }
        }
      }

      return parsed.map((l) => ({ time: fmtTime(l.seconds ?? 0), text: l.text }));
    }

    const systemPrompt =
      "You are an expert transcriber. Transcribe the provided audio/video verbatim in the original language. " +
      "Break the transcript into short, natural lines (one sentence or clause per line, ~6-15 words). " +
      "Every line MUST start with its start timestamp in [MM:SS] format (use [HH:MM:SS] if longer than an hour). " +
      "Examples:\n" +
      "[00:02] It's 2 a.m. and your baby will not stop crying.\n" +
      "[00:05] You've tried rocking.\n\n" +
      "Do not omit timestamps. If exact timing is uncertain, estimate based on speech rhythm. " +
      "Separate lines with a single blank line. Output ONLY the transcript — no preamble, no commentary, no markdown code blocks.";

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
    const raw = (json.choices?.[0]?.message?.content || "").trim();
    const text = raw
      .replace(/^```[\w]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

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

    const finalLines = fillMissingTimes(lines, duration);

    return {
      text: finalLines.map((l) => `[${l.time}] ${l.text}`).join("\n\n"),
      lines: finalLines,
    };
  });
