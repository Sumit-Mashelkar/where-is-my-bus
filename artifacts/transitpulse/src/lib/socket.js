import { io } from "socket.io-client";

export const socket = io(window.location.origin, {
  path: "/api/socket.io",
  transports: ["websocket", "polling"],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  randomizationFactor: 0.4,
  timeout: 20000,
});
