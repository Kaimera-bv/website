import { useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Legacy Integration Layer — clean-room interactive demo.
//
// A modern REST API fronts a decades-old Terminal Operating System that runs on
// a mainframe and exposes no API of its own. The only way in is its internal
// fixed-format message-queue interface: you enqueue a byte-exact request record
// on a request queue, the mainframe processes it and writes a reply record to a
// short-lived reply queue you created for that one call.
//
// Everything here is fictional and runs entirely in the browser — there is no
// backend, no real host, and none of the real system's identifiers or layout.
// It is an independent rebuild of a system I designed professionally.
// ---------------------------------------------------------------------------

const ACCENT = "var(--color-accent)"; // safety amber

// Fictional environment identifiers.
const HOST = "MFRAME01"; // the mainframe host
const REQUEST_QUEUE = "REQGI01"; // request queue the TOS monitors
const REPLY_LIB = "GENQ"; // library the short-lived reply queues live in
const TERMINAL_CODE = "T4021"; // this workstation's terminal code
const MESSAGE_LEN = 256; // fixed envelope length in bytes

const OWN = "·"; // rendered stand-in for a padding space

type Outcome = "confirm" | "reject";

// A field spliced into (or read out of) the fixed-format envelope. `off`/`len`
// are byte offsets — this is an invented layout, not the real one.
interface Field {
  key: string;
  label: string;
  off: number;
  len: number;
  color: string;
}

// Request envelope: a control header followed by the move data record.
const REQ_FIELDS: Field[] = [
  { key: "opcode", label: "Operation code", off: 0, len: 6, color: "#f7a52b" },
  { key: "replyq", label: "Reply-queue name", off: 8, len: 8, color: "#45c4f0" },
  { key: "trmc", label: "Terminal code", off: 16, len: 6, color: "#a78bfa" },
  { key: "usid", label: "User ID (audit trail)", off: 24, len: 10, color: "#f472b6" },
  { key: "unit", label: "Container unit", off: 64, len: 12, color: "#4ade80" },
  { key: "from", label: "From slot", off: 80, len: 12, color: "#fb923c" },
  { key: "to", label: "To slot", off: 96, len: 12, color: "#38bdf8" },
];

// Reply envelope: the mainframe echoes the op code and adds a return code,
// an error identifier, and a short status text.
const REPLY_FIELDS: Field[] = [
  { key: "opcode", label: "Echoed op code", off: 0, len: 6, color: "#f7a52b" },
  { key: "rtnc", label: "Return code (0=ok, 1=err)", off: 10, len: 1, color: "#4ade80" },
  { key: "erri", label: "Error identifier", off: 12, len: 7, color: "#f87171" },
  { key: "text", label: "Status text", off: 32, len: 40, color: "#45c4f0" },
];

/** Overwrite `len` bytes at `off` with `value`, space-padded / truncated. */
function splice(s: string, off: number, value: string, len: number): string {
  return s.slice(0, off) + value.padEnd(len).slice(0, len) + s.slice(off + len);
}

/** A unique-ish 8-char reply-queue name. Browser-side, so Math.random is fine. */
function newReplyQueueName(): string {
  const hex = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0");
  return "RQ" + hex;
}

function buildRequestEnvelope(v: {
  unit: string;
  from: string;
  to: string;
  replyq: string;
  user: string;
}): string {
  let m = " ".repeat(MESSAGE_LEN);
  m = splice(m, 0, "MOVEU", 6);
  m = splice(m, 8, v.replyq, 8);
  m = splice(m, 16, TERMINAL_CODE, 6);
  m = splice(m, 24, v.user, 10);
  m = splice(m, 64, v.unit, 12);
  m = splice(m, 80, v.from, 12);
  m = splice(m, 96, v.to, 12);
  return m;
}

function buildReplyEnvelope(outcome: Outcome, unit: string, to: string): string {
  let m = " ".repeat(MESSAGE_LEN);
  m = splice(m, 0, "MOVEU", 6);
  if (outcome === "confirm") {
    m = splice(m, 10, "0", 1);
    m = splice(m, 32, `MOVE CONFIRMED ${unit}`.trim(), 40);
  } else {
    m = splice(m, 10, "1", 1);
    m = splice(m, 12, "MV21403", 7);
    m = splice(m, 32, "UNIT NOT AT STATED FROM SLOT", 40);
  }
  return m;
}

// Round-trip stages, mirroring the real client's progress stream.
interface Stage {
  pct: number;
  title: string;
  detail: (ctx: { replyq: string; outcome: Outcome; unit: string; to: string }) => string;
}

const STAGES: Stage[] = [
  {
    pct: 10,
    title: "Build fixed-format message",
    detail: () => `Splice move fields into the ${MESSAGE_LEN}-byte envelope`,
  },
  {
    pct: 25,
    title: "Create reply queue",
    detail: ({ replyq }) => `CRTQ ${REPLY_LIB}/${replyq} — short-lived, one per call`,
  },
  {
    pct: 55,
    title: "Write to request queue",
    detail: () => `Enqueue on ${HOST} · ${REQUEST_QUEUE}`,
  },
  {
    pct: 80,
    title: "Await mainframe reply",
    detail: ({ replyq }) => `Blocking read on ${REPLY_LIB}/${replyq}`,
  },
  {
    pct: 100,
    title: "Reply received · queue deleted",
    detail: ({ outcome, unit, to }) =>
      outcome === "confirm"
        ? `Mainframe confirmed move of ${unit} to ${to}`
        : `Mainframe rejected the move (MV21403)`,
  },
];

const STAGE_MS = 620;

interface Snapshot {
  reqEnvelope: string;
  replyEnvelope: string;
  replyq: string;
  user: string;
  unit: string;
  from: string;
  to: string;
  outcome: Outcome;
}

type Phase = "idle" | "running" | "done";

export default function IntegrationLayer() {
  const [unit, setUnit] = useState("DEMU1234567");
  const [from, setFrom] = useState("A17-04-2");
  const [to, setTo] = useState("C03-11-1");
  const [outcome, setOutcome] = useState<Outcome>("confirm");

  const [phase, setPhase] = useState<Phase>("idle");
  const [stageIdx, setStageIdx] = useState(-1);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [envView, setEnvView] = useState<"request" | "reply">("request");
  const [activeField, setActiveField] = useState<string | null>(null);

  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const success = phase === "done" && snap?.outcome === "confirm";
  const failure = phase === "done" && snap?.outcome === "reject";

  function validate(): string | null {
    const u = unit.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(u)) return "Unit must be 1–12 letters or digits.";
    if (!from.trim()) return "From slot is required.";
    if (!to.trim()) return "To slot is required.";
    if (from.trim().toUpperCase() === to.trim().toUpperCase())
      return "From and to slot must differ.";
    return null;
  }

  function submit() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];

    const err = validate();
    setValidationError(err);
    if (err) return;

    const u = unit.trim().toUpperCase();
    const f = from.trim().toUpperCase();
    const t = to.trim().toUpperCase();
    const replyq = newReplyQueueName();
    const user = "demo.user";

    const reqEnvelope = buildRequestEnvelope({ unit: u, from: f, to: t, replyq, user });
    const replyEnvelope = buildReplyEnvelope(outcome, u, t);

    setSnap({ reqEnvelope, replyEnvelope, replyq, user, unit: u, from: f, to: t, outcome });
    setEnvView("request");
    setActiveField(null);
    setPhase("running");
    setStageIdx(0);

    for (let i = 1; i < STAGES.length; i++) {
      timers.current.push(
        window.setTimeout(() => setStageIdx(i), STAGE_MS * i)
      );
    }
    timers.current.push(
      window.setTimeout(() => {
        setPhase("done");
        setEnvView("reply");
      }, STAGE_MS * STAGES.length)
    );
  }

  function reset() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPhase("idle");
    setStageIdx(-1);
    setSnap(null);
    setEnvView("request");
    setActiveField(null);
  }

  const running = phase === "running";
  const currentPct = stageIdx >= 0 ? STAGES[Math.min(stageIdx, STAGES.length - 1)].pct : 0;

  return (
    <div
      className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]"
      style={{ "--accent": ACCENT } as React.CSSProperties}
    >
      {/* ---- Left: REST request builder + pipeline --------------------- */}
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-[var(--color-border-solid)] bg-[var(--color-surface)] p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded bg-[var(--color-accent-soft)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--color-accent)]">
              POST
            </span>
            <code className="font-mono text-xs text-[var(--color-muted)]">/api/v1/moves</code>
          </div>

          <div className="flex flex-col gap-3">
            <LabeledInput label="Container unit" value={unit} onChange={setUnit} placeholder="DEMU1234567" mono />
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label="From slot" value={from} onChange={setFrom} placeholder="A17-04-2" mono />
              <LabeledInput label="To slot" value={to} onChange={setTo} placeholder="C03-11-1" mono />
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
                Mainframe response
              </span>
              <div className="grid grid-cols-2 gap-2">
                <OutcomeButton active={outcome === "confirm"} onClick={() => setOutcome("confirm")} label="Confirm" tone="ok" />
                <OutcomeButton active={outcome === "reject"} onClick={() => setOutcome("reject")} label="Reject" tone="err" />
              </div>
            </div>
          </div>

          {validationError && (
            <p className="mt-3 text-xs text-[#f87171]">{validationError}</p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={running}
              className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-[#1a1206] transition-opacity disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {running ? "Submitting…" : "Submit move"}
            </button>
            {phase !== "idle" && (
              <button
                onClick={reset}
                disabled={running}
                className="rounded-lg border border-[var(--color-border-solid)] px-4 py-2.5 text-sm font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Round-trip pipeline */}
        <div className="rounded-xl border border-[var(--color-border-solid)] bg-[var(--color-surface)] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">Queue round-trip</h3>
            <span className="font-mono text-xs text-[var(--color-faint)]">{currentPct}%</span>
          </div>

          <div className="mb-4 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${currentPct}%`,
                background: failure ? "#f87171" : ACCENT,
              }}
            />
          </div>

          <ol className="flex flex-col gap-3">
            {STAGES.map((stage, i) => {
              const state = phase === "idle" ? "pending" : i < stageIdx ? "done" : i === stageIdx ? (phase === "done" && i === STAGES.length - 1 ? "current" : "current") : "pending";
              const reached = phase !== "idle" && i <= stageIdx;
              const isLast = i === STAGES.length - 1;
              const lastTone = isLast && failure ? "err" : "ok";
              return (
                <li key={stage.title} className="flex gap-3">
                  <StageDot reached={reached} active={running && i === stageIdx} tone={reached && isLast ? lastTone : "ok"} />
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium transition-colors"
                      style={{ color: reached ? "var(--color-ink)" : "var(--color-faint)" }}
                    >
                      {stage.title}
                    </p>
                    {reached && snap && (
                      <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">
                        {stage.detail({ replyq: snap.replyq, outcome: snap.outcome, unit: snap.unit, to: snap.to })}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* ---- Right: envelope inspector + HTTP response ----------------- */}
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-[var(--color-border-solid)] bg-[var(--color-surface)] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                Fixed-format envelope
              </h3>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--color-faint)]">
                {MESSAGE_LEN} bytes · EBCDIC on the wire
              </p>
            </div>
            <div className="flex rounded-lg border border-[var(--color-border-solid)] p-0.5">
              <ToggleTab active={envView === "request"} onClick={() => setEnvView("request")} label="Request" />
              <ToggleTab
                active={envView === "reply"}
                onClick={() => phase === "done" && setEnvView("reply")}
                label="Reply"
                disabled={phase !== "done"}
              />
            </div>
          </div>

          {snap ? (
            <>
              <ByteGrid
                data={envView === "request" ? snap.reqEnvelope : snap.replyEnvelope}
                fields={envView === "request" ? REQ_FIELDS : REPLY_FIELDS}
                activeField={activeField}
                onHoverField={setActiveField}
              />
              <FieldLegend
                fields={envView === "request" ? REQ_FIELDS : REPLY_FIELDS}
                data={envView === "request" ? snap.reqEnvelope : snap.replyEnvelope}
                activeField={activeField}
                onHoverField={setActiveField}
              />
            </>
          ) : (
            <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-[var(--color-border-solid)]">
              <p className="max-w-xs px-6 text-center text-xs leading-relaxed text-[var(--color-faint)]">
                Submit a move to build its byte-exact request record. The mainframe
                has no API — every field is spliced into a fixed offset in this
                envelope before it goes on the queue.
              </p>
            </div>
          )}
        </div>

        {/* HTTP response */}
        <div className="rounded-xl border border-[var(--color-border-solid)] bg-[var(--color-surface)] p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">REST response</h3>
          {phase === "done" && snap ? (
            <div className="overflow-x-auto">
              <div className="mb-2 flex items-center gap-2">
                <StatusBadge ok={success} />
                <code className="font-mono text-xs text-[var(--color-faint)]">
                  {success ? "200 OK" : "422 Unprocessable Entity"}
                </code>
              </div>
              <pre className="rounded-lg bg-[var(--color-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">
                <code>{success
                  ? JSON.stringify(
                      { unit: snap.unit, from_position: snap.from, to_position: snap.to, request_id: reqId(snap.replyq) },
                      null,
                      2
                    )
                  : JSON.stringify(
                      { error: { code: "MOVE_REJECTED", message: "Mainframe rejected the move (MV21403).", request_id: reqId(snap.replyq) } },
                      null,
                      2
                    )}</code>
              </pre>
            </div>
          ) : (
            <p className="font-mono text-xs text-[var(--color-faint)]">
              {running ? "// awaiting reply from the mainframe…" : "// no request sent yet"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// request_id derived from the reply-queue name so it looks stable per call.
function reqId(replyq: string): string {
  return "req_" + replyq.slice(2).toLowerCase() + "01";
}

// ---------------------------------------------------------------------------
// Byte grid — 16 bytes per row, field regions tinted, active field ringed.
// ---------------------------------------------------------------------------
function ByteGrid({
  data,
  fields,
  activeField,
  onHoverField,
}: {
  data: string;
  fields: Field[];
  activeField: string | null;
  onHoverField: (k: string | null) => void;
}) {
  // Map each byte offset to the field that owns it (if any).
  const owner = useMemo(() => {
    const map: (Field | null)[] = new Array(data.length).fill(null);
    for (const f of fields) {
      for (let i = f.off; i < f.off + f.len && i < data.length; i++) map[i] = f;
    }
    return map;
  }, [data, fields]);

  const cols = 16;
  const rows = Math.ceil(data.length / cols);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block font-mono text-[11px] leading-none">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center">
            <span className="mr-2 w-8 select-none text-right text-[var(--color-faint)]">
              {(r * cols).toString(16).toUpperCase().padStart(3, "0")}
            </span>
            {Array.from({ length: cols }).map((_, c) => {
              const idx = r * cols + c;
              if (idx >= data.length) return <span key={c} className="h-5 w-[18px]" />;
              const f = owner[idx];
              const ch = data[idx];
              const isSpace = ch === " ";
              const active = f && f.key === activeField;
              const dim = activeField && (!f || f.key !== activeField);
              return (
                <span
                  key={c}
                  onMouseEnter={() => onHoverField(f ? f.key : null)}
                  onMouseLeave={() => onHoverField(null)}
                  className="grid h-5 w-[18px] place-items-center transition-colors"
                  style={{
                    color: f ? f.color : isSpace ? "var(--color-faint)" : "var(--color-muted)",
                    background: f ? `${f.color}${active ? "40" : "1f"}` : "transparent",
                    outline: active ? `1px solid ${f!.color}` : "none",
                    opacity: dim ? 0.28 : 1,
                  }}
                >
                  {isSpace ? OWN : ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldLegend({
  fields,
  data,
  activeField,
  onHoverField,
}: {
  fields: Field[];
  data: string;
  activeField: string | null;
  onHoverField: (k: string | null) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
      {fields.map((f) => {
        const value = data.slice(f.off, f.off + f.len).trim() || "—";
        const active = f.key === activeField;
        return (
          <button
            key={f.key}
            onMouseEnter={() => onHoverField(f.key)}
            onMouseLeave={() => onHoverField(null)}
            className="flex items-center gap-1.5 text-left transition-opacity"
            style={{ opacity: activeField && !active ? 0.4 : 1 }}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: f.color }} />
            <span className="text-[11px] text-[var(--color-muted)]">{f.label}</span>
            <code className="font-mono text-[11px] text-[var(--color-faint)]">
              [{f.off}:{f.off + f.len}] {value}
            </code>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational bits.
// ---------------------------------------------------------------------------
function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
        {label}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        className={`w-full rounded-lg border border-[var(--color-border-solid)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function OutcomeButton({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: "ok" | "err";
}) {
  const color = tone === "ok" ? "#4ade80" : "#f87171";
  return (
    <button
      onClick={onClick}
      className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
      style={{
        borderColor: active ? color : "var(--color-border-solid)",
        background: active ? `${color}1a` : "transparent",
        color: active ? color : "var(--color-muted)",
      }}
    >
      {label}
    </button>
  );
}

function ToggleTab({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: active ? "var(--color-surface-2)" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-muted)",
      }}
    >
      {label}
    </button>
  );
}

function StageDot({
  reached,
  active,
  tone,
}: {
  reached: boolean;
  active: boolean;
  tone: "ok" | "err";
}) {
  const color = tone === "err" ? "#f87171" : ACCENT;
  return (
    <span className="relative mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
      {active && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: color, opacity: 0.3, animation: "spin-pulse 1.1s ease-in-out infinite" }}
        />
      )}
      <span
        className="h-2.5 w-2.5 rounded-full transition-colors"
        style={{
          background: reached ? color : "var(--color-surface-2)",
          border: reached ? "none" : "1px solid var(--color-border-solid)",
        }}
      />
    </span>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  const color = ok ? "#4ade80" : "#f87171";
  return (
    <span
      className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold"
      style={{ background: `${color}1a`, color }}
    >
      {ok ? "CONFIRMED" : "REJECTED"}
    </span>
  );
}
