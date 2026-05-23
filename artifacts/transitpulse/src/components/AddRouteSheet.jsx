import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ArrowLeft, ArrowRight, Plus, Trash2, GripVertical,
  Search, MapPin, CheckCircle2, Loader2, Bus, Navigation,
  Sparkles, ChevronRight, LocateFixed,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { getUserId } from "@/lib/userId";
import { toast } from "sonner";

/* ─── helpers ─── */
function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

const STEPS = ["Route Info", "Build Stops", "Review"];

/* ─── stop search + geocode ─── */
function useStopSearch(existingStops) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [geocoding, setGeocoding] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // local matches first
      const q = query.toLowerCase();
      const local = existingStops
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 4)
        .map((s) => ({ type: "existing", name: s.name, lat: s.lat, lng: s.lng, stop_id: s.stop_id }));

      if (local.length > 0) {
        setResults([...local, { type: "geocode_trigger", label: `Search "${query}" online…` }]);
      } else {
        setResults([{ type: "geocode_trigger", label: `Search "${query}" online…` }]);
      }
    }, 200);
  }, [query, existingStops]);

  const geocodeQuery = useCallback(async (q) => {
    setGeocoding(true);
    try {
      const data = await get(`/geocode?q=${encodeURIComponent(q)}`);
      if (data.found && data.results?.length > 0) {
        const geo = data.results.map((r) => ({
          type: "new",
          name: r.short_name,
          lat: r.lat,
          lng: r.lng,
          display: r.display_name,
        }));
        const q2 = q.toLowerCase();
        const local = existingStops
          .filter((s) => s.name.toLowerCase().includes(q2))
          .slice(0, 2)
          .map((s) => ({ type: "existing", name: s.name, lat: s.lat, lng: s.lng, stop_id: s.stop_id }));
        setResults([...local, ...geo]);
      } else {
        toast.error("No location found — try a different name");
        setResults([]);
      }
    } catch {
      toast.error("Geocoding unavailable");
    }
    setGeocoding(false);
  }, [existingStops]);

  return { query, setQuery, results, setResults, geocoding, geocodeQuery };
}

/* ══════════════════════════════════════════════════════ */
export default function AddRouteSheet({ open, onClose, existingStops = [], onProposed }) {
  const userId = getUserId();
  const [step, setStep]         = useState(0);
  const [busNumber, setBusNumber] = useState("");
  const [busName, setBusName]   = useState("");
  const [direction, setDirection] = useState("");
  const [stops, setStops]       = useState([]);   // [{name, lat, lng, type}]
  const [submitting, setSubmitting] = useState(false);

  const search = useStopSearch(existingStops);

  /* lock body scroll */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  /* reset on close */
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(0); setBusNumber(""); setBusName(""); setDirection(""); setStops([]);
        search.setQuery(""); search.setResults([]);
      }, 300);
    }
  }, [open]);

  const addStop = (s) => {
    if (stops.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) {
      toast.error("Stop already in route"); return;
    }
    setStops((prev) => [...prev, { name: s.name, lat: s.lat, lng: s.lng, type: s.type }]);
    search.setQuery("");
    search.setResults([]);
  };

  const removeStop = (idx) => setStops((prev) => prev.filter((_, i) => i !== idx));

  const moveStop = (idx, dir) => {
    setStops((prev) => {
      const next = [...prev];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return prev;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await post("/routes/propose", {
        bus_number: busNumber.trim(),
        bus_name:   busName.trim(),
        direction:  direction.trim(),
        stops:      stops.map(({ name, lat, lng }) => ({ name, lat, lng })),
        user_id:    userId,
      });
      toast.success(`Route ${busNumber} submitted for community verification!`);
      onProposed?.(result);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed");
    }
    setSubmitting(false);
  };

  const canGoNext = [
    busNumber.trim() && busName.trim(),
    stops.length >= 2,
    true,
  ][step];

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
              maxHeight: "94dvh",
              boxShadow: "0 -8px 48px rgba(0,0,0,0.6)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "#2d2d4e" }} />
            </div>

            {/* Header */}
            <div className="shrink-0 px-5 pb-4 pt-1" style={{ borderBottom: "1px solid #1e1e2e" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {step > 0 && (
                    <button
                      onClick={() => setStep((s) => s - 1)}
                      className="w-8 h-8 flex items-center justify-center rounded-full"
                      style={{ background: "#1a1a2e" }}
                    >
                      <ArrowLeft className="w-4 h-4" style={{ color: "#6b7280" }} />
                    </button>
                  )}
                  <div>
                    <p className="text-white font-bold text-lg leading-tight">Add Route</p>
                    <p className="text-xs" style={{ color: "#6b7280" }}>
                      Step {step + 1} of 3 · {STEPS[step]}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full"
                  style={{ background: "#1a1a2e" }}
                >
                  <X className="w-4 h-4" style={{ color: "#6b7280" }} />
                </button>
              </div>

              {/* Step progress bar */}
              <div className="flex gap-1.5 mt-3">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-1 rounded-full transition-all duration-300"
                    style={{ background: i <= step ? "#818cf8" : "#1e1e2e" }}
                  />
                ))}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
              <AnimatePresence mode="wait">

                {/* ── Step 0: Route Info ── */}
                {step === 0 && (
                  <motion.div
                    key="step0"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    className="px-5 pt-6 pb-4 space-y-4"
                  >
                    <div className="flex items-start gap-3 p-4 rounded-2xl" style={{ background: "#141420", border: "1px solid #1e1e2e" }}>
                      <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#818cf8" }} />
                      <p className="text-sm leading-relaxed" style={{ color: "#9ca3af" }}>
                        New routes are submitted for <span style={{ color: "#818cf8" }}>community review</span>.
                        Once 3+ riders verify it, the route goes live on the map automatically.
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#4b5563" }}>
                        Bus number
                      </p>
                      <input
                        value={busNumber}
                        onChange={(e) => setBusNumber(e.target.value)}
                        placeholder="e.g. M15, Q44, BX12"
                        className="w-full text-base font-bold px-4 py-3.5 rounded-2xl outline-none"
                        style={{ background: "#141420", border: "1.5px solid #2d2d4e", color: "#fff" }}
                      />
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#4b5563" }}>
                        Route name
                      </p>
                      <input
                        value={busName}
                        onChange={(e) => setBusName(e.target.value)}
                        placeholder="e.g. Downtown Express"
                        className="w-full text-sm px-4 py-3.5 rounded-2xl outline-none"
                        style={{ background: "#141420", border: "1.5px solid #2d2d4e", color: "#fff" }}
                      />
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#4b5563" }}>
                        Direction <span style={{ color: "#374151" }}>(optional)</span>
                      </p>
                      <input
                        value={direction}
                        onChange={(e) => setDirection(e.target.value)}
                        placeholder="e.g. Northbound, Uptown"
                        className="w-full text-sm px-4 py-3.5 rounded-2xl outline-none"
                        style={{ background: "#141420", border: "1.5px solid #2d2d4e", color: "#fff" }}
                      />
                    </div>
                  </motion.div>
                )}

                {/* ── Step 1: Build Stops ── */}
                {step === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    className="px-5 pt-6 pb-4"
                  >
                    <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#4b5563" }}>
                      Search & add stops in order
                    </p>

                    {/* Search input */}
                    <div className="relative mb-3">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "#6b7280" }} />
                      <input
                        value={search.query}
                        onChange={(e) => search.setQuery(e.target.value)}
                        placeholder="Type a stop name…"
                        className="w-full text-sm pl-11 pr-4 py-3.5 rounded-2xl outline-none"
                        style={{ background: "#141420", border: "1.5px solid #2d2d4e", color: "#fff" }}
                      />
                      {search.geocoding && (
                        <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: "#818cf8" }} />
                      )}
                    </div>

                    {/* Suggestions */}
                    <AnimatePresence>
                      {search.results.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          className="rounded-2xl overflow-hidden mb-4"
                          style={{ border: "1px solid #2d2d4e", background: "#0d0d17" }}
                        >
                          {search.results.map((r, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                if (r.type === "geocode_trigger") {
                                  search.geocodeQuery(search.query);
                                } else {
                                  addStop(r);
                                }
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left"
                              style={{ borderBottom: i < search.results.length - 1 ? "1px solid #1e1e2e" : "none" }}
                            >
                              {r.type === "existing" ? (
                                <MapPin className="w-4 h-4 shrink-0" style={{ color: "#22c55e" }} />
                              ) : r.type === "new" ? (
                                <LocateFixed className="w-4 h-4 shrink-0" style={{ color: "#818cf8" }} />
                              ) : (
                                <Search className="w-4 h-4 shrink-0" style={{ color: "#6b7280" }} />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: r.type === "geocode_trigger" ? "#6b7280" : "#e5e7eb" }}>
                                  {r.type === "geocode_trigger" ? r.label : r.name}
                                </p>
                                {r.display && (
                                  <p className="text-xs truncate mt-0.5" style={{ color: "#4b5563" }}>{r.display}</p>
                                )}
                                {r.type === "existing" && (
                                  <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "#22c55e" }}>Existing stop</p>
                                )}
                                {r.type === "new" && (
                                  <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "#818cf8" }}>New stop · will be created</p>
                                )}
                              </div>
                              <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: "#4b5563" }} />
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Current stop list */}
                    {stops.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-10" style={{ color: "#374151" }}>
                        <MapPin className="w-8 h-8" />
                        <p className="text-sm font-medium">No stops added yet</p>
                        <p className="text-xs" style={{ color: "#1e1e2e" }}>Start typing a stop name above</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#4b5563" }}>
                          Route · {stops.length} stop{stops.length !== 1 ? "s" : ""}
                        </p>
                        {stops.map((s, idx) => {
                          const isFirst = idx === 0;
                          const isLast  = idx === stops.length - 1;
                          return (
                            <motion.div
                              key={`${s.name}-${idx}`}
                              layout
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className="flex items-center gap-3 px-3 py-3 rounded-2xl"
                              style={{ background: "#141420", border: "1px solid #1e1e2e" }}
                            >
                              {/* Position dot */}
                              <div className="flex flex-col items-center shrink-0 w-6">
                                <div
                                  className="w-3 h-3 rounded-full border-2"
                                  style={{
                                    background: isFirst ? "#818cf8" : isLast ? "#f472b6" : "#374151",
                                    borderColor: isFirst ? "#818cf8" : isLast ? "#f472b6" : "#374151",
                                  }}
                                />
                                {!isLast && <div className="w-0.5 h-4 mt-0.5" style={{ background: "#2d2d4e" }} />}
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate" style={{ color: "#e5e7eb" }}>{s.name}</p>
                                <p className="text-[10px] uppercase tracking-widest mt-0.5"
                                  style={{ color: isFirst ? "#818cf8" : isLast ? "#f472b6" : "#4b5563" }}>
                                  {isFirst ? "Origin" : isLast ? "Destination" : `Stop ${idx + 1}`}
                                  {s.type === "new" && " · New"}
                                </p>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => moveStop(idx, -1)} disabled={isFirst}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg disabled:opacity-30"
                                  style={{ background: "#1a1a2e" }}>
                                  <span className="text-xs" style={{ color: "#9ca3af" }}>↑</span>
                                </button>
                                <button onClick={() => moveStop(idx, 1)} disabled={isLast}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg disabled:opacity-30"
                                  style={{ background: "#1a1a2e" }}>
                                  <span className="text-xs" style={{ color: "#9ca3af" }}>↓</span>
                                </button>
                                <button onClick={() => removeStop(idx)}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg"
                                  style={{ background: "#1a1a2e" }}>
                                  <Trash2 className="w-3 h-3" style={{ color: "#ef4444" }} />
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ── Step 2: Review ── */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    className="px-5 pt-6 pb-4 space-y-4"
                  >
                    {/* Bus summary */}
                    <div className="p-4 rounded-2xl" style={{ background: "#141420", border: "1px solid #2d2d4e" }}>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 flex items-center justify-center rounded-xl font-black text-base"
                          style={{ background: "#1a1a2e", color: "#818cf8", border: "1.5px solid #2d2d4e" }}
                        >
                          {busNumber}
                        </div>
                        <div>
                          <p className="text-white font-bold text-base">{busName}</p>
                          {direction && <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{direction}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Stops */}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#4b5563" }}>
                        Route · {stops.length} stops
                      </p>
                      <div className="space-y-0">
                        {stops.map((s, idx) => {
                          const isFirst = idx === 0;
                          const isLast  = idx === stops.length - 1;
                          return (
                            <div key={idx} className="flex items-start gap-3">
                              <div className="flex flex-col items-center shrink-0 w-6 pt-1">
                                <div
                                  className="w-3 h-3 rounded-full border-2"
                                  style={{
                                    background: isFirst ? "#818cf8" : isLast ? "#f472b6" : "#374151",
                                    borderColor: isFirst ? "#818cf8" : isLast ? "#f472b6" : "#374151",
                                  }}
                                />
                                {!isLast && <div className="w-0.5 flex-1 mt-0.5" style={{ background: "#1e1e2e", minHeight: 24 }} />}
                              </div>
                              <div className="pb-4 flex-1 min-w-0">
                                <p className="text-sm font-semibold" style={{ color: "#e5e7eb" }}>{s.name}</p>
                                <p className="text-[10px] uppercase tracking-widest mt-0.5"
                                  style={{ color: isFirst ? "#818cf8" : isLast ? "#f472b6" : "#4b5563" }}>
                                  {isFirst ? "Origin" : isLast ? "Destination" : `Stop ${idx + 1}`}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: "#111118", border: "1px solid #1e1e2e" }}>
                      <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }} />
                      <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
                        Your route proposal will be reviewed by the community.
                        Once <span style={{ color: "#9ca3af" }}>3 riders verify it</span> with 70%+ approval,
                        it goes <span style={{ color: "#22c55e" }}>live on the map</span> automatically.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-5 py-4" style={{ background: "#0d0d17", borderTop: "1px solid #1e1e2e" }}>
              <motion.button
                onClick={() => {
                  if (step < 2) setStep((s) => s + 1);
                  else submit();
                }}
                disabled={!canGoNext || submitting}
                whileTap={{ scale: 0.97 }}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-sm disabled:opacity-50"
                style={{ background: "#818cf8", color: "#000" }}
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                ) : step < 2 ? (
                  <>Continue <ArrowRight className="w-4 h-4" /></>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Submit for Community Review</>
                )}
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
