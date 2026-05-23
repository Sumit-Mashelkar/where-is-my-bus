import { motion } from "framer-motion";
import { Home, Map, Navigation, Newspaper, User } from "lucide-react";

const TABS = [
  { id: "home",    Icon: Home,       label: "Home"    },
  { id: "routes",  Icon: Map,        label: "Routes"  },
  { id: "live",    Icon: Navigation, label: "Live"    },
  { id: "updates", Icon: Newspaper,  label: "Updates" },
  { id: "profile", Icon: User,       label: "Profile" },
];

export default function BottomNav({ active, onChange, badge = {} }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[30] flex items-center justify-around px-2"
      style={{
        background: "rgba(10,10,15,0.97)",
        borderTop: "1px solid #1e1e2e",
        paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
        paddingTop: 10,
        backdropFilter: "blur(20px)",
      }}
    >
      {TABS.map(({ id, Icon, label }) => {
        const isActive = active === id;
        const count    = badge[id] || 0;
        return (
          <motion.button
            key={id}
            onClick={() => onChange(id)}
            whileTap={{ scale: 0.88 }}
            className="relative flex flex-col items-center gap-1 min-w-[52px] py-1"
          >
            <div className="relative">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-2xl transition-all duration-200"
                style={{
                  background: isActive ? "#818cf822" : "transparent",
                  border: isActive ? "1px solid #818cf844" : "1px solid transparent",
                }}
              >
                <Icon
                  className="w-4.5 h-4.5"
                  style={{
                    width: 18,
                    height: 18,
                    color: isActive ? "#818cf8" : "#4b5563",
                    transition: "color 0.2s",
                  }}
                />
              </div>
              {count > 0 && (
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center rounded-full font-black text-[9px] min-w-[14px] h-3.5 px-0.5"
                  style={{ background: "#f472b6", color: "#000" }}
                >
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </div>
            <span
              className="text-[10px] font-semibold tracking-wide transition-colors duration-200"
              style={{ color: isActive ? "#818cf8" : "#374151" }}
            >
              {label}
            </span>
            {isActive && (
              <motion.div
                layoutId="bottom-nav-indicator"
                className="absolute -bottom-1 w-4 h-0.5 rounded-full"
                style={{ background: "#818cf8" }}
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
