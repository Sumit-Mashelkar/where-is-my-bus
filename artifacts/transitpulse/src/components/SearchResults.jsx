import { useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ChevronDown, ChevronUp, Radio, Clock,
  Filter, MapPin, ArrowRight, ArrowLeft as ArrowLeftIcon,
  AlertTriangle, RotateCcw, Zap, Navigation,
} from "lucide-react";

/* ── constants ── */
const STATUS_CONFIG = {
  running:   { label: "On Time",         color: "#22c55e", bg: "#0d2a1a", border: "#166534" },
  delayed:   { label: "Delayed",         color: "#eab308", bg: "#1f1a07", border: "#713f12" },
  arriving:  { label: "Arriving Soon",   color: "#3b82f6", bg: "#0d1a2e", border: "#1e3a5f" },
  cancelled: { label: "Cancelled",       color: "#ef4444", bg: "#1f0d0d", border: "#7f1d1d" },
  bus_full:  { label: "Bus Full",        color: "#f97316", bg: "#1f150a", border: "#7c2d12" },
};

const SORT_OPTIONS = [
  { key: "eta",      label: "Fastest ETA"    },
  { key: "earliest", label: "Earliest Depart"},
  { key: "fewest",   label: "Fewest Stops"   },
];

/* ── helpers ── */
function parseTimeMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmt12(t) {
  if (!t) return "--";
  const [h, m] = t.split(":").map(Number);
  const p = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
}

function tripDuration(dep, arr) {
  let d = parseTimeMins(arr) - parseTimeMins(dep);
  if (d < 0) d += 24 * 60;
  return d;
}

/* ── Memoised bus card ── */
const BusCard = memo(function BusCard({ bus, idx, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const cfg      = STATUS_CONFIG[bus.status] || STATUS_CONFIG.running;
  const dur      = tripDuration(bus.departure_time, bus.arrival_time);
  const hasLive  = bus.current_lat != null;
  const preview  = bus.segment_stops?.map((s) => s.name) || [];
  const eta      = bus.eta_min;
  const isReverse = bus.is_reverse;

  /* upcoming stop = stop after current position */
  const upcomingStop = useMemo(() => {
    const idx = bus.current_stop_index ?? 0;
    return bus.stops?.[idx + 1]?.name || bus.segment_stops?.[1]?.name || null;
  }, [bus]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18, delay: Math.min(idx * 0.05, 0.25) }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#13131f",
        border: `1px solid ${isReverse ? "#374151" : "#1e1e2e"}`,
        opacity: isReverse ? 0.88 : 1,
      }}
    >
      {/* Top accent line */}
      <div
        className="h-0.5"
        style={{
          background: isReverse
            ? `linear-gradient(to right, #37415180, transparent)`
            : `linear-gradient(to right, ${cfg.color}66, transparent)`,
        }}
      />

      {/* Reverse direction label */}
      {isReverse && (
        <div
          className="flex items-center gap-2 px-4 py-2"
          style={{ background: "#1a1a0d", borderBottom: "1px solid #374151" }}
        >
          <RotateCcw className="w-3 h-3 shrink-0" style={{ color: "#eab308" }} />
          <p className="text-xs font-bold" style={{ color: "#eab308" }}>
            Opposite direction — travelling {bus.from_stop?.name} → {bus.to_stop?.name}
          </p>
        </div>
      )}

      <button
        onClick={onSelect}
        className="w-full text-left px-4 pt-3 pb-2"
      >
        {/* Row 1: Number + times + ETA */}
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center font-black text-base"
            style={{
              background: cfg.color + "18",
              border: `2px solid ${cfg.color}44`,
              color: cfg.color,
            }}
          >
            {bus.number}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">{bus.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs font-mono font-medium" style={{ color: "#d1d5db" }}>
                {fmt12(bus.departure_time)}
              </span>
              <ArrowRight className="w-3 h-3 shrink-0" style={{ color: "#374151" }} />
              <span className="text-xs font-mono font-medium" style={{ color: "#d1d5db" }}>
                {fmt12(bus.arrival_time)}
              </span>
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                style={{ background: "#1e1e2e", color: "#6b7280" }}
              >
                {fmtDuration(dur)}
              </span>
            </div>
          </div>

          {/* ETA badge */}
          <div
            className="shrink-0 flex flex-col items-end gap-1"
          >
            <div
              className="px-2.5 py-1 rounded-xl text-xs font-black text-center"
              style={{ background: cfg.color + "18", border: `1px solid ${cfg.color}44`, color: cfg.color }}
            >
              {eta < 2 ? "Now" : `${eta}m`}
            </div>
            <span className="text-[10px] font-medium" style={{ color: "#374151" }}>ETA</span>
          </div>
        </div>

        {/* Row 2: Status + live + upcoming stop */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cfg.color }} />
            {cfg.label}
          </div>

          {hasLive ? (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold"
              style={{ background: "#0d2a1a", border: "1px solid #166534", color: "#22c55e" }}
            >
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              Live GPS
            </div>
          ) : (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
              style={{ background: "#1e1e2e", border: "1px solid #374151", color: "#4b5563" }}
            >
              <Zap className="w-2.5 h-2.5" />
              No GPS
            </div>
          )}

          {upcomingStop && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
              style={{ background: "#0d1a2e", border: "1px solid #1e3a5f", color: "#60a5fa" }}
            >
              <Navigation className="w-2.5 h-2.5" />
              <span className="truncate max-w-[90px]">{upcomingStop}</span>
            </div>
          )}
        </div>

        {/* Row 3: Segment stop count */}
        {preview.length > 0 && (
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "#374151" }}>
            {preview.length} stop{preview.length !== 1 ? "s" : ""} on this segment
            {preview.length > 0 && (
              <span style={{ color: "#4b5563" }}>
                {" "}· {preview[0]}{preview.length > 1 ? ` → ${preview[preview.length - 1]}` : ""}
              </span>
            )}
          </p>
        )}
      </button>

      {/* Expandable route preview */}
      {preview.length > 1 && (
        <>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center gap-2 px-4 pb-3 text-left"
            style={{ color: "#4b5563" }}
          >
            <div className="flex-1 h-px" style={{ background: "#1e1e2e" }} />
            <span className="text-[10px] font-bold uppercase tracking-widest shrink-0">
              {expanded ? "Hide" : "Show"} route
            </span>
            {expanded
              ? <ChevronUp  className="w-3 h-3 shrink-0" />
              : <ChevronDown className="w-3 h-3 shrink-0" />}
            <div className="flex-1 h-px" style={{ background: "#1e1e2e" }} />
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4">
                  <div
                    className="flex flex-wrap items-center gap-1 p-3 rounded-2xl"
                    style={{ background: "#0a0a14", border: "1px solid #1a1a2e" }}
                  >
                    {preview.map((name, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span
                          className="text-xs px-2 py-0.5 rounded-lg font-medium"
                          style={{
                            background: i === 0
                              ? "#818cf822"
                              : i === preview.length - 1
                                ? "#f472b622"
                                : "#1a1a2e",
                            color: i === 0
                              ? "#818cf8"
                              : i === preview.length - 1
                                ? "#f472b6"
                                : "#6b7280",
                          }}
                        >
                          {name}
                        </span>
                        {i < preview.length - 1 && (
                          <ArrowRight className="w-2.5 h-2.5 shrink-0" style={{ color: "#374151" }} />
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
});

/* ══════════════════════════════════════════════════════════════ */
export default function SearchResults({ results, onBusSelect, onBack }) {
  const [sort,     setSort]     = useState("eta");
  const [filter,   setFilter]   = useState("all");
  const [sortOpen, setSortOpen] = useState(false);

  const showingReverse = results?.showing_reverse || false;
  const hasReverseAlso = results?.has_reverse && !showingReverse;

  const sorted = useMemo(() => {
    if (!results?.buses) return [];
    let list = [...results.buses];
    if (filter !== "all") list = list.filter((b) => b.status === filter);
    if (sort === "eta")      list.sort((a, b) => (a.eta_min ?? 99) - (b.eta_min ?? 99));
    if (sort === "earliest") list.sort((a, b) => parseTimeMins(a.departure_time) - parseTimeMins(b.departure_time));
    if (sort === "fewest")   list.sort((a, b) => (a.segment_stops?.length || 0) - (b.segment_stops?.length || 0));
    return list;
  }, [results, sort, filter]);

  const origin = results?.origin_stop?.name || "";
  const dest   = results?.destination_stop?.name || "";

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0A0A0F" }}
    >
      {/* ── Header ── */}
      <div className="shrink-0" style={{ borderBottom: "1px solid #1e1e2e" }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full"
            style={{ background: "#1a1a2e" }}
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base leading-tight">Results</p>
            <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
              {sorted.length} bus{sorted.length !== 1 ? "es" : ""} found
              {showingReverse && (
                <span style={{ color: "#eab308" }}> · opposite direction</span>
              )}
            </p>
          </div>
        </div>

        {/* Route pill */}
        <div
          className="mx-4 mb-3 px-4 py-2.5 rounded-2xl flex items-center gap-2"
          style={{ background: "#141420", border: "1px solid #2d2d4e" }}
        >
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#818cf8" }} />
          <p className="flex-1 text-sm font-bold text-white truncate">{origin}</p>
          <ArrowRight className="w-3 h-3 shrink-0" style={{ color: "#374151" }} />
          <p className="flex-1 text-sm font-bold text-right text-white truncate">{dest}</p>
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#f472b6" }} />
        </div>

        {/* Sort + filter chips */}
        <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
          <div className="relative shrink-0">
            <button
              onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border"
              style={{ background: "#1a1a2e", borderColor: "#2d2d4e", color: "#d1d5db" }}
            >
              <Filter className="w-3 h-3" />
              {SORT_OPTIONS.find((s) => s.key === sort)?.label}
              <ChevronDown className="w-3 h-3" />
            </button>
            <AnimatePresence>
              {sortOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-10 w-44 shadow-xl"
                  style={{ background: "#1a1a2e", border: "1px solid #2d2d4e" }}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => { setSort(opt.key); setSortOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm"
                      style={{
                        color:      sort === opt.key ? "#818cf8" : "#d1d5db",
                        background: sort === opt.key ? "#2d2d4e" : "transparent",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {["all", "running", "delayed", "arriving", "cancelled"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border capitalize"
              style={{
                background:   filter === f ? "#818cf8"  : "#1a1a2e",
                borderColor:  filter === f ? "#818cf8"  : "#2d2d4e",
                color:        filter === f ? "#fff"      : "#9ca3af",
              }}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-2.5">

        {/* Reverse-only notice */}
        {showingReverse && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "#1a1a07", border: "1px solid #713f12" }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#eab308" }} />
            <div>
              <p className="text-xs font-bold" style={{ color: "#eab308" }}>
                No direct buses available for {origin} → {dest}
              </p>
              <p className="text-xs mt-1" style={{ color: "#92400e" }}>
                Showing buses travelling in the opposite direction ({dest} → {origin}).
                You may have missed the bus or it hasn't started yet.
              </p>
            </div>
          </motion.div>
        )}

        {/* Reverse-also notice (when direct results ARE shown) */}
        {hasReverseAlso && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "#111108", border: "1px solid #374151" }}
          >
            <RotateCcw className="w-3 h-3 shrink-0" style={{ color: "#6b7280" }} />
            <p className="text-xs" style={{ color: "#6b7280" }}>
              {results.reverse_count} bus{results.reverse_count !== 1 ? "es" : ""} also run the reverse route ({dest} → {origin})
            </p>
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "#1a1a2e" }}
            >
              <Clock className="w-7 h-7" style={{ color: "#4b5563" }} />
            </div>
            <p className="text-white font-medium">No buses found</p>
            <p className="text-sm text-center" style={{ color: "#6b7280" }}>
              {filter !== "all"
                ? "Try removing the status filter."
                : "No routes serve this stop pair right now."}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {sorted.map((bus, idx) => (
              <BusCard
                key={bus.bus_id}
                bus={bus}
                idx={idx}
                onSelect={() => onBusSelect(bus)}
              />
            ))}
          </AnimatePresence>
        )}

        <div className="h-6" />
      </div>
    </motion.div>
  );
}
