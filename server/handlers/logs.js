/* Journal d'audit — écrit par (presque) toutes les autres actions via
   logAction(). Conserve le comportement d'origine : les 80 dernières
   entrées seulement (voir SETUP.md pour la limite et pourquoi on la garde
   telle quelle pour l'instant). */
import { getDb, newId } from "../db.js";
import { isAdminOrSphereAdmin } from "../auth.js";
import { broadcastCollection } from "./entityRegistry.js";

const LOG_LIMIT = 80;

let ioRef = null;
export function initLogs(io){ ioRef = io; }

export async function logAction(db, { steamId, userName, action, target, snapshot = null, collection = null }){
  await db.collection("logs").insertOne({
    _id: newId(), steamId, userName, action, target, snapshot, collection, date: new Date()
  });
  await broadcastLogs();
}

async function broadcastLogs(){
  if(!ioRef) return;
  const db = await getDb();
  const items = await db.collection("logs").find({}).sort({ date: -1 }).limit(LOG_LIMIT).toArray();
  ioRef.to("room:logs").emit("logs:state", items);
}

export function registerAuditHandlers(io, socket){
  socket.on("logs:join", async (_arg, cb) => {
    if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au personnel autorisé." });
    socket.join("room:logs");
    const db = await getDb();
    const items = await db.collection("logs").find({}).sort({ date: -1 }).limit(LOG_LIMIT).toArray();
    cb?.({ ok: true, items });
  });
  socket.on("logs:leave", () => { socket.leave("room:logs"); });

  socket.on("logs:restore", async (logId, cb) => {
    try{
      if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au personnel autorisé." });
      const db = await getDb();
      const entry = await db.collection("logs").findOne({ _id: logId });
      if(!entry || !entry.snapshot || !entry.collection) return cb?.({ ok: false, error: "Rien à restaurer pour cette entrée." });
      const col = db.collection(entry.collection);
      const snap = { ...entry.snapshot };
      if(entry.action === "MODIFICATION"){
        const id = snap._id;
        delete snap._id;
        await col.updateOne({ _id: id }, { $set: { ...snap, restoredAt: new Date(), restoredBy: socket.session.steamId } });
      }else if(entry.action === "SUPPRESSION"){
        delete snap._id;
        delete snap.deleted; delete snap.deletedAt; delete snap.deletedBy;
        await col.insertOne({ ...snap, _id: newId(), restoredAt: new Date(), restoredBy: socket.session.steamId });
      }else{
        return cb?.({ ok: false, error: "Cette entrée n'est pas restaurable." });
      }
      await logAction(db, {
        steamId: socket.session.steamId, userName: socket.session.name, action: "RESTAURATION",
        target: entry.target, snapshot: null, collection: entry.collection
      });
      await broadcastCollection(entry.collection);
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
