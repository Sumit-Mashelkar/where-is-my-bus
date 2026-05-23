import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ThumbsUp, ThumbsDown, CheckCircle2, Clock,
  Bus, MapPin, ChevronRight, RefreshCw, Loader2,
  Sparkles, AlertCircle, Radio,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { getUserId } from "@/lib/userId";
import { socket } from "@/lib/socket";
import { toast } from "sonner";

/* ─── helpers ─── */
function timeAgo(iso) {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.max(0, Math.floor(d))}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const STATUS_CFG = {
  pending:  { label: "Pending",  color: "#eab308", bg: "#1f1a07", border: "#713f12", Icon: Clock },
  verified: { label: "Verified", color: "#22c55e", bg: "#0d2a1a", border: "#166534", Icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "#ef4444", bg: "#1f0d0d", border: "#7f1d1d", Icon: AlertCircle },
};

/* ─── Route proposal card ─── */
function RouteCard({ route, userId, onVoted }) {
  const [voting, setVoting] = useState(false);
  const [data, setData]     = useState(route);
  const cfg = STATUS_CFG[data.status] || STATUS_CFG.pending;
  const total = data.upvotes + data.downvotes;
  const pct   = total > 0 ? Math.round((data.upvotes / total) * 100) : 50;

  const vote = async (v) => {
    if (voting || data.user_vote) return;
    if (data.submitted_by === userId) {
      toast.error("Can't vote on your own proposal"); return;
    }
    setVoting(true);
    try {
      const r = await post(`/routes/pending/${data.route_id}/vote`, { user_id: userId, vote: v });
      setData(r);
      onVoted?.(r);
      if (r.status === "verified") {
        toast.success(`Route ${r.bus_number} verified! It's now live on the map 🎉`);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail === "already_voted") toast.error("You already voted");
      else toast.error(detail || "Vote failed");
    }
    setVoting(false);
  };

  // update from socket
  useEffect(() => {
    const handler = (r) => { if (r.route_id === data.route_id) setData(r); };
    socket.on("route_voted", handler);
    socket.on("route_verified", (r) => {
      if (r.route_id === data.route_id) setData((prev) => ({ ...prev, status: "verified" }));
    });
    return () => { socket.off("route_voted", handler); };
  }, [data.route_id]);

  const stops = data.stops || [];
  const origin = stops[0]?.name || "—";
  const dest   = stops[stops.length - 1]?.name || "—";

  const isOwn     = data.submitted_by === userId;
  const hasVoted  = !!data.user_vote;
  const votedUp   = data.user_vote === "up";
  const votedDown = data.user_vote === "down";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "#0f0f1a", border: "1px solid #1e1e2e" }}
    >
      {/* Top row */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl font-black text-sm"
              style={{ background: "#141420", color: cfg.color, border: `1px solid ${cfg.border}` }}
            >
              {data.bus_number}
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">{data.bus_name}</p>
              {data.direction && (
                <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{data.direction}</p>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
          >
            <cfg.Icon className="w-3 h-3" style={{ color: cfg.color }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
        </div>

        {/* Route preview */}
        <div className="flex items-center gap-1.5 mt-3 text-xs overflow-hidden">
          <span
            className="shrink-0 max-w-[38%] truncate px-2 py-0.5 rounded-lg font-medium"
            style={{ background: "#818cf833", color: "#818cf8" }}
          >
            {origin}
          </span>
          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "#374151" }} />
          {stops.length > 2 && (
            <>
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-lg"
                style={{ background: "#1a1a2e", color: "#4b5563" }}>
                +{stops.length - 2} stops
              </span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: "#374151" }} />
            </>
          )}
          <span
            className="shrink-0 max-w-[38%] truncate px-2 py-0.5 rounded-lg font-medium"
            style={{ background: "#f472b633", color: "#f472b6" }}
          >
            {dest}
          </span>
        </div>

        {/* Stops list (collapsed) */}
        {stops.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {stops.slice(1, -1).map((s, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "#1a1a2e", color: "#4b5563" }}>
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Confidence bar */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span style={{ color: "#4b5563" }}>Community approval</span>
          <span style={{ color: total > 0 ? cfg.color : "#374151" }}>{total > 0 ? `${pct}%` : "No votes yet"}</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1a1a2e" }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: cfg.color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        {data.status === "pending" && (
          <p className="text-[10px] mt-1.5" style={{ color: "#374151" }}>
            Needs {Math.max(0, 3 - data.upvotes)} more confirms at 70%+ approval to go live
          </p>
        )}
      </div>

      {/* Vote row — full width, prominent */}
      {data.status === "pending" && !isOwn && (
        <div className="px-4 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#374151" }}>
            {hasVoted ? "Your vote is recorded" : "Does this route look correct?"}
          </p>
          <div className="flex gap-3">
            <motion.button
              onClick={() => vote("up")}
              disabled={hasVoted || voting}
              whileTap={{ scale: 0.95 }}
              className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-bold text-sm disabled:opacity-60"
              style={{
                background: votedUp ? "#0d2a1a" : "#141420",
                border: `2px solid ${votedUp ? "#22c55e" : "#1e1e2e"}`,
                color: votedUp ? "#22c55e" : "#6b7280",
              }}
            >
              {voting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ThumbsUp className="w-5 h-5" />
              )}
              <span>Confirm</span>
              {data.upvotes > 0 && (
                <span
                  className="text-xs font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                  style={{ background: votedUp ? "#22c55e33" : "#1a1a2e", color: votedUp ? "#22c55e" : "#4b5563" }}
                >
                  {data.upvotes}
                </span>
              )}
            </motion.button>

            <motion.button
              onClick={() => vote("down")}
              disabled={hasVoted || voting}
              whileTap={{ scale: 0.95 }}
              className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-bold text-sm disabled:opacity-60"
              style={{
                background: votedDown ? "#1f0d0d" : "#141420",
                border: `2px solid ${votedDown ? "#ef4444" : "#1e1e2e"}`,
                color: votedDown ? "#ef4444" : "#6b7280",
              }}
            >
              <ThumbsDown className="w-5 h-5" />
              <span>Dispute</span>
              {data.downvotes > 0 && (
                <span
                  className="text-xs font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                  style={{ background: votedDown ? "#ef444433" : "#1a1a2e", color: votedDown ? "#ef4444" : "#4b5563" }}
                >
                  {data.downvotes}
                </span>
              )}
            </motion.button>
          </div>
        </div>
      )}

      {/* Footer: meta line */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderTop: "1px solid #141420", background: "#0a0a0f" }}
      >
        <div className="text-xs" style={{ color: "#374151" }}>
          <span style={{ color: "#4b5563" }}>{isOwn ? "Your proposal" : `by ${data.submitted_by.slice(0, 8)}…`}</span>
          <span className="ml-1.5">· {timeAgo(data.created_at)}</span>
        </div>

        {data.status === "verified" && (
          <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "#22c55e" }}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Live on map</span>
          </div>
        )}

        {data.status === "pending" && isOwn && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "#6b7280" }}>
            <Clock className="w-3.5 h-3.5" />
            <span>Awaiting community votes</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════ */
export default function UpdatesTab({ open, onClose }) {
  const userId = getUserId();
  const [tab, setTab]         = useState("pending");
  const [routes, setRoutes]   = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get(`/routes/pending?user_id=${encodeURIComponent(userId)}`);
      setRoutes(data);
    } catch {
      toast.error("Could not load community updates");
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  /* live socket updates */
  useEffect(() => {
    const onProposed = (r) => setRoutes((prev) => [{ ...r, user_vote: null }, ...prev]);
    const onVoted    = (r) => setRoutes((prev) => prev.map((x) => x.route_id === r.route_id ? r : x));
    const onVerified = (r) => setRoutes((prev) => prev.map((x) => x.route_id === r.route_id ? { ...x, status: "verified" } : x));
    socket.on("route_proposed", onProposed);
    socket.on("route_voted",    onVoted);
    socket.on("route_verified", onVerified);
    return () => {
      socket.off("route_proposed", onProposed);
      socket.off("route_voted",    onVoted);
      socket.off("route_verified", onVerified);
    };
  }, []);

  /* lock scroll */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const filtered = routes.filter((r) =>
    tab === "pending"  ? r.status === "pending"  :
    tab === "verified" ? r.status === "verified" :
    r.status === "rejected"
  );

  const pendingCount = routes.filter((r) => r.status === "pending").length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="updates-tab"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="fixed inset-0 z-[50] flex flex-col"
          style={{ background: "#0A0A0F" }}
        >
          {/* Header */}
          <div
            className="shrink-0 px-5 pt-safe-top"
            style={{
              background: "#0f0f1a",
              borderBottom: "1px solid #1e1e2e",
              paddingTop: "max(env(safe-area-inset-top), 12px)",
            }}
          >
            <div className="flex items-center justify-between gap-3 pb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-full"
                  style={{ background: "#1a1a2e" }}
                >
                  <ArrowLeft className="w-4 h-4" style={{ color: "#9ca3af" }} />
                </button>
                <div>
                  <p className="text-white font-bold text-lg leading-tight">Community Updates</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Radio className="w-2.5 h-2.5" style={{ color: "#22c55e" }} />
                    <p className="text-xs" style={{ color: "#6b7280" }}>
                      Live · {routes.length} proposal{routes.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={load}
                className="w-9 h-9 flex items-center justify-center rounded-full"
                style={{ background: "#1a1a2e" }}
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#818cf8" }} />
                  : <RefreshCw className="w-4 h-4" style={{ color: "#6b7280" }} />}
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 pb-4">
              {[
                { id: "pending",  label: "Pending",  count: routes.filter((r) => r.status === "pending").length },
                { id: "verified", label: "Verified", count: routes.filter((r) => r.status === "verified").length },
              ].map(({ id, label, count }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
                  style={tab === id
                    ? { background: "#1a1a2e", color: "#e5e7eb", border: "1px solid #2d2d4e" }
                    : { background: "transparent", color: "#4b5563", border: "1px solid transparent" }}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className="text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                      style={tab === id
                        ? { background: "#818cf8", color: "#000" }
                        : { background: "#1a1a2e", color: "#4b5563" }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
            {loading && routes.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#2d2d4e" }} />
                <p className="text-sm" style={{ color: "#374151" }}>Loading proposals…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20">
                {tab === "pending" ? (
                  <>
                    <Sparkles className="w-10 h-10" style={{ color: "#1e1e2e" }} />
                    <p className="text-sm font-bold" style={{ color: "#374151" }}>No pending proposals</p>
                    <p className="text-xs text-center max-w-[240px]" style={{ color: "#1e1e2e" }}>
                      Add a route using the sidebar and it will appear here for community review.
                    </p>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-10 h-10" style={{ color: "#1e1e2e" }} />
                    <p className="text-sm font-bold" style={{ color: "#374151" }}>No verified routes yet</p>
                    <p className="text-xs text-center max-w-[240px]" style={{ color: "#1e1e2e" }}>
                      Routes get verified once 3 community members confirm them with 70%+ approval.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {filtered.map((r) => (
                    <RouteCard
                      key={r.route_id}
                      route={r}
                      userId={userId}
                      onVoted={(updated) =>
                        setRoutes((prev) => prev.map((x) => x.route_id === updated.route_id ? updated : x))
                      }
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
