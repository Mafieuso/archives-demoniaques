/* Signalements utilisateur (fiche périmée/erronée) — pas de suppression
   douce ici, juste un statut ouvert/résolu/ignoré comme dans l'app
   d'origine. */
import { getDb, newId } from "../db.js";
import { isEditor, isAdminOrSphereAdmin } from "../auth.js";
import { logAction } from "./logs.js";
import { registerBroadcaster } from "./entityRegistry.js";

const ROOM = "room:signalements";
let ioRef = null;

async function broadcastState(){
  if(!ioRef) return;
  const db = await getDb();
  const items = await db.collection("signalements").find({}).sort({ date: -1 }).toArray();
  ioRef.to(ROOM).emit("signalements:state", items);
}
registerBroadcaster("signalements", broadcastState);

export function initSignalements(io){ ioRef = io; }

export function registerSignalementsHandlers(io, socket){
  socket.on("signalements:join", async (_arg, cb) => {
    socket.join(ROOM);
    const db = await getDb();
    const items = await db.collection("signalements").find({}).sort({ date: -1 }).toArray();
    cb?.({ ok: true, items });
  });
  socket.on("signalements:leave", () => { socket.leave(ROOM); });

  socket.on("signalements:submit", async ({ collection, targetId, targetName, reason } = {}, cb) => {
    try{
      if(!isEditor(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
      if(!["pourfendeurs", "wanted"].includes(collection)) return cb?.({ ok: false, error: "Collection invalide." });
      const db = await getDb();
      const doc = {
        _id: newId(), collection, targetId, targetName, reason,
        status: "ouvert",
        reportedBy: socket.session.steamId, reportedByName: socket.session.name,
        date: new Date()
      };
      await db.collection("signalements").insertOne(doc);
      await logAction(db, {
        steamId: socket.session.steamId, userName: socket.session.name, action: "SIGNALEMENT",
        target: targetName, snapshot: null, collection: "signalements"
      });
      await broadcastState();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("signalements:resolve", async (id, cb) => {
    try{
      if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
      const db = await getDb();
      await db.collection("signalements").updateOne({ _id: id }, { $set: { status: "resolu", resolvedAt: new Date(), resolvedBy: socket.session.steamId } });
      await broadcastState();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("signalements:dismiss", async (id, cb) => {
    try{
      if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
      const db = await getDb();
      await db.collection("signalements").updateOne({ _id: id }, { $set: { status: "ignore", resolvedAt: new Date(), resolvedBy: socket.session.steamId } });
      await broadcastState();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
