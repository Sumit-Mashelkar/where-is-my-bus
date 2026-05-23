import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Share2, MoreVertical, ChevronDown, Zap, Radio, Clock, Filter } from "lucide-react";

const STATUS_CONFIG = {
  running:   { label: "Running On Time", color: "#22c55e", dot: "bg-green-500",  badge: "bg-green-500/20 text-green-400 border-green-500/30" },
  delayed:   { label: "Delayed",         color: "#eab308", dot: "bg-yellow-400", badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  arriving:  { label: "Arriving Soon",   color: "#3b82f6", dot: "bg-blue-500",   badge: "bg-blue-500/20 text-blue-400 border-blue-500/30"  },
  cancelled: { label: "Cancelled",       color: "#ef4444", dot: "bg-red-500",    badge: "bg-red-500/20 text-red-400 border-red-500/30"    },
};

function parseTimeMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function durationMins(dep, arr) {
  let d = parseTimeMins(arr) - parseTimeMins(dep);
  if (d < 0) d += 24 * 60;
  return d;
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

const SORT_OPTIONS = [
  { key: "earliest", label: "Earliest" },
  { key: "fastest",  label: "Fastest"  },
  { key: "fewest",   label: "Fewest Stops" },
];

export default function SearchResults({ results, onBusSelect, onBack }) {
  const [sort, setSort]         = useState("earliest");
  const [filter, setFilter]     = useState("all");
  const [sortOpen, setSortOpen] = useState(false);

  const sorted = useMemo(() => {
    if (!results?.buses) return [];
    let list = [...results.buses];
    if (filter !== "all") list = list.filter((b) => b.status === filter);
    if (sort === "earliest") list.sort((a, b) => parseTimeMins(a.departure_time) - parseTimeMins(b.departure_time));
    if (sort === "fastest")  list.sort((a, b) => durationMins(a.departure_time, a.arrival_time) - durationMins(b.departure_time, b.arrival_time));
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
      {/* ── Top bar ── */}
      <div className="shrink-0" style={{ background: "#0A0A0F", borderBottom: "1px solid #1e1e2e" }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
            style={{ background: "#1a1a2e" }}
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1">
            <p className="text-white font-bold text-base leading-tight">Search results</p>
            <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
              {sorted.length} bus{sorted.length !== 1 ? "es" : ""} found
            </p>
          </div>
          <button className="w-9 h-9 flex items-center justify-center rounded-full" style={{ background: "#1a1a2e" }}>
            <Share2 className="w-4 h-4" style={{ color: "#9ca3af" }} />
          </button>
          <button className="w-9 h-9 flex items-center justify-center rounded-full" style={{ background: "#1a1a2e" }}>
            <MoreVertical className="w-4 h-4" style={{ color: "#9ca3af" }} />
          </button>
        </div>

        {/* Sort / Filter chips */}
        <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
          {/* Sort dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
              style={{ background: "#1a1a2e", borderColor: "#2d2d4e", color: "#d1d5db" }}
            >
              <Filter className="w-3 h-3" />
              Sort: {SORT_OPTIONS.find((s) => s.key === sort)?.label}
              <ChevronDown className="w-3 h-3" />
            </button>
            <AnimatePresence>
              {sortOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-10 w-40 shadow-xl"
                  style={{ background: "#1a1a2e", border: "1px solid #2d2d4e" }}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => { setSort(opt.key); setSortOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                      style={{
                        color: sort === opt.key ? "#818cf8" : "#d1d5db",
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

          {/* Status filter chips */}
          {[
            { key: "all",       label: "All" },
            { key: "running",   label: "Running" },
            { key: "delayed",   label: "Delayed" },
            { key: "arriving",  label: "Arriving" },
            { key: "cancelled", label: "Cancelled" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
              style={{
                background: filter === f.key ? "#818cf8" : "#1a1a2e",
                borderColor: filter === f.key ? "#818cf8" : "#2d2d4e",
                color: filter === f.key ? "#fff" : "#9ca3af",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Route header */}
        <div
          className="mx-4 mb-3 px-4 py-2.5 rounded-xl flex items-center gap-3"
          style={{ background: "#1a1a2e", border: "1px solid #2d2d4e" }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{origin}</p>
          </div>
          <div className="shrink-0 text-xs font-bold px-2" style={{ color: "#818cf8" }}>→</div>
          <div className="flex-1 min-w-0 text-right">
            <p className="text-white font-bold text-sm truncate">{dest}</p>
          </div>
        </div>
      </div>

      {/* ── Results list ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-2 space-y-3">
        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#1a1a2e" }}>
              <Clock className="w-7 h-7" style={{ color: "#4b5563" }} />
            </div>
            <p className="text-white font-medium">No buses found</p>
            <p className="text-sm text-center" style={{ color: "#6b7280" }}>
              Try changing the filter or search for a different route.
            </p>
          </div>
        )}

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
        <div className="h-6" />
      </div>
    </motion.div>
  );
}

function BusCard({ bus, idx, onSelect }) {
  const cfg = STATUS_CONFIG[bus.status] || STATUS_CONFIG.running;
  const dur = durationMins(bus.departure_time, bus.arrival_time);
  const preview = bus.segment_stops?.map((s) => s.name).join(" → ") || bus.direction || "";
  const hasLive = bus.current_lat != null;

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2, delay: idx * 0.04 }}
      onClick={onSelect}
      className="w-full text-left rounded-2xl overflow-hidden transition-all active:scale-[0.98]"
      style={{ background: "#13131f", border: "1px solid #1e1e2e" }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="p-4">
        {/* Row 1: Number badge + times */}
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-14 h-14 rounded-xl flex items-center justify-center font-black text-base tracking-tighter"
            style={{ background: cfg.color + "22", border: `2px solid ${cfg.color}55`, color: cfg.color }}
          >
            {bus.number}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-white font-black text-lg leading-none">
                {fmt12(bus.departure_time)}
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#1e1e2e", color: "#9ca3af" }}>
                {fmtDuration(dur)}
              </span>
              <span className="text-white font-black text-lg leading-none">
                {fmt12(bus.arrival_time)}
              </span>
            </div>
            <p className="text-sm font-semibold mt-1 truncate" style={{ color: "#d1d5db" }}>{bus.name}</p>
          </div>
        </div>

        {/* Row 2: Route preview */}
        {preview && (
          <p className="text-xs mt-3 leading-relaxed line-clamp-2" style={{ color: "#6b7280" }}>
            {preview}
          </p>
        )}

        {/* Row 3: Status + Live */}
        <div className="flex items-center justify-between mt-3 gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            <span className="text-xs font-medium" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
            {bus.status === "delayed" && (
              <span className="text-xs" style={{ color: "#6b7280" }}>· +8 min</span>
            )}
          </div>
          {hasLive && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "#0d2a1a", border: "1px solid #166534" }}>
              <Radio className="w-2.5 h-2.5 text-green-400" />
              <span className="text-xs font-medium text-green-400">Live</span>
            </div>
          )}
          {!hasLive && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "#1e1e2e", border: "1px solid #374151" }}>
              <Zap className="w-2.5 h-2.5" style={{ color: "#6b7280" }} />
              <span className="text-xs font-medium" style={{ color: "#6b7280" }}>No GPS</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom accent */}
      <div className="h-0.5" style={{ background: `linear-gradient(to right, ${cfg.color}44, transparent)` }} />
    </motion.button>
  );
}
