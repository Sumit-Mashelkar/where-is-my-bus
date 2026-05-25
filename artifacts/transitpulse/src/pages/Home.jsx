import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { get, post, bustAllCache } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { socket } from "@/lib/socket";
import { getUserId } from "@/lib/userId";

import SearchResults  from "@/components/SearchResults";
import BusTimeline    from "@/components/BusTimeline";
import AddRouteSheet  from "@/components/AddRouteSheet";
import UpdatesTab     from "@/components/UpdatesTab";
import UpdateLocationDialog from "@/components/UpdateLocationDialog";
import LandingPage    from "@/components/LandingPage";
import BottomNav      from "@/components/BottomNav";

import {
  Menu, Bell, Sun, Moon, Bus, ArrowLeft,
  User, Shield, Star, Activity, Clock, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { statusColor } from "@/lib/status";

/* ── localStorage helpers ── */
const HISTORY_KEY = "tp_search_history";
const SAVED_KEY   = "tp_saved_routes";
const MAX_HISTORY = 6;

function loadHistory()  { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY))); } catch {} }
function loadSaved()    { try { return JSON.parse(localStorage.getItem(SAVED_KEY)   || "[]"); } catch { return []; } }

/* ── sessionStorage data cache (30s TTL) ── */
const SS_BUSES_KEY = "tp_ss_buses";
const SS_STOPS_KEY = "tp_ss_stops";
const SS_TTL = 30_000;

function ssLoad(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function ssSave(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + SS_TTL })); } catch {}
}

/* ── Nearby buses sheet ── */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dl = ((lat2-lat1)*Math.PI)/180, dlg = ((lng2-lng1)*Math.PI)/180;
  const a = Math.sin(dl/2)**2 + Math.cos((lat1*Math.PI)/180)*Math.cos((lat2*Math.PI)/180)*Math.sin(dlg/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function NearbySheet({ open, onClose, buses, onPick }) {
  const [loading, setLoading] = useState(false);
  const [sorted,  setSorted]  = useState([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    navigator.geolocation?.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        const list = buses
          .filter((b) => b.current_lat != null)
          .map((b) => ({ ...b, dist: haversineKm(lat, lng, b.current_lat, b.current_lng) }))
          .sort((a, b) => a.dist - b.dist);
        setSorted(list);
        setLoading(false);
      },
      () => { toast.error("Could not get your location"); setLoading(false); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [open, buses]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="nb-bd" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            onClick={onClose} className="fixed inset-0 z-[60]" style={{ background:"rgba(0,0,0,0.72)" }} />
          <motion.div key="nb-sh" initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }}
            transition={{ type:"spring", damping:30, stiffness:320 }}
            className="fixed inset-x-0 bottom-0 z-[61] rounded-t-3xl flex flex-col"
            style={{ background:"#0f0f1a", maxHeight:"70dvh", boxShadow:"0 -8px 48px rgba(0,0,0,0.6)" }}>
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background:"#2d2d4e" }}/>
            </div>
            <div className="px-5 pb-3 shrink-0" style={{ borderBottom:"1px solid #1e1e2e" }}>
              <p className="text-white font-bold text-base">Nearby Buses</p>
              <p className="text-xs mt-0.5" style={{ color:"#4b5563" }}>Sorted by distance from your location</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
                </div>
              )}
              {!loading && sorted.length === 0 && (
                <p className="text-center text-sm py-10" style={{ color:"#374151" }}>No buses with known location</p>
              )}
              {sorted.map((b) => {
                const color = statusColor(b.status);
                return (
                  <motion.button key={b.bus_id} onClick={() => { onPick(b); onClose(); }}
                    whileTap={{ scale:0.97 }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
                    style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                    <div className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl font-black text-sm"
                      style={{ background:color+"22", color, border:`1px solid ${color}44` }}>{b.number}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{b.name}</p>
                      <p className="text-xs mt-0.5" style={{ color:"#4b5563" }}>{(b.dist*1000).toFixed(0)} m away</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-widest"
                      style={{ background:color+"22", color }}>{b.status}</span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Profile sheet ── */
function ProfileSheet({ open, onClose, theme, toggle, searchHistory, onClearHistory }) {
  const userId = getUserId();
  const [rep, setRep] = useState(null);

  useEffect(() => {
    if (!open) return;
    get(`/users/${encodeURIComponent(userId)}/reputation`).then(setRep).catch(() => {});
  }, [open, userId]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const BADGE_CFG = {
    "Trusted Commuter":  { color:"#22c55e", Icon:Shield },
    "Verified Commuter": { color:"#3b82f6", Icon:Shield },
    "Frequent Reporter": { color:"#8b5cf6", Icon:Star   },
    "New Rider":         { color:"#4b5563", Icon:User   },
  };
  const badge = rep ? (BADGE_CFG[rep.badge] || BADGE_CFG["New Rider"]) : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="pr-bd" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            onClick={onClose} className="fixed inset-0 z-[60]" style={{ background:"rgba(0,0,0,0.72)" }} />
          <motion.div key="pr-sh" initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }}
            transition={{ type:"spring", damping:30, stiffness:320 }}
            className="fixed inset-x-0 bottom-0 z-[61] rounded-t-3xl flex flex-col"
            style={{ background:"#0f0f1a", maxHeight:"80dvh", boxShadow:"0 -8px 48px rgba(0,0,0,0.6)" }}>
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background:"#2d2d4e" }}/>
            </div>
            <div className="px-5 py-4 shrink-0 flex items-center justify-between" style={{ borderBottom:"1px solid #1e1e2e" }}>
              <p className="text-white font-bold text-base">Profile</p>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background:"#1a1a2e" }}>
                <X className="w-4 h-4" style={{ color:"#6b7280" }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-2xl" style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                <div className="w-14 h-14 flex items-center justify-center rounded-2xl font-black text-xl"
                  style={{ background:"#818cf822", color:"#818cf8", border:"1px solid #818cf844" }}>
                  {userId.slice(0,2).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-bold">Anonymous Rider</p>
                  <p className="text-xs mt-0.5 font-mono" style={{ color:"#4b5563" }}>{userId.slice(0,16)}…</p>
                  {rep && badge && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <badge.Icon className="w-3 h-3" style={{ color:badge.color }} />
                      <span className="text-xs font-bold" style={{ color:badge.color }}>{rep.badge}</span>
                      <span className="text-xs" style={{ color:"#374151" }}>· {rep.trust_points} pts</span>
                    </div>
                  )}
                </div>
              </div>
              {rep && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label:"Submitted",  val:rep.updates_submitted, color:"#818cf8" },
                    { label:"Confirmed",  val:rep.updates_confirmed, color:"#22c55e" },
                    { label:"Votes Cast", val:rep.votes_cast,        color:"#f472b6" },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="p-3 rounded-2xl text-center" style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                      <p className="text-xl font-black" style={{ color }}>{val}</p>
                      <p className="text-[10px] mt-0.5 uppercase tracking-widest" style={{ color:"#374151" }}>{label}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color:"#374151" }}>Settings</p>
                <motion.button onClick={toggle} whileTap={{ scale:0.97 }}
                  className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl"
                  style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                  <div className="flex items-center gap-3">
                    {theme==="dark"
                      ? <Sun className="w-4 h-4" style={{ color:"#eab308" }}/>
                      : <Moon className="w-4 h-4" style={{ color:"#818cf8" }}/>}
                    <span className="text-sm font-medium text-white">
                      {theme==="dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    </span>
                  </div>
                </motion.button>
                {searchHistory.length > 0 && (
                  <motion.button onClick={onClearHistory} whileTap={{ scale:0.97 }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                    style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                    <Trash2 className="w-4 h-4" style={{ color:"#ef4444" }}/>
                    <span className="text-sm font-medium" style={{ color:"#ef4444" }}>Clear Search History</span>
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Top navigation bar ── */
function TopBar({ onMenuOpen, onBellClick, pendingCount }) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[35] flex items-center justify-between px-4"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 12px)",
        paddingBottom: 12,
        background: "rgba(10,10,15,0.96)",
        borderBottom: "1px solid #1e1e2e",
        backdropFilter: "blur(20px)",
      }}
    >
      <motion.button onClick={onMenuOpen} whileTap={{ scale:0.88 }}
        className="w-9 h-9 flex items-center justify-center rounded-2xl"
        style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
        <Menu className="w-4 h-4" style={{ color:"#9ca3af" }} />
      </motion.button>

      <div className="flex items-center gap-2">
        <div className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background:"#818cf822" }}>
          <Bus className="w-3.5 h-3.5" style={{ color:"#818cf8" }} />
        </div>
        <p className="font-black text-white tracking-tighter text-sm">TransitPulse</p>
      </div>

      <motion.button onClick={onBellClick} whileTap={{ scale:0.88 }}
        className="relative w-9 h-9 flex items-center justify-center rounded-2xl"
        style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
        <Bell className="w-4 h-4" style={{ color: pendingCount > 0 ? "#f472b6" : "#6b7280" }} />
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-black"
            style={{ background:"#f472b6", color:"#000" }}>
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </motion.button>
    </div>
  );
}

/* ── Sidebar ── */
function Sidebar({ open, onClose, onAction, theme, toggle, buses, pendingCount }) {
  const items = [
    { id:"add",     Icon: Activity,     label:"Add Route",         sub:"Propose a new route",   color:"#818cf8" },
    { id:"updates", Icon: Bell,         label:"Community Updates", sub:"Vote on proposals",      color:"#f472b6", badge: pendingCount || null },
    { id:"report",  Icon: Clock,        label:"Report Delay",      sub:"Update bus status",      color:"#eab308" },
    { id:"theme",   Icon: theme==="dark" ? Sun : Moon,
      label: theme==="dark" ? "Light Mode" : "Dark Mode",
      sub:"Toggle appearance", color:"#a78bfa" },
  ];

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="sb-bd" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            transition={{ duration:0.2 }} onClick={onClose}
            className="fixed inset-0 z-[50]" style={{ background:"rgba(0,0,0,0.65)" }} />
          <motion.div key="sb-pn" initial={{ x:"-100%" }} animate={{ x:0 }} exit={{ x:"-100%" }}
            transition={{ type:"spring", damping:28, stiffness:300 }}
            className="fixed top-0 left-0 bottom-0 z-[51] flex flex-col w-72 max-w-[85vw]"
            style={{ background:"#0f0f1a", borderRight:"1px solid #1e1e2e", boxShadow:"8px 0 48px rgba(0,0,0,0.6)" }}>
            <div className="shrink-0 px-5 flex items-center justify-between"
              style={{ paddingTop:"max(env(safe-area-inset-top),16px)", paddingBottom:16, borderBottom:"1px solid #1e1e2e" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ background:"#818cf822" }}>
                  <Bus className="w-4 h-4" style={{ color:"#818cf8" }} />
                </div>
                <p className="font-black text-white tracking-tighter text-sm">TransitPulse</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background:"#1a1a2e" }}>
                <X className="w-4 h-4" style={{ color:"#6b7280" }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {items.map(({ id, Icon, label, sub, color, badge }) => (
                <motion.button key={id}
                  onClick={() => { if (id==="theme") toggle(); else onAction(id); if (id!=="theme") onClose(); }}
                  whileTap={{ scale:0.97 }}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left"
                  style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                  <div className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl"
                    style={{ background:color+"22", border:`1px solid ${color}44` }}>
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white leading-tight">{label}</p>
                    <p className="text-xs mt-0.5 truncate" style={{ color:"#4b5563" }}>{sub}</p>
                  </div>
                  {badge && (
                    <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                      style={{ background:"#f472b6", color:"#000" }}>{badge}</span>
                  )}
                </motion.button>
              ))}
            </div>
            <div className="shrink-0 px-5 py-4 flex items-center gap-4" style={{ borderTop:"1px solid #1e1e2e" }}>
              <div>
                <p className="text-[9px] uppercase tracking-widest" style={{ color:"#374151" }}>Buses</p>
                <p className="font-black text-white text-lg tracking-tighter">{buses.length}</p>
              </div>
              <div className="w-px h-6" style={{ background:"#1e1e2e" }} />
              <div>
                <p className="text-[9px] uppercase tracking-widest" style={{ color:"#374151" }}>Pending</p>
                <p className="font-black text-lg tracking-tighter" style={{ color:"#f472b6" }}>{pendingCount}</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function Home() {
  const { theme, toggle } = useTheme();
  const userId = getUserId();

  /* data — seed from sessionStorage for instant render */
  const [stops, setStops] = useState(() => ssLoad(SS_STOPS_KEY) || []);
  const [buses, setBuses] = useState(() => ssLoad(SS_BUSES_KEY) || []);

  /* search */
  const [origin,      setOrigin]      = useState("");
  const [destination, setDestination] = useState("");
  const [searching,   setSearching]   = useState(false);
  const [results,     setResults]     = useState(null);

  /* view */
  const [view,      setView]      = useState("home");
  const [activeTab, setActiveTab] = useState("home");

  /* selected bus */
  const [activeBus,    setActiveBus]    = useState(null);
  const [updateLocBus, setUpdateLocBus] = useState(null);

  /* panels */
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [addRouteOpen,  setAddRouteOpen]  = useState(false);
  const [updatesOpen,   setUpdatesOpen]   = useState(false);
  const [busPickerOpen, setBusPickerOpen] = useState(false);
  const [nearbyOpen,    setNearbyOpen]    = useState(false);
  const [profileOpen,   setProfileOpen]   = useState(false);

  const [pendingCount, setPendingCount] = useState(0);
  const [connected,    setConnected]    = useState(socket.connected);

  const [searchHistory, setSearchHistory] = useState(loadHistory);
  const [savedRoutes]                     = useState(loadSaved);

  /* ── stable refs for socket handlers ── */
  const busesRef = useRef(buses);
  useEffect(() => { busesRef.current = buses; }, [buses]);

  /* ── data loading with sessionStorage cache ── */
  const refresh = useCallback(async (force = false) => {
    try {
      if (force) bustAllCache();
      const [s, b] = await Promise.all([get("/stops"), get("/buses")]);
      setStops(s);
      setBuses(b);
      ssSave(SS_STOPS_KEY, s);
      ssSave(SS_BUSES_KEY, b);
    } catch { /* serve from state / sessionStorage */ }
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const data = await get(`/routes/pending?user_id=${encodeURIComponent(userId)}`);
      setPendingCount(data.filter((r) => r.status === "pending").length);
    } catch {}
  }, [userId]);

  /* initial load */
  useEffect(() => { refresh(); refreshPending(); }, [refresh, refreshPending]);

  /* ── socket — stable handlers via refs ── */
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      /* re-fetch on reconnect to sync missed updates */
      refresh(true);
      refreshPending();
    };
    const onDisconnect = () => setConnected(false);

    const onLocation = (p) => {
      setBuses((prev) => prev.map((b) =>
        b.bus_id === p.bus_id
          ? { ...b, current_lat: p.lat, current_lng: p.lng, status: p.status || b.status }
          : b,
      ));
    };

    const onBusAdded   = () => refresh();
    const onRouteEvent = () => { refresh(); refreshPending(); };
    const onRouteVoted = (r) => { if (r.status !== "pending") refreshPending(); };

    socket.on("connect",        onConnect);
    socket.on("disconnect",     onDisconnect);
    socket.on("bus_location",   onLocation);
    socket.on("bus_added",      onBusAdded);
    socket.on("route_proposed", refreshPending);
    socket.on("route_verified", onRouteEvent);
    socket.on("route_voted",    onRouteVoted);

    return () => {
      socket.off("connect",        onConnect);
      socket.off("disconnect",     onDisconnect);
      socket.off("bus_location",   onLocation);
      socket.off("bus_added",      onBusAdded);
      socket.off("route_proposed", refreshPending);
      socket.off("route_verified", onRouteEvent);
      socket.off("route_voted",    onRouteVoted);
    };
  }, [refresh, refreshPending]);

  /* ── search ── */
  const doSearch = useCallback(async () => {
    if (!origin.trim() || !destination.trim()) return;
    setSearching(true);
    try {
      const r = await post("/routes/search", { origin: origin.trim(), destination: destination.trim() });
      setResults(r);
      setView("results");
      setActiveTab("routes");
      if (!r.origin_stop || !r.destination_stop) {
        toast.error("No matching stops found");
      } else if (r.buses.length === 0) {
        toast.message("No direct buses found");
      } else {
        const entry = {
          id: Date.now().toString(),
          origin: origin.trim(),
          destination: destination.trim(),
          buses: r.buses.slice(0, 3).map(({ number, name }) => ({ number, name })),
          time: new Date().toISOString(),
        };
        const next = [entry, ...searchHistory.filter((x) => !(x.origin===entry.origin && x.destination===entry.destination))];
        setSearchHistory(next);
        saveHistory(next);
      }
    } catch { toast.error("Search failed — please try again"); }
    setSearching(false);
  }, [origin, destination, searchHistory]);

  /* ── navigation ── */
  const selectBus        = useCallback((bus) => { setActiveBus(bus); setView("timeline"); }, []);
  const backFromTimeline = useCallback(() => {
    setView(results ? "results" : "home");
    setActiveBus(null);
    if (!results) setActiveTab("home");
  }, [results]);
  const backFromResults = useCallback(() => { setView("home"); setResults(null); setActiveTab("home"); }, []);

  /* ── sidebar / quick card actions ── */
  const handleAction = useCallback((id) => {
    if (id === "search")  { setView("home"); setActiveTab("home"); }
    if (id === "nearby")  setNearbyOpen(true);
    if (id === "add")     setAddRouteOpen(true);
    if (id === "updates") { setUpdatesOpen(true); setActiveTab("updates"); }
    if (id === "report")  setBusPickerOpen(true);
  }, []);

  /* ── bottom nav ── */
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    if (tab === "home")    setView("home");
    if (tab === "routes")  { if (!results) setView("home"); else setView("results"); }
    if (tab === "updates") setUpdatesOpen(true);
    if (tab === "profile") setProfileOpen(true);
  }, [results]);

  /* ── history ── */
  const handleHistorySelect = useCallback((item) => {
    setOrigin(item.origin);
    setDestination(item.destination);
  }, []);
  const handleRemoveHistory = useCallback((id) => {
    const next = id === "all" ? [] : searchHistory.filter((x) => x.id !== id);
    setSearchHistory(next);
    saveHistory(next);
  }, [searchHistory]);
  const clearHistory = useCallback(() => { setSearchHistory([]); saveHistory([]); }, []);

  /* ── derived ── */
  const showBottomNav = view === "home";
  const topBarHeight  = 64;

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden" style={{ background:"#0A0A0F" }}>

      {/* Home landing */}
      {view === "home" && (
        <div className="absolute inset-0 overflow-y-auto no-scrollbar" style={{ paddingTop: topBarHeight }}>
          <LandingPage
            stops={stops}
            buses={buses}
            connected={connected}
            pendingCount={pendingCount}
            origin={origin}
            setOrigin={setOrigin}
            destination={destination}
            setDestination={setDestination}
            onSearch={doSearch}
            searching={searching}
            onAction={handleAction}
            searchHistory={searchHistory}
            savedRoutes={savedRoutes}
            onHistorySelect={handleHistorySelect}
            onRemoveHistory={handleRemoveHistory}
          />
        </div>
      )}

      {/* Top nav (home only) */}
      {view === "home" && (
        <TopBar
          onMenuOpen={() => setSidebarOpen(true)}
          onBellClick={() => { setUpdatesOpen(true); setActiveTab("updates"); }}
          pendingCount={pendingCount}
        />
      )}

      {/* Overlay views */}
      <AnimatePresence mode="wait">
        {view === "results" && results && (
          <SearchResults key="results" results={results} onBusSelect={selectBus} onBack={backFromResults} />
        )}
        {view === "timeline" && activeBus && (
          <BusTimeline key="timeline" bus={activeBus} onBack={backFromTimeline}
            onUpdateLocation={(b) => setUpdateLocBus(b)} />
        )}
      </AnimatePresence>

      {/* Bottom nav */}
      {showBottomNav && (
        <BottomNav active={activeTab} onChange={handleTabChange} badge={{ updates: pendingCount }} />
      )}

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onAction={handleAction}
        theme={theme}
        toggle={toggle}
        buses={buses}
        pendingCount={pendingCount}
      />

      {/* Sheets & dialogs */}
      <AddRouteSheet
        open={addRouteOpen}
        onClose={() => setAddRouteOpen(false)}
        existingStops={stops}
        onProposed={() => { refresh(); refreshPending(); }}
      />
      <UpdatesTab
        open={updatesOpen}
        onClose={() => { setUpdatesOpen(false); refreshPending(); setActiveTab("home"); }}
      />
      <NearbySheet
        open={nearbyOpen}
        onClose={() => setNearbyOpen(false)}
        buses={buses}
        onPick={(b) => setUpdateLocBus(b)}
      />
      <ProfileSheet
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setActiveTab("home"); }}
        theme={theme}
        toggle={toggle}
        searchHistory={searchHistory}
        onClearHistory={clearHistory}
      />

      {/* Bus picker for Report Delay */}
      <AnimatePresence>
        {busPickerOpen && (
          <>
            <motion.div key="bp-bd" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
              onClick={() => setBusPickerOpen(false)}
              className="fixed inset-0 z-[60]" style={{ background:"rgba(0,0,0,0.72)" }} />
            <motion.div key="bp-sh" initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }}
              transition={{ type:"spring", damping:30, stiffness:320 }}
              className="fixed inset-x-0 bottom-0 z-[61] rounded-t-3xl flex flex-col"
              style={{ background:"#0f0f1a", maxHeight:"70dvh", boxShadow:"0 -8px 48px rgba(0,0,0,0.6)" }}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background:"#2d2d4e" }}/>
              </div>
              <div className="px-5 pb-3 shrink-0" style={{ borderBottom:"1px solid #1e1e2e" }}>
                <p className="text-white font-bold text-base">Which bus are you on?</p>
                <p className="text-xs mt-0.5" style={{ color:"#4b5563" }}>Select to submit a status update</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {buses.map((b) => {
                  const color = statusColor(b.status);
                  return (
                    <motion.button key={b.bus_id}
                      onClick={() => { setUpdateLocBus(b); setBusPickerOpen(false); }}
                      whileTap={{ scale:0.97 }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
                      style={{ background:"#141420", border:"1px solid #1e1e2e" }}>
                      <div className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl font-black text-sm"
                        style={{ background:color+"22", color, border:`1px solid ${color}44` }}>{b.number}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{b.name}</p>
                        {b.direction && (
                          <p className="text-xs mt-0.5 truncate" style={{ color:"#4b5563" }}>{b.direction}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-widest"
                        style={{ background:color+"22", color }}>{b.status}</span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <UpdateLocationDialog
        bus={updateLocBus}
        open={!!updateLocBus}
        onClose={() => setUpdateLocBus(null)}
        onUpdated={() => refresh(true)}
      />
    </div>
  );
}
