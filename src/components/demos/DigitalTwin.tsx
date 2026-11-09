import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapGL, useControl } from "react-map-gl/maplibre";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { registerLoaders } from "@loaders.gl/core";
import { GLTFLoader } from "@loaders.gl/gltf";

// MapLibre 6 looks for its worker next to its own module, which doesn't exist
// once Vite pre-bundles/chunks it — point it at the emitted worker asset instead.
setWorkerUrl(maplibreWorkerUrl);
registerLoaders([GLTFLoader]);

// A single stable loaders array — passing a fresh `[GLTFLoader]` per layer per
// frame makes deck.gl treat the scenegraph prop as changed and churn the model.
const LOADERS = [GLTFLoader];

// deck.gl rendered *interleaved* into the map's own WebGL context (not as a
// separate canvas on top). This keeps the 3D models locked to the basemap during
// zoom/pan — an overlaid deck canvas desyncs for a frame and the models flicker.
function DeckOverlay(props: any) {
  const overlay = useControl(() => new MapLibreOverlay(props));
  overlay.setProps(props);
  return null;
}

// Model yaw is derived from the grid rotation so the models stay aligned to the
// quay at ANY location: forward-along-grid-Y ⟺ yaw = 90 − GRID_ROTATION.
// (This reproduces the original 147.75 at the old rotation of 302.244.)
const gridYawFor = (rotation: number) => 90 - rotation;
const MODEL_ROLL = 90;
const CRANE_SIZE_SCALE = 0.0125;
const VESSEL_MODEL_LENGTH_M = 10760.6;
const VESSEL_HEADING_OFFSET = 180;
const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json";

const COLOR_PALETTE = [
  [228, 26, 28], [55, 126, 184], [77, 175, 74], [152, 78, 163],
  [255, 127, 0], [166, 86, 40], [247, 129, 191], [153, 153, 153],
];

type RGB = number[];
type Vec2 = [number, number];
type ColorMode = "default" | "vessel" | "outgoing_type" | "size" | "area";

// Carrier type code -> human label (shared by the legend and vessel manifest).
const CARRIER_LABELS: Record<string, string> = { VS: "Vessel", TK: "Truck", TR: "Train", BG: "Barge" };

// ---- colour helpers (mirrors the real twin) --------------------------------
function hashColorIndex(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xfffffff;
  return hash % COLOR_PALETTE.length;
}
function computeColor(d: any, mode: ColorMode, meta: any, vessel: any): RGB {
  switch (mode) {
    case "vessel":
      if (!vessel || vessel.visitCode == null) return [255, 255, 255, 255];
      return d.outgoingVisitCode === vessel.visitCode ? [55, 200, 100, 255] : [150, 150, 150, 20];
    case "outgoing_type":
      return [...(meta.carrierColors[d.outgoingCarrierType] || [150, 150, 150]), 255];
    case "size":
      return [...(meta.sizeColors[d.containerLength] || [150, 150, 150]), 255];
    case "area":
      return [...COLOR_PALETTE[hashColorIndex(d.area || "")], 255];
    default:
      return [255, 255, 255, 255];
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function posAlongPath(path: Vec2[], u: number): { pos: Vec2; bearing: number } {
  const n = path.length;
  const f = (((u % 1) + 1) % 1) * n;
  const i = Math.floor(f) % n;
  const frac = f - Math.floor(f);
  const a = path[i], b = path[(i + 1) % n];
  const pos: Vec2 = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
  const latMid = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const bearing = (Math.atan2((b[0] - a[0]) * Math.cos(latMid), b[1] - a[1]) * 180) / Math.PI;
  return { pos, bearing };
}
const groupCount =(arr: any[], key: (d: any) => string) => {
  const m = new Map<string, number>();
  for (const d of arr) { const k = key(d); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count);
};

// ---- component -------------------------------------------------------------
export default function DigitalTwin() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>("default");
  const [selectedVessel, setSelectedVessel] = useState<any>(null);
  const [selectedCrane, setSelectedCrane] = useState<any>(null);
  const [selectedStraddle, setSelectedStraddle] = useState<any>(null);
  const [inspect, setInspect] = useState<any>(null);
  const [tab, setTab] = useState<"overview" | "vessel" | "display">("overview");
  const [show, setShow] = useState({ containers: true, cranes: true, straddles: true, vessels: true });
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    fetch(base + "data/digital-twin.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const tick = (now: number) => {
      if (!lastRef.current) lastRef.current = now;
      setT((p) => (p + (now - lastRef.current) / 1000 / 40) % 1);
      lastRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); lastRef.current = 0; };
  }, []);

  const allContainers = useMemo(
    () => (data ? Object.values(data.containers).flat() as any[] : []),
    [data]
  );
  const reefer = useMemo(
    () => (data ? new RegExp(data.meta.reeferPattern) : /^R/),
    [data]
  );

  // Yard stats — scoped to the selected vessel's containers when one is picked.
  const stats = useMemo(() => {
    if (!data) return null;
    const scope = selectedVessel
      ? allContainers.filter((c) => c.outgoingVisitCode === selectedVessel.visitCode)
      : allContainers;
    return {
      total: scope.length,
      reefer: scope.filter((c) => reefer.test(c.area || "")).length,
      byType: groupCount(scope, (c) => c.outgoingCarrierType || "Unknown"),
      byArea: groupCount(scope, (c) => c.area || "Unknown").slice(0, 15),
    };
  }, [data, allContainers, selectedVessel, reefer]);

  const manifest = useMemo(() => {
    if (!selectedVessel) return null;
    const scope = allContainers.filter((c) => c.outgoingVisitCode === selectedVessel.visitCode);
    return {
      total: scope.length,
      bySize: groupCount(scope, (c) => `${c.containerLength}`).sort((a, b) => +a.k - +b.k),
      byIncoming: groupCount(scope, (c) => c.incomingCarrierType || "Unknown"),
    };
  }, [selectedVessel, allContainers]);

  function selectVessel(v: any) {
    setSelectedVessel(v);
    setSelectedCrane(null);
    setSelectedStraddle(null);
    setColorMode("vessel");
    setInspect(null);
    setTab("vessel");
  }
  function deselectVessel() {
    setSelectedVessel(null);
    setColorMode((m) => (m === "vessel" ? "default" : m));
    setTab("overview");
  }

  const containerLayers = useMemo(() => {
    if (!data || !show.containers) return [];
    const gridYaw = gridYawFor(data.meta.rotation);
    return Object.keys(data.containers).map(
      (model) =>
        new ScenegraphLayer({
          id: "containers_" + model,
          data: data.containers[model],
          scenegraph: base + "models/" + model,
          loaders: LOADERS,
          _lighting: "pbr",
          sizeScale: 1,
          pickable: true,
          autoHighlight: true,
          highlightColor: [247, 165, 43, 200],
          getPosition: (d: any) => d.coordinates,
          getOrientation: (d: any) => [0, gridYaw - d.angle, MODEL_ROLL],
          getColor: (d: any) => computeColor(d, colorMode, data.meta, selectedVessel),
          updateTriggers: { getColor: [colorMode, selectedVessel?.visitCode] },
          onClick: (info: any) => info.object && setInspect({ type: "container", o: info.object }),
        })
    );
  }, [data, colorMode, selectedVessel, show.containers]);

  // STS cranes are permanent quay infrastructure — always on the rail, whether or
  // not a vessel is berthed. So render every crane and never gate on arrival time;
  // this also keeps the layer static (no t dependency), so it never flickers.
  const craneLayers = useMemo(() => {
    if (!data || !show.cranes) return [];
    const selVisit = selectedVessel?.visitCode ?? null;
    const gridYaw = gridYawFor(data.meta.rotation);
    return [
      new ScenegraphLayer({
        id: "cranes", data: data.cranes, scenegraph: base + "models/sts_crane.glb",
        loaders: LOADERS, _lighting: "pbr", sizeScale: CRANE_SIZE_SCALE, pickable: true,
        getPosition: (d: any) => d.coordinates,
        // Cranes face across the quay — a 90° clockwise turn from the yard grid.
        getOrientation: (d: any) => [0, gridYaw - d.angle - 90, MODEL_ROLL],
        getColor: (d: any) =>
          selVisit == null ? [0, 110, 45, 255]
            : d.visitCode === selVisit ? [0, 170, 70, 255] : [150, 150, 150, 40],
        updateTriggers: { getColor: [selVisit] },
        onClick: (info: any) => {
          if (!info.object) return;
          const assignedStraddleData = (info.object.assignedStraddles || [])
            .map((label: string) => data.straddles.find((s: any) => `SC-${s.straddleId}` === label))
            .filter(Boolean);
          setSelectedCrane({ ...info.object, assignedStraddleData });
          setSelectedStraddle(null);
          setInspect(null);
        },
      }),
    ];
  }, [data, show.cranes, selectedVessel]);

  const equipmentLayers = useMemo(() => {
    if (!data) return [];
    const out: any[] = [];
    const selVisit = selectedVessel?.visitCode ?? null;
    const gridYaw = gridYawFor(data.meta.rotation);

    if (show.vessels) {
      const vData = data.vessels.map((v: any) => {
        let coords = v.coordinates;
        if (v.berthT > 0) {
          if (t < v.berthT - 0.12) return null;
          const p = clamp01((t - (v.berthT - 0.12)) / 0.12);
          coords = [lerp(v.offshore[0], v.coordinates[0], p), lerp(v.offshore[1], v.coordinates[1], p), 0];
        }
        return { ...v, _c: coords };
      }).filter(Boolean);
      out.push(new ScenegraphLayer({
        id: "vessels", data: vData, scenegraph: base + "models/vessel.glb",
        loaders: LOADERS, _lighting: "pbr", sizeScale: 1, pickable: true,
        getPosition: (d: any) => d._c,
        getOrientation: (d: any) => [0, VESSEL_HEADING_OFFSET - d.heading, MODEL_ROLL],
        getScale: (d: any) => { const s = d.length / VESSEL_MODEL_LENGTH_M; return [s, s, s]; },
        getColor: (d: any) =>
          selVisit == null || d.visitCode === selVisit ? [255, 255, 255, 255] : [150, 150, 150, 40],
        updateTriggers: { getPosition: [t], getColor: [selVisit] },
        onClick: (info: any) => info.object && selectVessel(info.object),
      }));
    }

    if (show.straddles) {
      const scData = data.straddles.map((s: any) => {
        const { pos, bearing } = posAlongPath(s.path, t * s.speed + s.phase);
        return { straddleId: s.straddleId, position: [pos[0], pos[1], 0], bearing, speed: s.speed };
      });
      out.push(new ScenegraphLayer({
        id: "straddles", data: scData, scenegraph: base + "models/straddle_carrier.glb",
        loaders: LOADERS, _lighting: "pbr", sizeScale: 1, pickable: true,
        getPosition: (d: any) => d.position,
        getOrientation: (d: any) => [0, 90 - d.bearing, MODEL_ROLL],
        getColor: [255, 210, 0, 255],
        updateTriggers: { getPosition: [t], getOrientation: [t] },
        onClick: (info: any) => {
          if (!info.object) return;
          const src = data.straddles.find((s: any) => s.straddleId === info.object.straddleId);
          setSelectedStraddle({ ...info.object, ...src });
          setSelectedCrane(null);
          setInspect(null);
        },
      }));
    }
    return out;
  }, [data, t, show.vessels, show.straddles, selectedVessel]);

  if (error) return <Frame><p className="text-sm text-red-600">Couldn't load the terminal data ({error}).</p></Frame>;
  if (!data || !stats)
    return (
      <Frame>
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#2563eb] border-t-transparent" />
          <p className="font-mono text-sm text-[#6c757d]">Loading terminal…</p>
        </div>
      </Frame>
    );

  const cam = data.meta.camera;

  return (
    <div className="relative h-[65vh] min-h-[520px] w-full overflow-hidden rounded-xl border border-[var(--color-border-solid)] bg-[#aeb7bd]">
      <MapGL
        reuseMaps
        initialViewState={{ longitude: cam.longitude, latitude: cam.latitude, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing }}
        mapStyle={BASEMAP}
        style={{ width: "100%", height: "100%" }}
      >
        <DeckOverlay interleaved layers={[...containerLayers, ...craneLayers, ...equipmentLayers]} />
      </MapGL>

      {/* ---- Left sidebar ---- */}
      <div className="absolute left-4 top-4 flex max-h-[calc(100%-2rem)] w-[300px] flex-col overflow-hidden rounded-lg border border-[#e2e6ec] bg-white text-sm text-[#334155] shadow-[0_8px_30px_-8px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between border-b border-[#eceff3] px-4 py-2.5">
          <span className="font-semibold text-[#0f172a]">Terminal twin</span>
          <span className="flex items-center gap-1.5 text-[0.7rem] text-[#6c757d]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />Live replay
          </span>
        </div>
        {selectedCrane ? (
          <CraneCardView crane={selectedCrane} onClose={() => setSelectedCrane(null)} />
        ) : selectedStraddle ? (
          <StraddleCardView straddle={selectedStraddle} onClose={() => setSelectedStraddle(null)} />
        ) : (
        <>
        <div className="flex border-b border-[#eceff3] text-xs">
          {(["overview", "vessel", "display"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 py-2 capitalize transition-colors ${
                tab === k
                  ? "border-b-2 border-[#2563eb] font-semibold text-[#0f172a]"
                  : "border-b-2 border-transparent text-[#6c757d] hover:text-[#0f172a]"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {tab === "overview" && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[#6c757d]">
                  {selectedVessel ? `Vessel: ${selectedVessel.name}` : "Whole yard"}
                </span>
                {selectedVessel && <CloseX onClick={deselectVessel} />}
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Kpi label="Total" value={stats.total.toLocaleString()} />
                <Kpi label="Reefers" value={stats.reefer.toLocaleString()} />
              </div>
              <SectionLabel>Outgoing by carrier type</SectionLabel>
              <div className="mb-4">
                {stats.byType.map((r) => (
                  <Bar key={r.k} label={CARRIER_LABELS[r.k] ?? r.k} count={r.count} max={stats.total} color="#2563eb" />
                ))}
              </div>
              <SectionLabel>Area occupancy (top 15)</SectionLabel>
              {stats.byArea.map((r) => (
                <Bar key={r.k} label={r.k} count={r.count} max={stats.byArea[0]?.count || 1} color="#f59e0b" />
              ))}
            </>
          )}

          {tab === "vessel" && (
            <>
              {!selectedVessel && <p className="text-[#6c757d]">Click a vessel on the map to highlight its containers and the cranes working it.</p>}
              {selectedVessel && (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-semibold text-[#0f172a]">{selectedVessel.name}</span>
                    <CloseX onClick={deselectVessel} />
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <StatCard label="Discharge" value={selectedVessel.moves.discharge.toLocaleString()} sub="moves" />
                    <StatCard label="Load" value={selectedVessel.moves.load.toLocaleString()} sub="moves" />
                  </div>
                  <DetailTable rows={[
                    ["MMSI", selectedVessel.mmsi], ["IMO", selectedVessel.imo],
                    ["Call sign", selectedVessel.callSign], ["Type", selectedVessel.shipType],
                    ["Length", `${selectedVessel.length} m`], ["Beam", `${selectedVessel.beam} m`],
                    ["Speed", `${selectedVessel.sog} kn`], ["Heading", `${selectedVessel.heading}°`],
                    ["Destination", selectedVessel.destination],
                  ]} />
                  <SectionLabel className="mt-3">Berth plan</SectionLabel>
                  <DetailTable rows={[
                    ["Visit", selectedVessel.visitCode], ["ETA", selectedVessel.eta?.replace("T", " ")],
                    ["ETD", selectedVessel.etd?.replace("T", " ")],
                    ["Discharge", selectedVessel.moves.discharge], ["Load", selectedVessel.moves.load],
                  ]} />
                  {manifest && (
                    <>
                      <SectionLabel className="mt-3">Manifest · {manifest.total} containers</SectionLabel>
                      <DetailTable rows={manifest.bySize.map((r) => [`${r.k} ft`, r.count])} />
                      <SectionLabel className="mt-3">By incoming carrier</SectionLabel>
                      <DetailTable rows={manifest.byIncoming.map((r) => [CARRIER_LABELS[r.k] ?? r.k, r.count])} />
                    </>
                  )}
                </>
              )}
            </>
          )}

          {tab === "display" && (
            <>
              <SectionLabel>Colour containers by</SectionLabel>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ColorMode)}
                className="mb-3 w-full rounded-md border border-[#cbd5e1] bg-white px-2 py-1.5 text-[#334155] focus:border-[#2563eb] focus:outline-none"
              >
                <option value="default">Default</option>
                <option value="vessel">Selected vessel</option>
                <option value="outgoing_type">Outgoing carrier type</option>
                <option value="size">Container size</option>
                <option value="area">Yard area</option>
              </select>
              <Legend colorMode={colorMode} meta={data.meta} />
              <SectionLabel className="mt-4">Layers</SectionLabel>
              {(["containers", "cranes", "straddles", "vessels"] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 py-0.5 capitalize text-[#475569] hover:text-[#0f172a]">
                  <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} className="accent-[#2563eb]" />
                  {k}
                </label>
              ))}
            </>
          )}
        </div>
        </>
        )}
      </div>

      {/* ---- Right inspect panel ---- */}
      {inspect && <InspectPanel inspect={inspect} onClose={() => setInspect(null)} />}

      <p className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-[#e2e6ec] bg-white/90 px-2 py-1 text-[0.65rem] text-[#475569] shadow-sm backdrop-blur">
        real geography · fabricated data
      </p>
    </div>
  );
}

// ---- presentational --------------------------------------------------------
// Small ✕ button reused by the sidebar and inspect panel (light theme).
function CloseX({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="grid h-5 w-5 place-items-center rounded border border-[#e2e6ec] text-[0.7rem] leading-none text-[#6c757d] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
      aria-label="Close"
    >
      ✕
    </button>
  );
}
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="grid h-[78vh] min-h-[520px] w-full place-items-center rounded-xl border border-[#e2e6ec] bg-[#eef1f4]">{children}</div>;
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#e2e6ec] bg-[#f8fafc] p-2.5 text-center">
      <div className="text-2xl font-bold tabular-nums text-[#0f172a]">{value}</div>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#6c757d]">{label}</div>
    </div>
  );
}
// Left-aligned stat tile with an optional sub-label — used for crane/vessel cards.
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-md border border-[#e2e6ec] bg-[#f8fafc] p-2.5">
      <div className="text-[0.58rem] font-semibold uppercase tracking-wider text-[#6c757d]">{label}</div>
      <div className="mt-0.5 truncate text-lg font-bold tabular-nums text-[#0f172a]">{value}</div>
      {sub && <div className="text-[0.62rem] text-[#94a3b8]">{sub}</div>}
    </div>
  );
}
// Crane selection view for the left panel — headline metrics as stat cards, plus
// the straddle carriers assigned to the crane.
function CraneCardView({ crane, onClose }: { crane: any; onClose: () => void }) {
  const done = crane.movesExecuted ?? 0;
  const left = crane.movesRemaining ?? 0;
  const pct = done + left > 0 ? Math.round((done / (done + left)) * 100) : 0;
  const straddles: any[] = crane.assignedStraddleData ?? [];
  return (
    <div className="overflow-y-auto px-4 py-3">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#6c757d]">STS crane</div>
          <div className="text-base font-bold text-[#0f172a]">{crane.craneName}</div>
          <div className="text-[0.72rem] text-[#6c757d]">Working {crane.vessel} · {crane.moveType}</div>
        </div>
        <CloseX onClick={onClose} />
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <StatCard label="GCR" value={crane.gcr} sub="moves / hour" />
        <StatCard label="Complete" value={`${pct}%`} sub={`${done + left} planned`} />
        <StatCard label="Moves done" value={done.toLocaleString()} sub="executed" />
        <StatCard label="Moves left" value={left.toLocaleString()} sub="in queue" />
      </div>

      <div className="mb-1.5 mt-3 h-1.5 overflow-hidden rounded-full bg-[#eef2f6]">
        <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${pct}%` }} />
      </div>

      <SectionLabel className="mt-3">Straddles assigned · {straddles.length}</SectionLabel>
      <div className="flex flex-col gap-2">
        {straddles.length === 0 && <span className="text-[0.75rem] text-[#94a3b8]">None</span>}
        {straddles.map((s) => (
          <div key={s.straddleId} className="rounded-md border border-[#e2e6ec] bg-white p-2.5">
            <StraddleCardBody straddle={s} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
// Single-series "moves per hour" bar chart: thin bars, rounded tops, anchored to
// the baseline, one accent hue, native per-bar hover — a sparkline in a card.
function PerfChart({ series }: { series: number[] }) {
  const max = Math.max(1, ...series);
  return (
    <div className="flex h-16 items-end gap-[3px]" role="img" aria-label="Moves completed per hour across the shift">
      {series.map((v, i) => (
        <div
          key={i}
          title={`Hour ${i + 1}: ${v} moves`}
          className="flex-1 rounded-t-[2px] bg-[#2563eb]"
          style={{ height: `${Math.max(3, Math.round((v / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}
// Straddle stat cards + shift performance chart. Reused as its own left-panel
// view (with a close button) and embedded once per assigned carrier in the crane
// card. `compact` drops the "Straddle carrier" eyebrow when nested.
function StraddleCardBody({ straddle, onClose, compact }: { straddle: any; onClose?: () => void; compact?: boolean }) {
  const yaw = straddle.bearing != null ? `${Math.round(((straddle.bearing % 360) + 360) % 360)}°` : null;
  const perf: number[] = straddle.perf ?? [];
  const peak = perf.length ? Math.max(...perf) : 0;
  const meta = [yaw && `Heading ${yaw}`, straddle.groundSpeed != null && `${straddle.groundSpeed} km/h`]
    .filter(Boolean).join(" · ");
  return (
    <>
      <div className="mb-3 flex items-start justify-between">
        <div>
          {!compact && <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#6c757d]">Straddle carrier</div>}
          <div className="text-[0.95rem] font-bold text-[#0f172a]">SC-{straddle.straddleId}</div>
          {meta && <div className="text-[0.72rem] text-[#6c757d]">{meta}</div>}
        </div>
        {onClose && <CloseX onClick={onClose} />}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <StatCard label="Moves" value={straddle.movesToday ?? "—"} sub="today" />
        <StatCard label="Util." value={`${straddle.utilization ?? "—"}%`} sub="of shift" />
        <StatCard label="Cycle" value={straddle.avgCycle ?? "—"} sub="min/move" />
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#6c757d]">Performance</span>
        <span className="text-[0.65rem] text-[#94a3b8]">moves / hour</span>
      </div>
      <PerfChart series={perf} />
      <div className="mt-1.5 flex justify-between text-[0.62rem] text-[#94a3b8]">
        <span>shift start</span><span>peak {peak}</span><span>now</span>
      </div>
    </>
  );
}
// Straddle selection view for the left panel.
function StraddleCardView({ straddle, onClose }: { straddle: any; onClose: () => void }) {
  return (
    <div className="overflow-y-auto px-4 py-3">
      <StraddleCardBody straddle={straddle} onClose={onClose} />
    </div>
  );
}
function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-[#6c757d] ${className}`}>{children}</div>;
}
function Bar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[0.72rem] text-[#475569]"><span>{label}</span><span className="font-mono tabular-nums text-[#64748b]">{count}</span></div>
      <div className="h-1.5 rounded-full bg-[#eef2f6]"><div className="h-1.5 rounded-full" style={{ width: `${Math.round((count / (max || 1)) * 100)}%`, background: color }} /></div>
    </div>
  );
}
function DetailTable({ rows }: { rows: [string, any][] }) {
  return (
    <table className="w-full text-[0.8rem]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-[#f1f4f8] last:border-0">
            <td className="py-1 pr-2 whitespace-nowrap text-[#6c757d]">{k}</td>
            <td className="py-1 text-right font-medium text-[#1e293b]">{v ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function InspectPanel({ inspect, onClose }: { inspect: any; onClose: () => void }) {
  const { type, o } = inspect;
  const title = type === "container" ? "Container" : type === "crane" ? "Crane" : "Straddle carrier";
  const rows: [string, any][] =
    type === "container"
      ? [["Code", o.containerCode], ["Size", `${o.containerLength} ft`], ["Area", o.area],
         ["Position (exec)", o.positionExecuted ?? "—"], ["Position (plan)", o.positionPlanned ?? "—"],
         ["Incoming", `${o.incomingCarrierType} · ${o.incomingCarrierCode}`],
         ["Outgoing", `${o.outgoingCarrierType} · ${o.outgoingCarrierCode}`], ["Visit", o.outgoingVisitCode ?? "—"]]
      : type === "crane"
      ? [["Name", o.craneName], ["Working", o.vessel],
         ["GCR", `${o.gcr} moves/h`], ["Move type", o.moveType],
         ["Moves done", o.movesExecuted], ["Moves left", o.movesRemaining],
         ["Straddles", (o.assignedStraddles ?? []).join(", ") || "—"],
         ["X", o.positionX], ["Y", o.positionY]]
      : [["ID", `SC-${o.straddleId}`], ["Speed", `${o.speed?.toFixed?.(1) ?? o.speed}`]];
  return (
    <div className="absolute right-4 top-4 w-60 rounded-lg border border-[#e2e6ec] bg-white p-4 text-sm text-[#334155] shadow-[0_8px_30px_-8px_rgba(15,23,42,0.35)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-[#0f172a]">{title}</span>
        <CloseX onClick={onClose} />
      </div>
      <DetailTable rows={rows} />
    </div>
  );
}
function Legend({ colorMode, meta }: { colorMode: ColorMode; meta: any }) {
  if (colorMode === "default") return <p className="text-[#6c757d]">Models in their own colours.</p>;
  if (colorMode === "area") return <p className="text-[#6c757d]">Each yard area a unique colour.</p>;
  if (colorMode === "vessel")
    return (
      <div className="space-y-1">
        <LegendRow color="rgb(55,200,100)" label="Selected vessel's boxes" />
        <LegendRow color="rgb(150,150,150)" label="Other" />
      </div>
    );
  const entries = colorMode === "outgoing_type" ? Object.entries(meta.carrierColors) : Object.entries(meta.sizeColors);
  const labels: Record<string, string> =
    colorMode === "outgoing_type"
      ? { VS: "Vessel", TK: "Truck", TR: "Train", BG: "Barge" }
      : { "10": "10 ft", "20": "20 ft", "30": "30 ft", "40": "40 ft", "45": "45 ft" };
  return <div className="space-y-1">{entries.map(([k, rgb]) => <LegendRow key={k} color={`rgb(${(rgb as RGB).join(",")})`} label={labels[k] ?? k} />)}</div>;
}
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[#475569]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
    </div>
  );
}
