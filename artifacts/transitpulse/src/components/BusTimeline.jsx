import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, LocateFixed, ChevronDown, ChevronUp,
  Radio, Navigation, Clock, RefreshCw, CheckCircle2, Wifi,
} from "lucide-react";
import { get } from "@/lib/api";
import { socket } from "@/lib/socket";
import CommunityUpdates from "@/components/CommunityUpdates";

const STATUS_CONFIG = {
  running:   { label: "Running On Time",   color: "#22c55e", bg: "#0d2a1a", border: "#166534" },
  delayed:   { label: "Delayed",           color: "#eab308", bg: "#1f1a07", border: "#713f12" },
  arriving:  { label: "Arriving Soon",     color: "#3b82f6", bg: "#0d1a2e", border: "#1e3a5f" },
  cancelled: { label: "Service Cancelled", color: "#ef4444", bg: "#1f0d0d", border: "#7f1d1d" },
};

/* ── helpers ── */
function parseTimeMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt12(t) {
  if (!t) return "--";
  const [h, m] = t.split(":").map(Number);
  const p = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
}

function estimateStopTimes(stops, departure, arrival) {
  const depM = parseTimeMins(departure);
  let totM = parseTimeMins(arrival) - depM;
  if (totM < 0) totM += 24 * 60;
  return stops.map((s, i) => {
    const frac = stops.length <= 1 ? 0 : i / (stops.length - 1);
    const mins = depM + Math.round(frac * totM);
    const h24 = String(Math.floor(mins / 60) % 24).padStart(2, "0");
    const mm  = String(mins % 60).padStart(2, "0");
    return { ...s, estTime: fmt12(`${h24}:${mm}`) };
  });
}

function fmtExactTime(date) {
  if (!date) return "--";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

function fmtRelative(secs) {
  if (secs < 5)    return "just now";
  if (secs < 60)   return `${secs} second${secs !== 1 ? "s" : ""} ago`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    return `${m} minute${m !== 1 ? "s" : ""} ago`;
  }
  const h = Math.floor(secs / 3600);
  return `${h} hour${h !== 1 ? "s" : ""} ago`;
}

/* ══════════════════════════════════════════════════════════════ */
export default function BusTimeline({ bus: initialBus, onBack, onUpdateLocation }) {
  const [bus, setBus]             = useState(initialBus);
  const [stops, setStops]         = useState([]);
  const [currentIdx, setCurrentIdx] = useState(initialBus?.current_stop_index ?? 0);
  const [expanded, setExpanded]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);

  /* timestamp tracking */
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [secondsAgo, setSecondsAgo]     = useState(0);
  const lastSyncedRef = useRef(null);

  /* keep ref in sync so the interval can read it without re-creating */
  useEffect(() => { lastSyncedRef.current = lastSyncedAt; }, [lastSyncedAt]);

  /* live ticker — runs once, reads ref so no extra deps */
  useEffect(() => {
    const id = setInterval(() => {
      if (lastSyncedRef.current) {
        setSecondsAgo(Math.floor((Date.now() - lastSyncedRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const markSynced = useCallback(() => {
    const now = new Date();
    setLastSyncedAt(now);
    setSecondsAgo(0);
  }, []);

  /* ── fetch ── */
  const fetchDetails = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const d = await get(`/buses/${initialBus.bus_id}`);
      setBus(d);
      /* preserve expanded + scroll — only stops/idx updated */
      setStops(estimateStopTimes(
        d.stops || initialBus.segment_stops || [],
        d.departure_time,
        d.arrival_time,
      ));
      setCurrentIdx(d.current_stop_index ?? 0);
      markSynced();
      if (manual) {
        setJustRefreshed(true);
        setTimeout(() => setJustRefreshed(false), 2500);
      }
    } catch {
      const fallback = initialBus.segment_stops || [];
      setStops(estimateStopTimes(fallback, initialBus.departure_time, initialBus.arrival_time));
    }
    setLoading(false);
    if (manual) setIsRefreshing(false);
  }, [initialBus, markSynced]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  /* ── socket ── */
  useEffect(() => {
    const onLoc = (p) => {
      if (p.bus_id !== initialBus.bus_id) return;
      setBus((b) => ({
        ...b,
        current_lat: p.lat, current_lng: p.lng,
        status: p.status || b.status, last_update: p.last_update,
      }));
      markSynced();
    };
    const onStop = (p) => {
      if (p.bus_id !== initialBus.bus_id) return;
      setCurrentIdx(p.current_stop_index);
      markSynced();
    };
    socket.on("bus_location", onLoc);
    socket.on("bus_stop_update", onStop);
    return () => { socket.off("bus_location", onLoc); socket.off("bus_stop_update", onStop); };
  }, [initialBus.bus_id, markSynced]);

  /* ── derived ── */
  const cfg      = STATUS_CONFIG[bus?.status] || STATUS_CONFIG.running;
  const total    = stops.length;
  const progress = total <= 1 ? 0 : Math.round((currentIdx / (total - 1)) * 100);
  const isFresh  = secondsAgo < 30;

  const ALWAYS_SHOW = 3;
  const shouldCollapse = !expanded && total > ALWAYS_SHOW + 2;
  const visibleStops   = shouldCollapse
    ? [...stops.slice(0, Math.max(currentIdx + 2, ALWAYS_SHOW)), stops[total - 1]]
    : stops;
  const hiddenCount = shouldCollapse ? total - visibleStops.length : 0;

  /* ══ render ══ */
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0A0A0F" }}
    >
      {/* ── Header ── */}
      <div className="shrink-0 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid #1e1e2e" }}>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full"
            style={{ background: "#1a1a2e" }}
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="shrink-0 text-sm font-black px-2.5 py-1 rounded-lg"
                style={{ background: cfg.color + "22", color: cfg.color, border: `1px solid ${cfg.color}44` }}
              >
                {bus?.number}
              </span>
              <p className="text-white font-bold text-base truncate">{bus?.name}</p>
            </div>
          </div>

          {bus?.current_lat != null && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "#0d2a1a", border: "1px solid #166534" }}>
              <Radio className="w-3 h-3 text-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">Live</span>
            </div>
          )}

          {/* Refresh button */}
          <button
            onClick={() => fetchDetails(true)}
            disabled={isRefreshing}
            title="Refresh status"
            className="w-8 h-8 flex items-center justify-center rounded-full transition-opacity disabled:opacity-50"
            style={{ background: "#1a1a2e" }}
          >
            <motion.div
              animate={{ rotate: isRefreshing ? 360 : 0 }}
              transition={isRefreshing
                ? { duration: 0.7, repeat: Infinity, ease: "linear" }
                : { duration: 0.3 }}
            >
              <RefreshCw className="w-3.5 h-3.5" style={{ color: justRefreshed ? "#22c55e" : "#6b7280" }} />
            </motion.div>
          </button>
        </div>

        {/* Status badge */}
        <div className="flex items-center justify-between gap-3">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
            {cfg.label}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1.5" style={{ color: "#4b5563" }}>
            <span>{stops[0]?.name || "—"}</span>
            <span style={{ color: cfg.color }}>{progress}%</span>
            <span>{stops[total - 1]?.name || "—"}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1e1e2e" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(to right, ${cfg.color}, ${cfg.color}aa)` }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Route info row */}
        <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: "#6b7280" }}>
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>{fmt12(bus?.departure_time)} → {fmt12(bus?.arrival_time)}</span>
          {bus?.direction && (
            <>
              <span>·</span>
              <Navigation className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{bus.direction}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Timeline ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4">
        {loading ? (
          <div className="flex flex-col gap-4 mt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-4 animate-pulse">
                <div className="flex flex-col items-center pt-1">
                  <div className="w-4 h-4 rounded-full" style={{ background: "#1e1e2e" }} />
                  <div className="w-0.5 h-14 mt-1" style={{ background: "#1e1e2e" }} />
                </div>
                <div className="flex-1 pt-1">
                  <div className="h-4 rounded w-32" style={{ background: "#1e1e2e" }} />
                  <div className="h-3 rounded w-16 mt-2" style={{ background: "#1e1e2e" }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <AnimatePresence>
            {visibleStops.map((s, vi) => {
              const realIdx   = stops.findIndex((x) => x.stop_id === s.stop_id);
              const isPast    = realIdx < currentIdx;
              const isCurrent = realIdx === currentIdx;
              const isFirst   = realIdx === 0;
              const isLast    = realIdx === total - 1;
              const isLastVisible = vi === visibleStops.length - 1;

              return (
                <motion.div
                  key={s.stop_id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: vi * 0.05 }}
                >
                  <div className="flex items-start gap-4">
                    {/* Node + connector */}
                    <div className="flex flex-col items-center" style={{ minWidth: 20 }}>
                      {!isFirst && (
                        <div
                          className="w-0.5"
                          style={{
                            height: 20,
                            background: isPast
                              ? cfg.color
                              : isCurrent
                              ? `linear-gradient(to bottom, ${cfg.color}, #2d2d4e)`
                              : "#2d2d4e",
                          }}
                        />
                      )}

                      {isCurrent ? (
                        <motion.div
                          animate={{ boxShadow: [`0 0 0px ${cfg.color}00`, `0 0 12px ${cfg.color}88`, `0 0 0px ${cfg.color}00`] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: cfg.color, border: `3px solid ${cfg.color}55` }}
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        </motion.div>
                      ) : isPast ? (
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: cfg.color + "33", border: `2px solid ${cfg.color}` }}
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      ) : (
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{
                            background: "transparent",
                            border: isFirst || isLast ? "2px solid #6b7280" : "2px solid #374151",
                          }}
                        />
                      )}

                      {!isLastVisible && (
                        <div
                          className="w-0.5 flex-1"
                          style={{ minHeight: 40, background: isPast ? cfg.color : "#2d2d4e" }}
                        />
                      )}
                    </div>

                    {/* Stop info */}
                    <div className="flex-1 pb-8">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            className="font-semibold text-sm leading-tight"
                            style={{ color: isCurrent ? cfg.color : isPast ? "#4b5563" : "#e5e7eb" }}
                          >
                            {s.name}
                          </p>
                          {(isFirst || isLast) && (
                            <span
                              className="text-[10px] font-bold uppercase tracking-widest"
                              style={{ color: isFirst ? "#818cf8" : "#f472b6" }}
                            >
                              {isFirst ? "Origin" : "Destination"}
                            </span>
                          )}
                          {isCurrent && (
                            <motion.p
                              animate={{ opacity: [1, 0.4, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                              className="text-xs font-medium mt-0.5"
                              style={{ color: cfg.color }}
                            >
                              ● Bus is here
                            </motion.p>
                          )}
                        </div>
                        <p className="text-xs shrink-0 font-mono" style={{ color: isPast ? "#374151" : "#6b7280" }}>
                          {s.estTime}
                        </p>
                      </div>
                    </div>
                  </div>

                  {shouldCollapse && vi === visibleStops.length - 2 && (
                    <button
                      onClick={() => setExpanded(true)}
                      className="flex items-center gap-2 ml-9 mb-2 text-xs font-medium px-3 py-1.5 rounded-full"
                      style={{ background: "#1a1a2e", color: "#818cf8", border: "1px solid #2d2d4e" }}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                      +{hiddenCount} more stops
                    </button>
                  )}
                  {expanded && isLast && (
                    <button
                      onClick={() => setExpanded(false)}
                      className="flex items-center gap-2 ml-9 mb-2 text-xs font-medium px-3 py-1.5 rounded-full"
                      style={{ background: "#1a1a2e", color: "#818cf8", border: "1px solid #2d2d4e" }}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      Show less
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        {/* ── Community Reports ── */}
        {!loading && (
          <div className="mt-2" style={{ borderTop: "1px solid #1e1e2e" }}>
            <CommunityUpdates busId={initialBus.bus_id} />
          </div>
        )}

        <div className="h-4" />
      </div>

      {/* ── Last Updated panel ── */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ background: "#0d0d17", borderTop: "1px solid #1e1e2e" }}
      >
        <div className="flex items-center justify-between gap-3">
          {/* Left: dot + timestamps */}
          <div className="flex items-start gap-2.5 min-w-0">
            {/* Fresh/stale indicator */}
            <div className="mt-0.5 shrink-0">
              {lastSyncedAt ? (
                isFresh ? (
                  <motion.div
                    className="w-2 h-2 rounded-full"
                    style={{ background: "#22c55e" }}
                    animate={{ scale: [1, 1.5, 1], opacity: [1, 0.6, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#374151" }} />
                )
              ) : (
                <div className="w-2 h-2 rounded-full" style={{ background: "#374151" }} />
              )}
            </div>

            <div className="min-w-0">
              {/* Exact time — fades in/out on change */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={lastSyncedAt ? lastSyncedAt.getTime() : "none"}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.25 }}
                  className="text-xs font-mono font-semibold"
                  style={{ color: lastSyncedAt ? "#9ca3af" : "#374151" }}
                >
                  {lastSyncedAt ? `Synced at ${fmtExactTime(lastSyncedAt)}` : "Waiting for sync…"}
                </motion.p>
              </AnimatePresence>

              {/* Live relative counter */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={secondsAgo}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="text-xs mt-0.5"
                  style={{ color: isFresh ? "#4b9b6f" : "#374151" }}
                >
                  {lastSyncedAt ? `Updated ${fmtRelative(secondsAgo)}` : "No data yet"}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Right: sync label */}
          <div
            className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{
              background: isFresh ? "#0d2a1a" : "#111118",
              border: `1px solid ${isFresh ? "#166534" : "#1e1e2e"}`,
              color: isFresh ? "#22c55e" : "#374151",
            }}
          >
            <Wifi className="w-3 h-3" />
            <AnimatePresence mode="wait">
              <motion.span
                key={isFresh ? "fresh" : "stale"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {justRefreshed ? "Refreshed!" : isFresh ? "Realtime synced" : "Auto-refresh active"}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Bottom action ── */}
      <div
        className="shrink-0 px-4 py-4"
        style={{ background: "#0d0d17", borderTop: "1px solid #1a1a2e" }}
      >
        <button
          onClick={() => onUpdateLocation(bus)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
          style={{ background: cfg.color, color: "#000" }}
        >
          <LocateFixed className="w-4 h-4" />
          Update Bus Location
        </button>
        <p className="text-center text-xs mt-2" style={{ color: "#374151" }}>
          Crowd-sourced — any rider can help track this bus
        </p>
      </div>
    </motion.div>
  );
}
