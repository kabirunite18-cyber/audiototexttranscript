import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";
import { Upload, Zap, Target, Loader2, Copy, Download, FileVideo, X } from "lucide-react";
import { transcribeVideo } from "@/lib/transcribe.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Video Transcriber — Line by Line" },
      { name: "description", content: "Upload a video and get a clean, line-by-line transcript powered by AI." },
      { property: "og:title", content: "Video Transcriber — Line by Line" },
      { property: "og:description", content: "Upload a video and get a clean, line-by-line transcript powered by AI." },
    ],
  }),
  component: Index,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-lg font-semibold">Something broke</h2>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={() => { router.invalidate(); reset(); }}>Try again</Button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-10 text-center">Not found</div>,
});

const ACCEPTED = ["video/", "audio/"];
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

function Index() {
  const run = useServerFn(transcribeVideo);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [model, setModel] = useState<"fast" | "accurate">("fast");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<{ time: string; text: string }[]>([]);
  const [view, setView] = useState<"segments" | "paragraphs">("segments");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);


  // Group consecutive lines into paragraphs (~4 lines each) keeping the first timestamp.
  const paragraphs = (() => {
    const out: { time: string; text: string }[] = [];
    const SIZE = 4;
    for (let i = 0; i < lines.length; i += SIZE) {
      const chunk = lines.slice(i, i + SIZE);
      out.push({
        time: chunk[0]?.time || "",
        text: chunk.map((l) => l.text).join(" "),
      });
    }
    return out;
  })();

  const displayed = view === "paragraphs" ? paragraphs : lines;

  const onFile = useCallback(async (f: File | null) => {
    if (!f) return;
    if (!ACCEPTED.some((p) => f.type.startsWith(p))) {
      toast.error("Please upload a video or audio file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("File is too large (max 100MB).");
      return;
    }
    setFile(f);
    setDuration(await getMediaDuration(f));
    setLines([]);
  }, []);


  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    onFile(e.dataTransfer.files?.[0] ?? null);
  };

  const transcribe = async () => {
    if (!file) return;
    setBusy(true);
    setLines([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append(
        "model",
        model === "fast" ? "openai/gpt-4o-mini-transcribe" : "openai/gpt-4o-transcribe",
      );
      const result = await run({ data: fd });
      setLines(result.lines.length ? result.lines : (result.text ? [{ time: "", text: result.text }] : []));
      toast.success("Transcription complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setBusy(false);
    }
  };

  const formatLine = (l: { time: string; text: string }) =>
    l.time ? `[${l.time}] ${l.text}` : l.text;

  const copyAll = () => {
    navigator.clipboard.writeText(displayed.map(formatLine).join("\n\n"));
    toast.success("Copied to clipboard");
  };

  const download = () => {
    const blob = new Blob([displayed.map(formatLine).join("\n\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name?.replace(/\.[^.]+$/, "") || "transcript"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <header className="mb-10 text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Powered by Lovable AI
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Video Transcriber
          </h1>
          <p className="text-muted-foreground">
            Upload a video — get a clean, line-by-line transcript in seconds.
          </p>
        </header>

        <div className="rounded-2xl border bg-card p-6 md:p-8 shadow-sm space-y-6">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "relative cursor-pointer rounded-xl border-2 border-dashed transition-colors",
              "px-6 py-12 text-center",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileVideo className="size-5 text-primary" />
                <div className="text-left">
                  <div className="text-sm font-medium truncate max-w-[260px]">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); setLines([]); }}
                  className="ml-2 rounded-full p-1 hover:bg-muted"
                  aria-label="Remove file"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="grid size-12 place-items-center rounded-full bg-muted">
                  <Upload className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="font-medium">Drop video here or click to browse</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    MP4 · MOV · WEBM · MP3 · WAV · M4A — Max 100MB
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-3">
            <ModeCard
              active={model === "fast"}
              onClick={() => setModel("fast")}
              icon={<Zap className="size-4 text-amber-500" />}
              title="Fast"
              hint="1× credits"
            />
            <ModeCard
              active={model === "accurate"}
              onClick={() => setModel("accurate")}
              icon={<Target className="size-4 text-rose-500" />}
              title="Accuracy"
              hint="2× credits"
            />
          </div>

          {/* Action */}
          <Button
            onClick={transcribe}
            disabled={!file || busy}
            className="w-full h-12 text-base"
          >
            {busy ? (
              <><Loader2 className="size-4 animate-spin" /> Transcribing…</>
            ) : (
              <>Transcribe →</>
            )}
          </Button>
        </div>

        {/* Output */}
        {lines.length > 0 && (
          <div className="mt-8 rounded-2xl border bg-card p-6 md:p-8 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">Transcript</h2>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setView("segments")}
                    className={cn(
                      "px-3 py-1 text-xs rounded-md transition-colors",
                      view === "segments" ? "bg-background shadow-sm font-medium" : "text-muted-foreground",
                    )}
                  >
                    Segments
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("paragraphs")}
                    className={cn(
                      "px-3 py-1 text-xs rounded-md transition-colors",
                      view === "paragraphs" ? "bg-background shadow-sm font-medium" : "text-muted-foreground",
                    )}
                  >
                    Paragraphs
                  </button>
                </div>
                <Button variant="outline" size="sm" onClick={copyAll}>
                  <Copy className="size-3.5" /> Copy
                </Button>
                <Button variant="outline" size="sm" onClick={download}>
                  <Download className="size-3.5" /> Download
                </Button>
              </div>
            </div>
            <ol className={view === "paragraphs" ? "space-y-5" : "space-y-3"}>
              {displayed.map((line, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                >
                  <span className="shrink-0 select-none text-xs font-mono text-primary tabular-nums pt-0.5 w-14">
                    [{line.time || "—"}]
                  </span>
                  <span className="text-sm leading-relaxed">{line.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeCard({
  active, onClick, icon, title, hint,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all",
        active
          ? "border-foreground ring-2 ring-foreground/10 bg-background"
          : "border-border hover:border-foreground/40 bg-background",
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium text-sm">{title}</span>
      </div>
      <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
        {hint}
      </span>
    </button>
  );
}
