import { useState, useRef, useEffect, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LocateFixed, Newspaper, AlertTriangle, Bookmark,
  ChevronRight, Clock, MapPin, Loader2, X,
} from "lucide-react";

/* ── helpers ── */
function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60)    return "just now";
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ── 4-card quick access (2 × 2) ── */
const QUICK_CARDS = [
  {
    id: "updates", Icon: Newspaper, label: "Community",
    sub: "Vote on proposals", color: "#f472b6", bg: "#1f0d1a", border: "#7f1d5f",
  },
  {
    id: "report", Icon: AlertTriangle, label: "Report Delay",
    sub: "Update bus status", color: "#eab308", bg: "#1f1a07", border: "#713f12",
  },
  {
    id: "saved", Icon: Bookmark, label: "Saved Routes",
    sub: "Your favourites", color: "#06b6d4", bg: "#071a1f", border: "#065f73",
  },
  {
    id: "nearby", Icon: LocateFixed, label: "Nearby Buses",
    sub: "Buses close to you", color: "#f97316", bg: "#1f1007", border: "#7c3000",
  },
];

/* ── Stop autocomplete ── */
const StopInput = memo(function StopInput({
  value, onChange, onClear, stops, placeholder, accent, inputRef,
}) {
  const [open, setOpen] = useState(false);
  const matches = value.trim().length > 0
    ? stops.filter((s) => s.name.toLowerCase().includes(value.toLowerCase())).slice(0, 5)
    : [];

  useEffect(() => {
    setOpen(matches.length > 0 && value.trim().length > 0);
  }, [value, matches.length]);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(matches.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full bg-transparent outline-none text-sm font-semibold pr-6"
        style={{ color: value ? "#e5e7eb" : "#4b5563" }}
      />
      {value && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onClear(); }}
          className="absolute right-0 top-1/2 -translate-y-1/2"
        >
          <X className="w-3.5 h-3.5" style={{ color: "#4b5563" }} />
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 top-full mt-1 rounded-2xl overflow-hidden z-50"
            style={{
              background: "#141420",
              border: "1px solid #2d2d4e",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {matches.map((s) => (
              <button
                key={s.stop_id}
                onMouseDown={(e) => { e.preventDefault(); onChange(s.name); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
                style={{ borderBottom: "1px solid #1e1e2e" }}
              >
                <MapPin className="w-3 h-3 shrink-0" style={{ color: accent }} />
                <span className="text-sm" style={{ color: "#e5e7eb" }}>{s.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════ */
export default function LandingPage({
  stops = [],
  buses = [],
  connected,
  pendingCount,
  origin, setOrigin,
  destination, setDestination,
  onSearch,
  searching,
  onAction,
  searchHistory = [],
  savedRoutes = [],
  onHistorySelect,
  onRemoveHistory,
}) {
  const originRef = useRef(null);

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  const canSearch = origin.trim() && destination.trim();

  return (
    <div
      className="flex flex-col min-h-full"
      style={{ background: "#0A0A0F", paddingBottom: 80 }}
    >
      {/* ── Greeting ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="px-5 pt-4 pb-2"
      >
        <p className="text-2xl font-black tracking-tight text-white">{greetingText()} 👋</p>
        <p className="text-sm mt-0.5" style={{ color: "#4b5563" }}>
          {buses.length} buses · {stops.length} stops tracked live
        </p>
      </motion.div>

      {/* ── Route search card ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="mx-4 mt-2 rounded-3xl overflow-visible"
        style={{ background: "#0f0f1a", border: "1px solid #1e1e2e" }}
      >
        <div className="px-4 pt-4 pb-2 relative">
          {/* Origin row */}
          <div className="flex items-center gap-3 py-3">
            <div className="flex flex-col items-center shrink-0">
              <div
                className="w-4 h-4 rounded-full border-2"
                style={{ background: "#818cf8", borderColor: "#818cf8", boxShadow: "0 0 8px #818cf844" }}
              />
            </div>
            <div
              className="flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl"
              style={{ background: "#141420", border: "1px solid #2d2d4e" }}
            >
              <span
                className="shrink-0 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                style={{ background: "#818cf822", color: "#818cf8", border: "1px solid #818cf844" }}
              >
                FROM
              </span>
              <StopInput
                inputRef={originRef}
                value={origin}
                onChange={setOrigin}
                onClear={() => setOrigin("")}
                stops={stops}
                placeholder="Starting stop…"
                accent="#818cf8"
              />
            </div>
          </div>

          {/* Connector + swap */}
          <div className="flex items-center gap-3 py-0.5">
            <div className="flex flex-col items-center w-4 shrink-0">
              <div className="w-px h-3" style={{ background: "#1e2a3e" }} />
              <div className="w-1 h-1 rounded-full" style={{ background: "#374151" }} />
              <div className="w-px h-3" style={{ background: "#1e2a3e" }} />
            </div>
            <div className="flex-1" />
            <button
              onClick={swap}
              className="w-8 h-8 flex items-center justify-center rounded-full mr-0"
              style={{ background: "#141420", border: "1px solid #2d2d4e" }}
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M5 2L5 14M5 14L2 11M5 14L8 11M11 14L11 2M11 2L8 5M11 2L14 5"
                  stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Destination row */}
          <div className="flex items-center gap-3 py-3">
            <div className="flex flex-col items-center shrink-0">
              <div
                className="w-4 h-4 rounded-full border-2"
                style={{ background: "transparent", borderColor: "#f472b6", boxShadow: "0 0 8px #f472b644" }}
              />
            </div>
            <div
              className="flex-1 flex items-center gap-2 px-4 py-3 rounded-2xl"
              style={{ background: "#141420", border: "1px solid #2d2d4e" }}
            >
              <span
                className="shrink-0 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
                style={{ background: "#f472b622", color: "#f472b6", border: "1px solid #f472b644" }}
              >
                TO
              </span>
              <StopInput
                value={destination}
                onChange={setDestination}
                onClear={() => setDestination("")}
                stops={stops}
                placeholder="Destination stop…"
                accent="#f472b6"
              />
            </div>
          </div>
        </div>

        {/* Search button */}
        <div className="px-4 pb-4">
          <motion.button
            onClick={onSearch}
            disabled={!canSearch || searching}
            whileTap={canSearch ? { scale: 0.97 } : {}}
            className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm disabled:opacity-40 transition-opacity"
            style={{ background: canSearch ? "#818cf8" : "#1a1a2e", color: canSearch ? "#fff" : "#374151" }}
          >
            {searching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Find Buses
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* ── Quick access — 2 × 2 grid ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26 }}
        className="px-4 mt-5"
      >
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#374151" }}>
          Quick Access
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {QUICK_CARDS.map(({ id, Icon, label, sub, color, bg, border }, i) => (
            <motion.button
              key={id}
              onClick={() => onAction(id)}
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.26 + i * 0.05 }}
              whileTap={{ scale: 0.94 }}
              className="relative flex items-center gap-3 px-4 py-4 rounded-2xl text-left"
              style={{ background: "#0f0f1a", border: "1px solid #1e1e2e" }}
            >
              {id === "updates" && pendingCount > 0 && (
                <span
                  className="absolute top-2 right-2 text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full"
                  style={{ background: "#f472b6", color: "#000" }}
                >
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
              <div
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-2xl"
                style={{ background: bg, border: `1px solid ${border}` }}
              >
                <Icon className="w-5 h-5" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white leading-tight">{label}</p>
                <p className="text-xs mt-0.5 leading-tight truncate" style={{ color: "#4b5563" }}>{sub}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* ── Saved Routes ── */}
      {savedRoutes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="px-4 mt-5"
        >
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#374151" }}>
            Saved Routes
          </p>
          <div className="flex flex-col gap-2">
            {savedRoutes.map((r) => (
              <motion.button
                key={r.id}
                onClick={() => onHistorySelect(r)}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left"
                style={{ background: "#0f0f1a", border: "1px solid #1e1e2e" }}
              >
                <div
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl"
                  style={{ background: "#06b6d422", border: "1px solid #065f73" }}
                >
                  <Bookmark className="w-3.5 h-3.5" style={{ color: "#06b6d4" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate text-white">
                    {r.label || `${r.origin} → ${r.destination}`}
                  </p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "#4b5563" }}>
                    {r.origin} → {r.destination}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "#2d2d4e" }} />
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Search history ── */}
      {searchHistory.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.43 }}
          className="px-4 mt-5"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#374151" }}>
              Recent Searches
            </p>
            <button
              onClick={() => onRemoveHistory("all")}
              className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-lg"
              style={{ color: "#374151", background: "#141420" }}
            >
              Clear
            </button>
          </div>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid #1e1e2e", background: "#0f0f1a" }}
          >
            {searchHistory.map((item, idx) => (
              <motion.button
                key={item.id}
                onClick={() => onHistorySelect(item)}
                whileTap={{ scale: 0.99 }}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                style={{
                  borderBottom: idx < searchHistory.length - 1 ? "1px solid #141420" : "none",
                }}
              >
                <div
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl"
                  style={{ background: "#1a1a2e" }}
                >
                  <Clock className="w-3.5 h-3.5" style={{ color: "#4b5563" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {item.buses?.slice(0, 2).map((b) => (
                      <span
                        key={b.number}
                        className="text-[10px] font-black px-1.5 py-0.5 rounded-md"
                        style={{ background: "#818cf822", color: "#818cf8" }}
                      >
                        {b.number}
                      </span>
                    ))}
                    {item.buses?.length > 2 && (
                      <span className="text-[10px]" style={{ color: "#374151" }}>
                        +{item.buses.length - 2}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium truncate" style={{ color: "#9ca3af" }}>
                    {item.origin}
                    <span style={{ color: "#374151" }}> → </span>
                    {item.destination}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className="text-[10px]" style={{ color: "#374151" }}>{timeAgo(item.time)}</span>
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: "#2d2d4e" }} />
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      <div className="h-4" />
    </div>
  );
}
