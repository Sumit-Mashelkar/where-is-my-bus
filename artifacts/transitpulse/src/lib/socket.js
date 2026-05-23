import { io } from "socket.io-client";

export const socket = io(window.location.origin, {
  path: "/api/socket.io",
  transports: ["websocket", "polling"],
  autoConnect: true,
});
