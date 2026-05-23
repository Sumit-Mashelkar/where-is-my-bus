import { useState, useEffect, useCallback, useRef } from "react";
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

const VERIFY_THRESHOLD = 3; // confirms needed

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5)   return "just now";
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/* ── single update card (memoised) ── */
const UpdateCard = ({ upd, onVote, currentUserId, votingId }) => {
  const conf    = CONF_CONFIG[upd.confidence_label] || CONF_CONFIG.low;
  const isOwn   = upd.is_own || upd.reported_by === currentUserId;
  const hasVoted = upd.user_vote !== null && upd.user_vote !== undefined;
  const total   = upd.confirmations + upd.rejections;
  const pct     = total > 0 ? Math.round((upd.confirmations / total) * 100) : 50;
  const isVoting = votingId === upd.update_id;

  /* verification progress */
  const verifyPct = Math.min(100, Math.round((upd.confirmations / VERIFY_THRESHOLD) * 100));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "#141420", border: `1px solid ${upd.verified ? "#22c55e33" : "#1e1e2e"}` }}
    >
      {/* Top bar */}
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
        <div className="mt-2 mb-1">
          <div className="flex justify-between text-[10px] mb-1" style={{ color: "#4b5563" }}>
            <span>{pct}% agreement</span>
            <span>{total} vote{total !== 1 ? "s" : ""}</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1e1e2e" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: conf.color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Verification progress (only if unverified) */}
        {!upd.verified && upd.confirmations < VERIFY_THRESHOLD && (
          <div className="mt-1.5 mb-1">
            <div className="flex justify-between text-[10px] mb-1" style={{ color: "#374151" }}>
              <span>Verification progress</span>
              <span>{upd.confirmations}/{VERIFY_THRESHOLD} confirms</span>
            </div>
            <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "#1e1e2e" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "#818cf8" }}
                initial={{ width: 0 }}
                animate={{ width: `${verifyPct}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-1.5 text-xs mt-1.5" style={{ color: "#4b5563" }}>
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
          <p className="text-xs italic" style={{ color: "#374151" }}>
            Your report · {upd.confirmations} confirm{upd.confirmations !== 1 ? "s" : ""} so far
          </p>
        ) : hasVoted ? (
          <div className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{
                background: upd.user_vote === "confirm" ? "#0d2a1a" : "#141420",
                border: `1.5px solid ${upd.user_vote === "confirm" ? "#22c55e" : "#1e1e2e"}`,
                color: upd.user_vote === "confirm" ? "#22c55e" : "#374151",
              }}>
              <ThumbsUp className="w-3.5 h-3.5" />
              {upd.confirmations}
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{
                background: upd.user_vote === "reject" ? "#1f0d0d" : "#141420",
                border: `1.5px solid ${upd.user_vote === "reject" ? "#ef4444" : "#1e1e2e"}`,
                color: upd.user_vote === "reject" ? "#ef4444" : "#374151",
              }}>
              <ThumbsDown className="w-3.5 h-3.5" />
              {upd.rejections}
            </div>
            <span className="text-xs" style={{ color: "#374151" }}>Voted</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => !isVoting && onVote(upd.update_id, "confirm")}
              disabled={isVoting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "#0d2a1a", border: "1.5px solid #166534", color: "#22c55e" }}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              Confirm {upd.confirmations > 0 ? `(${upd.confirmations})` : ""}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => !isVoting && onVote(upd.update_id, "reject")}
              disabled={isVoting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
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
};

/* ══════════════════════════════════════════════════════════════ */
export default function CommunityUpdates({ busId }) {
  const [updates, setUpdates]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [votingId, setVotingId]   = useState(null); // which update is being voted on
  const userId = getUserId();

  /* stable ref so socket handlers never go stale */
  const updatesRef = useRef(updates);
  useEffect(() => { updatesRef.current = updates; }, [updates]);

  const loadUpdates = useCallback(async () => {
    if (!busId) return;
    try {
      const data = await get(`/buses/${busId}/updates?user_id=${encodeURIComponent(userId)}`);
      setUpdates(data);
    } catch {
      /* silent — stale data served from cache */
    }
    setLoading(false);
  }, [busId, userId]);

  useEffect(() => { loadUpdates(); }, [loadUpdates]);

  /* ── socket: only update the changed item ── */
  useEffect(() => {
    const patchNew = (incoming) => {
      if (incoming.bus_id !== busId) return;
      setUpdates((prev) => {
        const idx = prev.findIndex((u) => u.update_id === incoming.update_id);
        const enriched = {
          ...incoming,
          is_own:    incoming.reported_by === userId,
          user_vote: idx >= 0 ? prev[idx].user_vote : null,
        };
        if (idx >= 0) {
          const next = [...prev]; next[idx] = { ...next[idx], ...enriched }; return next;
        }
        return [enriched, ...prev].slice(0, 15);
      });
    };

    const patchVote = (incoming) => {
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

    socket.on("update_created",  patchNew);
    socket.on("update_voted",    patchVote);
    socket.on("update_verified", patchVote);
    return () => {
      socket.off("update_created",  patchNew);
      socket.off("update_voted",    patchVote);
      socket.off("update_verified", patchVote);
    };
  }, [busId, userId]);

  /* ── optimistic vote ── */
  const handleVote = useCallback(async (updateId, vote) => {
    if (votingId) return; // already processing a vote
    setVotingId(updateId);

    /* optimistic patch */
    setUpdates((prev) =>
      prev.map((u) => {
        if (u.update_id !== updateId) return u;
        const delta = vote === "confirm"
          ? { confirmations: u.confirmations + 1 }
          : { rejections: u.rejections + 1 };
        const total = u.confirmations + u.rejections + 1;
        const newConf = (u.confirmations + (vote === "confirm" ? 1 : 0)) / total;
        return {
          ...u,
          ...delta,
          user_vote: vote,
          confidence: newConf,
          confidence_label: newConf >= 0.7 ? "high" : newConf >= 0.4 ? "medium" : "low",
        };
      }),
    );

    try {
      const result = await post(`/updates/${updateId}/vote`, { user_id: userId, vote });
      /* reconcile with server truth */
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
      /* revert optimistic patch on error */
      setUpdates((prev) =>
        prev.map((u) => {
          if (u.update_id !== updateId) return u;
          const delta = vote === "confirm"
            ? { confirmations: Math.max(0, u.confirmations - 1) }
            : { rejections: Math.max(0, u.rejections - 1) };
          return { ...u, ...delta, user_vote: null };
        }),
      );
      const detail = e?.response?.data?.detail;
      if (detail === "already_voted") return toast.info("You already voted on this report");
      if (detail === "Cannot vote on your own report") return toast.info("Can't vote on your own report");
      toast.error("Vote failed — please try again");
    } finally {
      setVotingId(null);
    }
  }, [votingId, userId]);

  /* ── render ── */
  return (
    <div className="px-1 pb-2">
      {/* Section header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between py-3 px-4"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "#818cf8" }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#4b5563" }}>
            Community Reports
          </span>
          {updates.length > 0 && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "#1a1a2e", color: "#818cf8" }}>
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
            transition={{ duration: 0.22 }}
            className="overflow-hidden px-4"
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
                      votingId={votingId}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {updates.length > 0 && (
              <p className="text-center text-[10px] pb-3" style={{ color: "#1e2a3e" }}>
                3+ confirms with 70%+ agreement = verified
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
