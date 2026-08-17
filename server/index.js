import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

import { registerAuditHandlers, initLogs } from "./handlers/logs.js";
import { registerWhitelistHandlers, initWhitelist } from "./handlers/whitelist.js";
import { registerPourfendeursHandlers, initPourfendeurs } from "./handlers/pourfendeurs.js";
import { registerWantedHandlers, initWanted } from "./handlers/wanted.js";
import { registerMissionsHandlers, initMissions } from "./handlers/missions.js";
import { registerSphereHandlers, initSphere } from "./handlers/sphere.js";
import { registerSignalementsHandlers, initSignalements } from "./handlers/signalements.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(ROOT, { extensions: ["html"] }));

initLogs(io);
initWhitelist(io);
initPourfendeurs(io);
initWanted(io);
initMissions(io);
initSphere(io);
initSignalements(io);

io.on("connection", (socket) => {
  socket.session = null;

  registerWhitelistHandlers(io, socket);
  registerAuditHandlers(io, socket);
  registerPourfendeursHandlers(io, socket);
  registerWantedHandlers(io, socket);
  registerMissionsHandlers(io, socket);
  registerSphereHandlers(io, socket);
  registerSignalementsHandlers(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Codex Obscura — serveur en écoute sur le port ${PORT}`);
});
