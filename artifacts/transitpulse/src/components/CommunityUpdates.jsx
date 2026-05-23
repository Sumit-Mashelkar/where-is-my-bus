import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ThumbsUp, ThumbsDown, ShieldCheck, Clock, Users,
  ChevronDown, ChevronUp, AlertCircle, Sparkles,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { getUserId } from "@/lib/userId";
import { socket } from "@/lib/socket";
import { toast } from "sonner";

/* ── constants ── */
const STATUS_LABELS = {
  running:  "On Time",
  delayed:  "Delayed",
  arriving: "At Stop",
  bus_full: "Bus Full",
  cancelled:"Cancelled",
};

const CONF_CONFIG = {
  high:   { color: "#22c55e", bg: "#0d2a1a", border: "#166534", label: "High Confidence" },
  medium: { color: "#eab308", bg: "#1f1a07", border: "#713f12", label: "Med Confidence"  },
  low:    { color: "#ef4444", bg: "#1f0d0d", border: "#7f1d1d", label: "Low Confidence"  },
};

/* ── time formatter ── */
function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5)   return "just now";
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ── single update card ── */
function UpdateCard({ upd, onVote, currentUserId }) {
  const conf    = CONF_CONFIG[upd.confidence_label] || CONF_CONFIG.low;
  const isOwn   = upd.is_own || upd.reported_by === currentUserId;
  const hasVoted = upd.user_vote !== null && upd.user_vote !== undefined;
  const total   = upd.confirmations + upd.rejections;
  const pct     = total > 0 ? Math.round((upd.confirmations / total) * 100) : 50;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "#141420", border: `1px solid ${upd.verified ? "#22c55e33" : "#1e1e2e"}` }}
    >
      {/* Top bar: verified / confidence */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2 gap-2">
        {upd.verified ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ background: "#0d2a1a", color: "#22c55e", border: "1px solid #166534" }}>
            <ShieldCheck className="w-3 h-3" />
            Community Confirmed
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ background: "#111118", color: "#6b7280", border: "1px solid #1e1e2e" }}>
            <AlertCircle className="w-3 h-3" />
            Unverified
          </div>
        )}

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium shrink-0"
          style={{ background: conf.bg, color: conf.color, border: `1px solid ${conf.border}` }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: conf.color }} />
          {conf.label}
        </div>
      </div>

      {/* Body */}
      <div className="px-3.5 pb-2">
        <p className="text-sm font-bold text-white leading-tight">
          {STATUS_LABELS[upd.status] || upd.status}
          <span className="font-normal" style={{ color: "#9ca3af" }}> · {upd.stop_name}</span>
        </p>

        {/* Confidence bar */}
        <div className="mt-2 mb-1.5">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1e1e2e" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: conf.color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "#4b5563" }}>
          <Users className="w-3 h-3 shrink-0" />
          <span>
            {upd.confirmations + upd.rejections > 0
              ? `${upd.confirmations + upd.rejections} passenger${upd.confirmations + upd.rejections !== 1 ? "s" : ""} responded`
              : "No votes yet"}
          </span>
          <span>·</span>
          <Clock className="w-3 h-3 shrink-0" />
          <span>{timeAgo(upd.created_at)}</span>
          {upd.verified && upd.verified_at && (
            <>
              <span>·</span>
              <span style={{ color: "#22c55e" }}>verified {timeAgo(upd.verified_at)}</span>
            </>
          )}
        </div>
      </div>

      {/* Vote row */}
      <div className="flex items-center gap-2 px-3.5 pb-3">
        {isOwn ? (
          <p className="text-xs italic" style={{ color: "#374151" }}>Your report · awaiting community votes</p>
        ) : hasVoted ? (
          <div className="flex items-center gap-2 flex-1">
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => {}}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{
                background: upd.user_vote === "confirm" ? "#0d2a1a" : "#141420",
                border: `1.5px solid ${upd.user_vote === "confirm" ? "#22c55e" : "#1e1e2e"}`,
                color: upd.user_vote === "confirm" ? "#22c55e" : "#374151",
                cursor: "default",
              }}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              {upd.confirmations}
            </motion.button>
            <motion.button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{
                background: upd.user_vote === "reject" ? "#1f0d0d" : "#141420",
                border: `1.5px solid ${upd.user_vote === "reject" ? "#ef4444" : "#1e1e2e"}`,
                color: upd.user_vote === "reject" ? "#ef4444" : "#374151",
                cursor: "default",
              }}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
              {upd.rejections}
            </motion.button>
            <span className="text-xs ml-1" style={{ color: "#374151" }}>Voted</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => onVote(upd.update_id, "confirm")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: "#0d2a1a", border: "1.5px solid #166534", color: "#22c55e" }}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              Confirm {upd.confirmations > 0 ? `(${upd.confirmations})` : ""}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => onVote(upd.update_id, "reject")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: "#1f0d0d", border: "1.5px solid #7f1d1d", color: "#ef4444" }}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
              Incorrect {upd.rejections > 0 ? `(${upd.rejections})` : ""}
            </motion.button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function CommunityUpdates({ busId }) {
  const [updates, setUpdates]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const userId = getUserId();

  const loadUpdates = useCallback(async () => {
    if (!busId) return;
    try {
      const data = await get(`/buses/${busId}/updates?user_id=${encodeURIComponent(userId)}`);
      setUpdates(data);
    } catch {
      /* silent */
    }
    setLoading(false);
  }, [busId, userId]);

  useEffect(() => { loadUpdates(); }, [loadUpdates]);

  /* live socket updates */
  useEffect(() => {
    const patch = (incoming) => {
      if (incoming.bus_id !== busId) return;
      setUpdates((prev) => {
        const idx = prev.findIndex((u) => u.update_id === incoming.update_id);
        const enriched = {
          ...incoming,
          is_own: incoming.reported_by === userId,
          user_vote: idx >= 0 ? prev[idx].user_vote : null,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...enriched };
          return next;
        }
        return [enriched, ...prev].slice(0, 15);
      });
    };

    const onVoted = (incoming) => {
      setUpdates((prev) => {
        const idx = prev.findIndex((u) => u.update_id === incoming.update_id);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          confirmations:    incoming.confirmations,
          rejections:       incoming.rejections,
          confidence:       incoming.confidence,
          confidence_label: incoming.confidence_label,
          verified:         incoming.verified,
          verified_at:      incoming.verified_at,
        };
        return next;
      });
    };

    socket.on("update_created",  patch);
    socket.on("update_voted",    onVoted);
    socket.on("update_verified", onVoted);
    return () => {
      socket.off("update_created",  patch);
      socket.off("update_voted",    onVoted);
      socket.off("update_verified", onVoted);
    };
  }, [busId, userId]);

  const handleVote = async (updateId, vote) => {
    try {
      const result = await post(`/updates/${updateId}/vote`, { user_id: userId, vote });
      setUpdates((prev) =>
        prev.map((u) =>
          u.update_id === updateId
            ? {
                ...u,
                confirmations:    result.confirmations,
                rejections:       result.rejections,
                confidence:       result.confidence,
                confidence_label: result.confidence_label,
                verified:         result.verified,
                verified_at:      result.verified_at,
                user_vote:        vote,
              }
            : u,
        ),
      );
      toast.success(vote === "confirm" ? "Confirmed — thanks!" : "Marked as incorrect");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail === "already_voted") return toast.info("You already voted on this report");
      if (detail === "Cannot vote on your own report") return toast.info("Can't vote on your own report");
      toast.error("Vote failed");
    }
  };

  /* ── render ── */
  return (
    <div className="px-5 pb-2">
      {/* Section header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between py-3"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "#818cf8" }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#4b5563" }}>
            Community Reports
          </span>
          {updates.length > 0 && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "#1a1a2e", color: "#818cf8" }}
            >
              {updates.length}
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="w-4 h-4" style={{ color: "#374151" }} />
          : <ChevronUp   className="w-4 h-4" style={{ color: "#374151" }} />}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            {loading ? (
              <div className="flex flex-col gap-2 pb-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: "#141420" }} />
                ))}
              </div>
            ) : updates.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6" style={{ color: "#374151" }}>
                <Users className="w-6 h-6" />
                <p className="text-xs text-center">
                  No community reports yet.{"\n"}Be the first to update this bus status.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-2">
                <AnimatePresence mode="popLayout">
                  {updates.map((u) => (
                    <UpdateCard
                      key={u.update_id}
                      upd={u}
                      onVote={handleVote}
                      currentUserId={userId}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Legend */}
            {updates.length > 0 && (
              <p className="text-center text-xs pb-3" style={{ color: "#1e1e2e" }}>
                3+ confirms with 70%+ agreement = verified
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
