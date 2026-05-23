import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, MapPin, CheckCircle2, Clock, Navigation,
  AlertTriangle, Users, LocateFixed, Loader2,
  ChevronRight, ArrowRight, Shield, Star,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { getUserId } from "@/lib/userId";
import { socket } from "@/lib/socket";
import { toast } from "sonner";

/* ── haversine (km) ── */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R   = 6371;
  const dl  = ((lat2 - lat1) * Math.PI) / 180;
  const dlg = ((lng2 - lng1) * Math.PI) / 180;
  const a   =
    Math.sin(dl / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dlg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ── status quick-actions ── */
const ACTIONS = [
  { id: "running",      apiStatus: "running",  label: "Running",       sub: "On time",        Icon: CheckCircle2, color: "#22c55e", bg: "#0d2a1a", border: "#166534" },
  { id: "delayed",      apiStatus: "delayed",  label: "Delayed",       sub: "Running late",   Icon: Clock,        color: "#eab308", bg: "#1f1a07", border: "#713f12" },
  { id: "arriving",     apiStatus: "arriving", label: "At Stop",       sub: "Reached stop",   Icon: MapPin,       color: "#3b82f6", bg: "#0d1a2e", border: "#1e3a5f" },
  { id: "departed",     apiStatus: "running",  label: "Departed",      sub: "Just left stop", Icon: Navigation,   color: "#8b5cf6", bg: "#130d2a", border: "#3b1f87" },
  { id: "heavy_traffic",apiStatus: "delayed",  label: "Heavy Traffic", sub: "Slow movement",  Icon: AlertTriangle,color: "#f97316", bg: "#1f1007", border: "#7c3000" },
  { id: "bus_full",     apiStatus: "bus_full", label: "Bus Full",      sub: "No seats left",  Icon: Users,        color: "#ef4444", bg: "#1f0d0d", border: "#7f1d1d" },
];

const BADGE_COLORS = {
  "Trusted Commuter":  { color: "#22c55e", bg: "#0d2a1a", border: "#166534", Icon: Shield },
  "Verified Commuter": { color: "#3b82f6", bg: "#0d1a2e", border: "#1e3a5f", Icon: CheckCircle2 },
  "Frequent Reporter": { color: "#8b5cf6", bg: "#130d2a", border: "#3b1f87", Icon: Star },
  "New Rider":         { color: "#4b5563", bg: "#111118", border: "#1e1e2e", Icon: Users },
};

/* ══════════════════════════════════════════════════════════════ */
export default function UpdateLocationDialog({ open, onClose, bus, onUpdated }) {
  const userId = getUserId();

  const [stops, setStops]             = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [actionId, setActionId]       = useState("running");
  const [stopSearch, setStopSearch]   = useState("");
  const [fetchingStops, setFetchingStops] = useState(false);
  const [gpsLoading, setGpsLoading]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [gpsHint, setGpsHint]         = useState(null);
  const [reputation, setReputation]   = useState(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [rateLimitSecs, setRateLimitSecs] = useState(0);

  /* lock body scroll */
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  /* load stops + reputation on open */
  useEffect(() => {
    if (!bus || !open) return;
    setStopSearch("");
    setGpsHint(null);
    setRateLimited(false);
    setFetchingStops(true);

    Promise.all([
      get(`/buses/${bus.bus_id}`),
      get(`/users/${encodeURIComponent(userId)}/reputation`).catch(() => null),
    ]).then(([d, rep]) => {
      setStops(d.stops || []);
      setSelectedIdx(d.current_stop_index ?? 0);
      setActionId("running");
      setReputation(rep);
    }).catch(() => toast.error("Could not load route"))
      .finally(() => setFetchingStops(false));
  }, [bus, open, userId]);

  /* countdown timer when rate-limited */
  useEffect(() => {
    if (!rateLimited) return;
    setRateLimitSecs(60);
    const id = setInterval(() => {
      setRateLimitSecs((s) => {
        if (s <= 1) { setRateLimited(false); clearInterval(id); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimited]);

  /* detect nearest stop via GPS */
  const detectStop = useCallback(() => {
    if (!navigator.geolocation) return toast.error("Geolocation not supported");
    if (stops.length === 0) return;
    setGpsLoading(true);
    setGpsHint(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let best = { idx: 0, dist: Infinity };
        stops.forEach((s, i) => {
          const d = haversineKm(lat, lng, s.lat, s.lng);
          if (d < best.dist) best = { idx: i, dist: d };
        });
        setSelectedIdx(best.idx);
        setGpsHint(`Nearest: ${stops[best.idx]?.name} (${(best.dist * 1000).toFixed(0)} m)`);
        setGpsLoading(false);
      },
      () => { toast.error("Could not get your location"); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [stops]);

  const submit = async () => {
    if (!bus || rateLimited) return;
    const action = ACTIONS.find((a) => a.id === actionId);
    setSubmitting(true);
    try {
      const r = await post(`/buses/${bus.bus_id}/status-update`, {
        stop_index: selectedIdx,
        status:     action.apiStatus,
        user_id:    userId,
      });
      if (r.merged) {
        toast.success(`Merged with existing report — boosts confidence for ${bus.number}`);
      } else {
        toast.success(`${bus.number} update submitted for community verification`);
      }
      onUpdated?.(r);
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail === "rate_limited") {
        setRateLimited(true);
        toast.error("Please wait 60 seconds before submitting another update");
      } else {
        toast.error(e?.response?.data?.message || "Update failed");
      }
    }
    setSubmitting(false);
  };

  /* derived */
  const action      = ACTIONS.find((a) => a.id === actionId);
  const prevStop    = stops[selectedIdx - 1];
  const currStop    = stops[selectedIdx];
  const nextStop    = stops[selectedIdx + 1];
  const filteredStops = stopSearch.trim()
    ? stops.filter((s) => s.name.toLowerCase().includes(stopSearch.trim().toLowerCase()))
    : stops;

  const badgeCfg = reputation ? (BADGE_COLORS[reputation.badge] || BADGE_COLORS["New Rider"]) : null;
  const BadgeIcon = badgeCfg?.Icon || Users;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[60]"
            style={{ background: "rgba(0,0,0,0.72)" }}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-[61] flex flex-col rounded-t-3xl"
            style={{
              background: "#0f0f1a",
              maxHeight: "92dvh",
              boxShadow: "0 -8px 48px rgba(0,0,0,0.6)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "#2d2d4e" }} />
            </div>

            {/* Header */}
            <div className="shrink-0 px-5 pb-4 pt-2" style={{ borderBottom: "1px solid #1e1e2e" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="shrink-0 text-sm font-black px-2.5 py-1 rounded-lg"
                    style={{
                      background: (action?.color ?? "#22c55e") + "22",
                      color: action?.color ?? "#22c55e",
                      border: `1px solid ${(action?.color ?? "#22c55e")}44`,
                    }}
                  >
                    {bus?.number}
                  </span>
                  <div className="min-w-0">
                    <p className="text-white font-bold text-base leading-tight truncate">{bus?.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
                      Crowd-sourced · community verified
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full"
                  style={{ background: "#1a1a2e" }}
                >
                  <X className="w-4 h-4" style={{ color: "#6b7280" }} />
                </button>
              </div>

              {/* Reputation badge */}
              {reputation && badgeCfg && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 rounded-xl w-fit"
                  style={{ background: badgeCfg.bg, border: `1px solid ${badgeCfg.border}` }}
                >
                  <BadgeIcon className="w-3 h-3" style={{ color: badgeCfg.color }} />
                  <span className="text-xs font-bold" style={{ color: badgeCfg.color }}>
                    {reputation.badge}
                  </span>
                  <span className="text-xs" style={{ color: badgeCfg.color + "88" }}>
                    · {reputation.trust_points} pts
                  </span>
                </motion.div>
              )}
            </div>

            {/* Rate-limited banner */}
            <AnimatePresence>
              {rateLimited && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="shrink-0 px-5 py-3 flex items-center gap-2"
                  style={{ background: "#1f1a07", borderBottom: "1px solid #713f12" }}
                >
                  <Clock className="w-4 h-4 shrink-0" style={{ color: "#eab308" }} />
                  <p className="text-sm font-medium" style={{ color: "#eab308" }}>
                    Rate limited — wait {rateLimitSecs}s before next update
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto no-scrollbar">

              {/* ── Stop selector ── */}
              <div className="px-5 pt-5 pb-3">
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#4b5563" }}>
                  Where is the bus right now?
                </p>

                {/* GPS detect */}
                <button
                  onClick={detectStop}
                  disabled={gpsLoading || fetchingStops}
                  className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl mb-3 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: "#1a1a2e", border: "1px solid #2d2d4e" }}
                >
                  {gpsLoading
                    ? <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: "#818cf8" }} />
                    : <LocateFixed className="w-4 h-4 shrink-0" style={{ color: "#818cf8" }} />}
                  <span className="text-sm font-medium" style={{ color: "#c4b5fd" }}>
                    {gpsLoading ? "Detecting nearest stop…" : "Use my location"}
                  </span>
                </button>

                <AnimatePresence>
                  {gpsHint && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-xs mb-3 flex items-center gap-1.5"
                      style={{ color: "#22c55e" }}
                    >
                      <CheckCircle2 className="w-3 h-3" /> {gpsHint}
                    </motion.p>
                  )}
                </AnimatePresence>

                {stops.length > 4 && (
                  <input
                    value={stopSearch}
                    onChange={(e) => setStopSearch(e.target.value)}
                    placeholder="Search stops…"
                    className="w-full text-sm px-4 py-2.5 rounded-xl outline-none mb-3"
                    style={{ background: "#1a1a2e", border: "1px solid #2d2d4e", color: "#e5e7eb" }}
                  />
                )}

                {/* Stop list */}
                {fetchingStops ? (
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: "#1a1a2e" }} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredStops.map((s) => {
                      const realIdx   = stops.findIndex((x) => x.stop_id === s.stop_id);
                      const isSel     = realIdx === selectedIdx;
                      const isPast    = realIdx < selectedIdx;
                      const isFirst   = realIdx === 0;
                      const isLast    = realIdx === stops.length - 1;
                      return (
                        <motion.button
                          key={s.stop_id}
                          onClick={() => { setSelectedIdx(realIdx); setStopSearch(""); }}
                          whileTap={{ scale: 0.97 }}
                          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
                          style={{
                            background: isSel ? (action?.color ?? "#22c55e") + "22" : "#141420",
                            border: `1.5px solid ${isSel ? (action?.color ?? "#22c55e") + "66" : "#1e1e2e"}`,
                          }}
                        >
                          <div
                            className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full"
                            style={{
                              background: isSel ? (action?.color ?? "#22c55e") + "33" : "#1a1a2e",
                              border: `2px solid ${isSel ? (action?.color ?? "#22c55e") : isPast ? "#374151" : "#2d2d4e"}`,
                            }}
                          >
                            {isSel ? (
                              <motion.div
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ background: action?.color ?? "#22c55e" }}
                                animate={{ scale: [1, 1.3, 1] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                              />
                            ) : isPast ? (
                              <svg className="w-3.5 h-3.5" viewBox="0 0 10 10" fill="none">
                                <path d="M2 5l2.5 2.5L8 3" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <div className="w-2 h-2 rounded-full" style={{ background: "#374151" }} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate"
                              style={{ color: isSel ? (action?.color ?? "#22c55e") : isPast ? "#4b5563" : "#e5e7eb" }}>
                              {s.name}
                            </p>
                            {(isFirst || isLast) && (
                              <span className="text-[10px] font-bold uppercase tracking-widest"
                                style={{ color: isFirst ? "#818cf8" : "#f472b6" }}>
                                {isFirst ? "Origin" : "Destination"}
                              </span>
                            )}
                            {isSel && (
                              <p className="text-xs mt-0.5" style={{ color: action?.color ?? "#22c55e" }}>Bus is here</p>
                            )}
                          </div>
                          {isSel && <CheckCircle2 className="shrink-0 w-4 h-4" style={{ color: action?.color ?? "#22c55e" }} />}
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Route breadcrumb */}
              {currStop && (
                <div className="mx-5 mb-4 px-4 py-3 rounded-2xl flex items-center gap-1.5 text-xs overflow-hidden"
                  style={{ background: "#141420", border: "1px solid #1e1e2e" }}>
                  {prevStop
                    ? <span className="truncate max-w-[28%]" style={{ color: "#4b5563" }}>{prevStop.name}</span>
                    : <span style={{ color: "#1e1e2e" }}>—</span>}
                  <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "#374151" }} />
                  <span className="font-bold shrink-0 px-1.5 py-0.5 rounded-lg text-xs"
                    style={{ background: (action?.color ?? "#22c55e") + "22", color: action?.color ?? "#22c55e" }}>
                    {currStop.name}
                  </span>
                  <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "#374151" }} />
                  {nextStop
                    ? <span className="truncate max-w-[28%]" style={{ color: "#4b5563" }}>{nextStop.name}</span>
                    : <span style={{ color: "#1e1e2e" }}>—</span>}
                </div>
              )}

              {/* ── Status quick-actions ── */}
              <div className="px-5 pb-5">
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#4b5563" }}>
                  What's happening?
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {ACTIONS.map((a) => {
                    const isSel = actionId === a.id;
                    return (
                      <motion.button
                        key={a.id}
                        onClick={() => setActionId(a.id)}
                        whileTap={{ scale: 0.95 }}
                        className="flex flex-col items-start gap-1.5 px-4 py-3.5 rounded-2xl text-left"
                        style={{
                          background: isSel ? a.bg : "#141420",
                          border: `1.5px solid ${isSel ? a.color + "66" : "#1e1e2e"}`,
                        }}
                      >
                        <div className="flex items-center justify-between w-full">
                          <a.Icon className="w-4 h-4" style={{ color: isSel ? a.color : "#4b5563" }} />
                          {isSel && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="w-2 h-2 rounded-full"
                              style={{ background: a.color }}
                            />
                          )}
                        </div>
                        <p className="text-sm font-bold leading-tight"
                          style={{ color: isSel ? a.color : "#9ca3af" }}>{a.label}</p>
                        <p className="text-[11px] leading-tight"
                          style={{ color: isSel ? a.color + "aa" : "#374151" }}>{a.sub}</p>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Verification info */}
                <div className="flex items-start gap-2 mt-4 px-3 py-3 rounded-xl"
                  style={{ background: "#111118", border: "1px solid #1e1e2e" }}>
                  <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#6b7280" }} />
                  <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
                    Your report starts as <span style={{ color: "#9ca3af" }}>Unverified</span>.
                    When 3+ passengers confirm it with 70%+ agreement, it becomes{" "}
                    <span style={{ color: "#22c55e" }}>Community Confirmed</span> and you earn trust points.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-5 py-4" style={{ background: "#0d0d17", borderTop: "1px solid #1e1e2e" }}>
              {currStop && action && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl"
                  style={{ background: action.bg, border: `1px solid ${action.border}` }}>
                  <action.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: action.color }} />
                  <p className="text-xs font-medium flex-1 truncate" style={{ color: action.color }}>
                    {action.label} · {currStop.name}
                    {nextStop && <span style={{ color: action.color + "88" }}> → {nextStop.name}</span>}
                  </p>
                </div>
              )}

              <motion.button
                onClick={submit}
                disabled={submitting || fetchingStops || rateLimited}
                whileTap={{ scale: 0.97 }}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-sm disabled:opacity-60"
                style={{ background: rateLimited ? "#1f1a07" : (action?.color ?? "#22c55e"), color: rateLimited ? "#eab308" : "#000" }}
              >
                {submitting
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : rateLimited
                    ? <Clock className="w-4 h-4" />
                    : <ArrowRight className="w-4 h-4" />}
                {submitting
                  ? "Submitting…"
                  : rateLimited
                    ? `Wait ${rateLimitSecs}s`
                    : "Submit for Community Verification"}
              </motion.button>
              <p className="text-center text-xs mt-2" style={{ color: "#374151" }}>
                Updates are verified by fellow passengers
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
