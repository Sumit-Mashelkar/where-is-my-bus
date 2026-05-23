import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Bell, BellOff, Bus, ChevronDown, ChevronUp,
  Clock, RefreshCw, CheckCircle2, Wifi, X, MapPin,
  Users, AlertTriangle, Radio, Navigation,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { socket } from "@/lib/socket";
import { getUserId } from "@/lib/userId";
import { toast } from "sonner";
import CommunityUpdates from "@/components/CommunityUpdates";

/* ── status config ── */
const STATUS_CONFIG = {
  running:   { label: "Running On Time",   color: "#22c55e", bg: "#0d2a1a", border: "#166534" },
  delayed:   { label: "Delayed",           color: "#eab308", bg: "#1f1a07", border: "#713f12" },
  arriving:  { label: "Arriving Soon",     color: "#3b82f6", bg: "#0d1a2e", border: "#1e3a5f" },
  cancelled: { label: "Service Cancelled", color: "#ef4444", bg: "#1f0d0d", border: "#7f1d1d" },
  bus_full:  { label: "Bus Full",          color: "#f97316", bg: "#1f150a", border: "#7c2d12" },
};

const INSIDE_BUS_STATUSES = [
  { value: "running",   label: "On Time",   icon: "✅" },
  { value: "delayed",   label: "Delayed",   icon: "⏳" },
  { value: "bus_full",  label: "Crowded",   icon: "🚌" },
  { value: "arriving",  label: "At Stop",   icon: "📍" },
  { value: "cancelled", label: "Cancelled", icon: "❌" },
];

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

function minsToHHMM(mins) {
  const h24 = String(Math.floor(mins / 60) % 24).padStart(2, "0");
  const mm  = String(mins % 60).padStart(2, "0");
  return `${h24}:${mm}`;
}

function estimateStopTimes(stops, departure, arrival, delayMins = 0) {
  const depM = parseTimeMins(departure);
  let totM = parseTimeMins(arrival) - depM;
  if (totM < 0) totM += 24 * 60;
  return stops.map((s, i) => {
    const frac = stops.length <= 1 ? 0 : i / (stops.length - 1);
    const sched = depM + Math.round(frac * totM);
    const live  = sched + delayMins;
    return {
      ...s,
      estTime:  fmt12(minsToHHMM(sched)),
      liveTime: fmt12(minsToHHMM(live)),
    };
  });
}

function fmtRelative(secs) {
  if (secs < 5)    return "just now";
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) { const m = Math.floor(secs / 60); return `${m} min${m !== 1 ? "s" : ""} ago`; }
  const h = Math.floor(secs / 3600);
  return `${h} hr${h !== 1 ? "s" : ""} ago`;
}

/* ── Inside Bus Modal ── */
function InsideBusModal({ stops, busId, onClose, currentIdx }) {
  const [stopIdx,    setStopIdx]    = useState(currentIdx);
  const [direction,  setDirection]  = useState("");
  const [status,     setStatus]     = useState("running");
  const [submitting, setSubmitting] = useState(false);
  const userId = getUserId();

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await post(`/buses/${busId}/status-update`, {
        stop_index: stopIdx,
        status,
        direction: direction || undefined,
        user_id: userId,
      });
      toast.success("Report submitted — thanks for helping!");
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail === "rate_limited") {
        toast.error("Please wait 60 seconds before submitting again");
      } else {
        toast.error("Failed to submit report");
      }
    }
    setSubmitting(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="w-full rounded-t-3xl overflow-hidden"
        style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderBottom: "none" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "#374151" }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #1e1e2e" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#1a2a4a" }}>
              <Bus className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Report from Inside Bus</p>
              <p className="text-xs" style={{ color: "#6b7280" }}>Help other riders with real-time info</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: "#1e1e2e" }}>
            <X className="w-4 h-4" style={{ color: "#6b7280" }} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 pb-8">
          {/* Current Stop */}
          <div>
            <label className="text-xs font-bold uppercase tracking-widest mb-2 block" style={{ color: "#4b5563" }}>
              Current Stop
            </label>
            <select
              value={stopIdx}
              onChange={(e) => setStopIdx(Number(e.target.value))}
              className="w-full px-4 py-3 rounded-2xl text-sm font-medium text-white appearance-none"
              style={{ background: "#141420", border: "1px solid #2d2d4e", outline: "none" }}
            >
              {stops.map((s, i) => (
                <option key={s.stop_id} value={i}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Bus Direction */}
          <div>
            <label className="text-xs font-bold uppercase tracking-widest mb-2 block" style={{ color: "#4b5563" }}>
              Bus Direction <span style={{ color: "#374151" }}>(optional)</span>
            </label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl text-sm font-medium text-white appearance-none"
              style={{ background: "#141420", border: "1px solid #2d2d4e", outline: "none" }}
            >
              <option value="">Not sure</option>
              <option value="forward">Forward (towards end)</option>
              <option value="reverse">Reverse (towards start)</option>
            </select>
          </div>

          {/* Bus Status */}
          <div>
            <label className="text-xs font-bold uppercase tracking-widest mb-2 block" style={{ color: "#4b5563" }}>
              Bus Status
            </label>
            <div className="grid grid-cols-3 gap-2">
              {INSIDE_BUS_STATUSES.map((opt) => {
                const selected = status === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-2xl text-xs font-semibold transition-all"
                    style={{
                      background: selected ? "#1a2a4a" : "#141420",
                      border: `1.5px solid ${selected ? "#3b82f6" : "#2d2d4e"}`,
                      color: selected ? "#60a5fa" : "#6b7280",
                    }}
                  >
                    <span className="text-lg">{opt.icon}</span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
            style={{ background: "#3b82f6", color: "#fff" }}
          >
            {submitting ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}>
                <RefreshCw className="w-4 h-4" />
              </motion.div>
            ) : (
              <>
                <Bus className="w-4 h-4" />
                Submit Report
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Notifications Modal ── */
function NotificationsModal({ busName, busNumber, subscribed, onToggle, onClose }) {
  const notifItems = [
    { icon: "📍", label: "Bus reached a stop", desc: "Get notified when bus arrives at each stop" },
    { icon: "⏳", label: "Delay reports", desc: "Know when community reports a delay" },
    { icon: "🔄", label: "Direction changes", desc: "Alerts when bus reverses or changes route" },
    { icon: "✅", label: "Verified updates", desc: "Community-confirmed status changes" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="w-full rounded-t-3xl overflow-hidden"
        style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderBottom: "none" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "#374151" }} />
        </div>

        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #1e1e2e" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: subscribed ? "#0d2a1a" : "#1a1a2e" }}>
              <Bell className="w-4 h-4" style={{ color: subscribed ? "#22c55e" : "#6b7280" }} />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Bus Notifications</p>
              <p className="text-xs" style={{ color: "#6b7280" }}>
                {busNumber} · {busName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: "#1e1e2e" }}>
            <X className="w-4 h-4" style={{ color: "#6b7280" }} />
          </button>
        </div>

        <div className="px-5 py-4 pb-8 flex flex-col gap-3">
          {notifItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl"
              style={{ background: "#141420", border: "1px solid #1e1e2e" }}
            >
              <span className="text-xl">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{item.label}</p>
                <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{item.desc}</p>
              </div>
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: subscribed ? "#22c55e" : "#374151" }}
              />
            </div>
          ))}

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onToggle}
            className="mt-2 w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
            style={{
              background: subscribed ? "#1f0d0d" : "#0d2a1a",
              border: `1.5px solid ${subscribed ? "#7f1d1d" : "#166534"}`,
              color: subscribed ? "#ef4444" : "#22c55e",
            }}
          >
            {subscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            {subscribed ? "Unsubscribe from alerts" : "Subscribe to alerts"}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function BusTimeline({ bus: initialBus, onBack, onUpdateLocation }) {
  const [bus, setBus]               = useState(initialBus);
  const [stops, setStops]           = useState([]);
  const [currentIdx, setCurrentIdx] = useState(initialBus?.current_stop_index ?? 0);
  const [expanded, setExpanded]     = useState(false);
  const [loading, setLoading]       = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);

  /* modals */
  const [showInsideBus,    setShowInsideBus]    = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [subscribed, setSubscribed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`tp_notif_${initialBus.bus_id}`) || "false"); } catch { return false; }
  });

  /* timestamp tracking */
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [secondsAgo,   setSecondsAgo]   = useState(0);
  const lastSyncedRef = useRef(null);

  useEffect(() => { lastSyncedRef.current = lastSyncedAt; }, [lastSyncedAt]);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastSyncedRef.current) {
        setSecondsAgo(Math.floor((Date.now() - lastSyncedRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const markSynced = useCallback(() => {
    setLastSyncedAt(new Date());
    setSecondsAgo(0);
  }, []);

  /* ── fetch ── */
  const fetchDetails = useCallback(async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const d = await get(`/buses/${initialBus.bus_id}`);
      setBus(d);
      const delayMins = d.status === "delayed" ? 2 : 0;
      setStops(estimateStopTimes(
        d.stops || initialBus.segment_stops || [],
        d.departure_time,
        d.arrival_time,
        delayMins,
      ));
      setCurrentIdx(d.current_stop_index ?? 0);
      markSynced();
      if (manual) {
        setJustRefreshed(true);
        setTimeout(() => setJustRefreshed(false), 2500);
      }
    } catch {
      const fallback = initialBus.segment_stops || [];
      const delayMins = initialBus.status === "delayed" ? 2 : 0;
      setStops(estimateStopTimes(fallback, initialBus.departure_time, initialBus.arrival_time, delayMins));
    }
    setLoading(false);
    if (manual) setIsRefreshing(false);
  }, [initialBus, markSynced]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  /* ── socket ── */
  useEffect(() => {
    const onLoc = (p) => {
      if (p.bus_id !== initialBus.bus_id) return;
      setBus((b) => ({ ...b, current_lat: p.lat, current_lng: p.lng, status: p.status || b.status }));
      markSynced();
    };
    const onStop = (p) => {
      if (p.bus_id !== initialBus.bus_id) return;
      setCurrentIdx(p.current_stop_index);
      markSynced();
      if (subscribed) {
        toast.info(`Bus reached stop ${p.current_stop_index + 1}`, { icon: "📍" });
      }
    };
    const onStatus = (p) => {
      if (p.bus_id !== initialBus.bus_id) return;
      if (subscribed && p.status !== bus?.status) {
        toast.info(`Bus status: ${p.status}`, { icon: "🔔" });
      }
    };
    socket.on("bus_location",     onLoc);
    socket.on("bus_stop_update",  onStop);
    socket.on("bus_status_update", onStatus);
    return () => {
      socket.off("bus_location",     onLoc);
      socket.off("bus_stop_update",  onStop);
      socket.off("bus_status_update", onStatus);
    };
  }, [initialBus.bus_id, markSynced, subscribed, bus?.status]);

  /* ── notification toggle ── */
  const toggleSubscription = useCallback(() => {
    const next = !subscribed;
    setSubscribed(next);
    localStorage.setItem(`tp_notif_${initialBus.bus_id}`, JSON.stringify(next));
    toast.success(next ? "Subscribed to bus alerts 🔔" : "Unsubscribed from alerts");
    setShowNotifications(false);
  }, [subscribed, initialBus.bus_id]);

  /* ── derived ── */
  const cfg      = STATUS_CONFIG[bus?.status] || STATUS_CONFIG.running;
  const total    = stops.length;
  const progress = total <= 1 ? 0 : Math.round((currentIdx / (total - 1)) * 100);
  const isFresh  = secondsAgo < 30;
  const currentStop = stops[currentIdx];

  const ALWAYS_SHOW = 3;
  const shouldCollapse   = !expanded && total > ALWAYS_SHOW + 2;
  const visibleStops     = shouldCollapse
    ? [...stops.slice(0, Math.max(currentIdx + 2, ALWAYS_SHOW)), stops[total - 1]]
    : stops;
  const hiddenCount = shouldCollapse ? total - visibleStops.length : 0;

  /* ══ render ══ */
  return (
    <>
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="fixed inset-0 z-50 flex flex-col"
        style={{ background: "#080812" }}
      >
        {/* ══ HEADER ══ */}
        <div className="shrink-0 px-4 pt-5 pb-3" style={{ borderBottom: "1px solid #15152a" }}>
          {/* Top row: back + route title */}
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center rounded-full shrink-0"
              style={{ background: "#1a1a2e" }}
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-sm font-black px-2.5 py-0.5 rounded-lg shrink-0"
                  style={{ background: cfg.color + "20", color: cfg.color, border: `1px solid ${cfg.color}40` }}
                >
                  {bus?.number}
                </span>
                <p className="text-white font-bold text-base truncate">{bus?.name}</p>
              </div>
              {/* Route direction subtitle */}
              {stops.length >= 2 && (
                <p className="text-xs mt-0.5 truncate" style={{ color: "#6b7280" }}>
                  {stops[0]?.name} → {stops[stops.length - 1]?.name}
                </p>
              )}
            </div>

            {/* Live indicator */}
            {bus?.current_lat != null && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full shrink-0" style={{ background: "#0d2a1a", border: "1px solid #166534" }}>
                <Radio className="w-3 h-3 text-green-400 animate-pulse" />
                <span className="text-xs text-green-400 font-medium">Live</span>
              </div>
            )}
          </div>

          {/* ── Action row: Last Updated | Notifications | Inside Bus ── */}
          <div className="flex items-center gap-2 mt-3">
            {/* Last Updated */}
            <div
              className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-2xl min-w-0"
              style={{ background: "#0f0f1c", border: "1px solid #1e1e2e" }}
            >
              <motion.div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: isFresh ? "#22c55e" : "#374151" }}
                animate={isFresh ? { scale: [1, 1.5, 1], opacity: [1, 0.5, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
              <span className="text-xs truncate" style={{ color: isFresh ? "#9ca3af" : "#4b5563" }}>
                {lastSyncedAt ? `Updated ${fmtRelative(secondsAgo)}` : "Connecting…"}
              </span>
            </div>

            {/* Notifications button */}
            <button
              onClick={() => setShowNotifications(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold shrink-0"
              style={{
                background: subscribed ? "#0d2a1a" : "#0f0f1c",
                border: `1px solid ${subscribed ? "#166534" : "#1e1e2e"}`,
                color: subscribed ? "#22c55e" : "#6b7280",
              }}
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Alerts</span>
            </button>

            {/* Inside Bus button */}
            <button
              onClick={() => setShowInsideBus(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold shrink-0"
              style={{ background: "#0f1a2e", border: "1px solid #1e3a5f", color: "#60a5fa" }}
            >
              <Bus className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Report</span>
            </button>
          </div>

          {/* Status badge + progress */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
              {cfg.label}
            </div>
            <span className="text-xs font-bold" style={{ color: cfg.color }}>{progress}%</span>
          </div>

          {/* Progress bar */}
          <div className="mt-2">
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1e1e2e" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: `linear-gradient(to right, ${cfg.color}, ${cfg.color}88)` }}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px]" style={{ color: "#374151" }}>{fmt12(bus?.departure_time)}</span>
              <span className="text-[10px]" style={{ color: "#374151" }}>{fmt12(bus?.arrival_time)}</span>
            </div>
          </div>
        </div>

        {/* ══ TIMELINE ══ */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "none" }}>
          {loading ? (
            <div className="flex flex-col gap-5 mt-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-4 animate-pulse">
                  <div className="flex flex-col items-center pt-1 w-5 shrink-0">
                    <div className="w-4 h-4 rounded-full" style={{ background: "#1e1e2e" }} />
                    <div className="w-0.5 h-14 mt-1" style={{ background: "#1e1e2e" }} />
                  </div>
                  <div className="flex-1">
                    <div className="h-4 rounded-lg w-36" style={{ background: "#1e1e2e" }} />
                    <div className="h-3 rounded-lg w-20 mt-2" style={{ background: "#1e1e2e" }} />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="h-3 rounded w-16" style={{ background: "#1e1e2e" }} />
                    <div className="h-3 rounded w-16" style={{ background: "#1e1e2e" }} />
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
                const showLiveTime = !isCurrent ? s.liveTime !== s.estTime : true;

                return (
                  <motion.div
                    key={s.stop_id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: vi * 0.04, duration: 0.3 }}
                  >
                    {/* Current stop: glowing card bg */}
                    <div
                      className="flex items-stretch gap-3 relative"
                      style={isCurrent ? {
                        background: "linear-gradient(135deg, #0d1a3a 0%, #111827 100%)",
                        borderRadius: 16,
                        border: "1px solid #1e3a5f",
                        padding: "12px 12px",
                        margin: "4px -4px",
                        boxShadow: "0 0 20px #3b82f620",
                      } : { padding: "0 4px" }}
                    >
                      {/* ── Timeline node + line ── */}
                      <div className="flex flex-col items-center shrink-0" style={{ width: 24 }}>
                        {/* top connector line */}
                        {!isFirst && (
                          <div
                            style={{
                              width: 2,
                              height: isCurrent ? 14 : 18,
                              background: isPast
                                ? `linear-gradient(to bottom, ${cfg.color}, ${cfg.color})`
                                : isCurrent
                                ? `linear-gradient(to bottom, ${cfg.color}60, #3b82f6)`
                                : "#1e2a3e",
                              borderRadius: 2,
                              marginBottom: 2,
                            }}
                          />
                        )}

                        {/* Node */}
                        {isCurrent ? (
                          <motion.div
                            animate={{ boxShadow: [
                              `0 0 0px ${cfg.color}00`,
                              `0 0 16px ${cfg.color}80`,
                              `0 0 0px ${cfg.color}00`,
                            ]}}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={{
                              background: `linear-gradient(135deg, #1d4ed8, #3b82f6)`,
                              border: `3px solid #60a5fa40`,
                            }}
                          >
                            <Bus className="w-4 h-4 text-white" />
                          </motion.div>
                        ) : isPast ? (
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                            style={{
                              background: cfg.color + "22",
                              border: `2px solid ${cfg.color}66`,
                            }}
                          >
                            <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5l2.5 2.5L8 3" stroke={cfg.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full shrink-0"
                            style={{
                              background: "transparent",
                              border: `2px solid ${isFirst || isLast ? "#4b5563" : "#2d3748"}`,
                            }}
                          />
                        )}

                        {/* bottom connector line */}
                        {!isLastVisible && (
                          <div
                            style={{
                              width: 2,
                              flex: 1,
                              minHeight: isCurrent ? 14 : 36,
                              background: isPast
                                ? cfg.color
                                : isCurrent
                                ? `linear-gradient(to bottom, #3b82f6, #1e2a3e)`
                                : "#1e2a3e",
                              borderRadius: 2,
                              marginTop: 2,
                            }}
                          />
                        )}
                      </div>

                      {/* ── Stop info ── */}
                      <div className="flex-1 min-w-0 flex items-center gap-2" style={{ paddingTop: isFirst ? 0 : 0 }}>
                        <div className="flex-1 min-w-0 py-0.5">
                          {/* Stop name */}
                          <p
                            className={`font-bold leading-tight ${isCurrent ? "text-base" : "text-sm"}`}
                            style={{
                              color: isCurrent ? "#ffffff" : isPast ? "#4b5563" : "#d1d5db",
                            }}
                          >
                            {s.name}
                          </p>

                          {/* Labels */}
                          {(isFirst || isLast) && (
                            <span
                              className="text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: isFirst ? "#818cf8" : "#f472b6" }}
                            >
                              {isFirst ? "Start Point" : "End Point"}
                            </span>
                          )}
                          {isCurrent && (
                            <motion.div
                              animate={{ opacity: [1, 0.5, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                              className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs font-bold"
                              style={{ background: "#1d4ed820", border: "1px solid #3b82f640", color: "#60a5fa" }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                              Current Stop
                            </motion.div>
                          )}
                        </div>

                        {/* ── Timings: scheduled (white) + live (red) ── */}
                        <div className="shrink-0 flex flex-col items-end gap-0.5">
                          <span
                            className="text-xs font-mono font-medium"
                            style={{ color: isCurrent ? "#e5e7eb" : isPast ? "#374151" : "#9ca3af" }}
                          >
                            {s.estTime}
                          </span>
                          {(isCurrent || showLiveTime) && (
                            <span
                              className="text-xs font-mono font-bold"
                              style={{ color: isCurrent ? "#ef4444" : isPast ? "#374151" : "#ef4444" }}
                            >
                              {s.liveTime}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* "Show more stops" pill */}
                    {shouldCollapse && vi === visibleStops.length - 2 && hiddenCount > 0 && (
                      <div className="flex items-center gap-3 ml-7 my-1">
                        <button
                          onClick={() => setExpanded(true)}
                          className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-full"
                          style={{ background: "#141420", color: "#818cf8", border: "1px solid #2d2d4e" }}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                          Show {hiddenCount} intermediate stop{hiddenCount !== 1 ? "s" : ""}
                        </button>
                      </div>
                    )}
                    {expanded && isLast && (
                      <div className="flex items-center gap-3 ml-7 my-1">
                        <button
                          onClick={() => setExpanded(false)}
                          className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-full"
                          style={{ background: "#141420", color: "#818cf8", border: "1px solid #2d2d4e" }}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                          Show less
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}

          {/* ── Community Reports section ── */}
          {!loading && (
            <div className="mt-4" style={{ borderTop: "1px solid #15152a" }}>
              <CommunityUpdates busId={initialBus.bus_id} />
            </div>
          )}

          <div className="h-24" />
        </div>

        {/* ══ FLOATING BOTTOM STATUS BAR (like reference image) ══ */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-5 pointer-events-none">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, type: "spring", damping: 24, stiffness: 280 }}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl pointer-events-auto"
            style={{
              background: "#0d0d1a",
              border: "1px solid #1e1e2e",
              boxShadow: "0 8px 32px #00000088",
            }}
          >
            {/* Status dot + text */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: isFresh ? "#22c55e" : "#374151" }}
                  animate={isFresh ? { scale: [1, 1.4, 1] } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <p className="text-sm font-semibold text-white truncate">
                  {currentStop
                    ? `Bus is at ${currentStop.name}`
                    : bus?.name || "Tracking bus…"}
                </p>
              </div>
              <p className="text-xs mt-0.5 ml-4.5" style={{ color: "#4b5563" }}>
                {lastSyncedAt ? `Updated ${fmtRelative(secondsAgo)}` : "Connecting to live feed…"}
              </p>
            </div>

            {/* Refresh button */}
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => fetchDetails(true)}
              disabled={isRefreshing}
              className="w-11 h-11 flex items-center justify-center rounded-full shrink-0 transition-opacity disabled:opacity-50"
              style={{ background: "#1a2040", border: "1px solid #2d2d4e" }}
            >
              <motion.div
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={isRefreshing
                  ? { duration: 0.7, repeat: Infinity, ease: "linear" }
                  : { duration: 0.3 }}
              >
                <RefreshCw className="w-4.5 h-4.5" style={{ color: justRefreshed ? "#22c55e" : "#9ca3af" }} />
              </motion.div>
            </motion.button>
          </motion.div>
        </div>
      </motion.div>

      {/* ══ MODALS ══ */}
      <AnimatePresence>
        {showInsideBus && (
          <InsideBusModal
            stops={stops}
            busId={initialBus.bus_id}
            currentIdx={currentIdx}
            onClose={() => setShowInsideBus(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNotifications && (
          <NotificationsModal
            busName={bus?.name}
            busNumber={bus?.number}
            subscribed={subscribed}
            onToggle={toggleSubscription}
            onClose={() => setShowNotifications(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
