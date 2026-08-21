/* Liste blanche + connexion. La connexion se fait désormais uniquement via
   Steam (voir steamAuth.js) — plus de code secret à retenir, deviner ou
   réinitialiser : l'identité est prouvée par Steam lui-même, l'autorisation
   reste conditionnée à la présence du Steam ID dans cette liste. */
import { getDb } from "../db.js";
import { signEditorToken, verifyToken, topRole, isAdminOrSphereAdmin, isAdminTier, assignableRolesFor } from "../auth.js";
import { logAction } from "./logs.js";
import { exchangeSteamCode } from "../steamAuth.js";

const ROOM = "room:whitelist";
let ioRef = null;
export function initWhitelist(io){ ioRef = io; }

async function broadcastWhitelist(){
  if(!ioRef) return;
  const db = await getDb();
  const items = await db.collection("whitelist").find({}, { projection: { codeHash: 0 } }).toArray();
  ioRef.to(ROOM).emit("whitelist:state", items);
}

function toEntry(doc){
  return { steamId: doc._id, name: doc.name, roles: doc.roles || (doc.role ? [doc.role] : []) };
}

export function registerWhitelistHandlers(io, socket){
  /* ── Connexion via Steam (public — pas besoin d'être déjà authentifié) ── */
  socket.on("auth:steamLogin", async (code, cb) => {
    try{
      const steamId = exchangeSteamCode(code);
      if(!steamId) return cb?.({ ok: false, error: "Code de connexion Steam invalide ou expiré — réessaie." });
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: steamId });
      if(!doc) return cb?.({ ok: false, error: "Ce compte Steam n'est pas autorisé." });
      const entry = toEntry(doc);
      socket.session = entry;
      await logAction(db, { steamId: doc._id, userName: doc.name, action: "CONNEXION", target: doc.name, snapshot: null, collection: null });
      cb?.({ ok: true, token: signEditorToken(entry), steamId: entry.steamId, name: entry.name, roles: entry.roles });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("auth:token", async (token, cb) => {
    try{
      const decoded = verifyToken(token);
      if(!decoded) return cb?.({ ok: false });
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: decoded.steamId });
      if(!doc) { socket.session = null; return cb?.({ ok: false }); } // révoqué depuis
      const entry = toEntry(doc);
      socket.session = entry;
      cb?.({ ok: true, session: entry, token: signEditorToken(entry) });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("auth:logout", () => { socket.session = null; });

  /* ── Gestion de la liste blanche (admin / superadmin / adminsphere) ── */
  socket.on("whitelist:join", async (_arg, cb) => {
    if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Réservé au personnel autorisé." });
    socket.join(ROOM);
    const db = await getDb();
    const items = await db.collection("whitelist").find({}, { projection: { codeHash: 0 } }).toArray();
    cb?.({ ok: true, items });
  });
  socket.on("whitelist:leave", () => { socket.leave(ROOM); });

  socket.on("whitelist:add", async ({ steamId, name, roles } = {}, cb) => {
    try{
      if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
      const allowed = assignableRolesFor(socket.session);
      const finalRoles = Array.isArray(roles) ? roles : [];
      if(allowed && finalRoles.some(r => !allowed.includes(r))) return cb?.({ ok: false, error: "Tu ne peux attribuer que le rôle Veilleur." });
      const db = await getDb();
      const id = String(steamId || "").trim();
      if(!id || !name) return cb?.({ ok: false, error: "Steam ID et nom requis." });
      const existing = await db.collection("whitelist").findOne({ _id: id });
      if(existing) return cb?.({ ok: false, error: "Ce Steam ID est déjà sur la liste." });
      await db.collection("whitelist").insertOne({
        _id: id, name, roles: finalRoles, role: topRole(finalRoles),
        addedAt: new Date(), addedBy: socket.session.steamId
      });
      await logAction(db, { steamId: socket.session.steamId, userName: socket.session.name, action: "AUTORISATION", target: name, snapshot: null, collection: "whitelist" });
      await broadcastWhitelist();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("whitelist:changeRole", async ({ steamId, roles } = {}, cb) => {
    try{
      if(!isAdminOrSphereAdmin(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
      const allowed = assignableRolesFor(socket.session);
      const finalRoles = Array.isArray(roles) ? roles : [];
      if(allowed && finalRoles.some(r => !allowed.includes(r))) return cb?.({ ok: false, error: "Tu ne peux attribuer que le rôle Veilleur." });
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: steamId });
      if(!doc) return cb?.({ ok: false, error: "Introuvable." });
      await db.collection("whitelist").updateOne({ _id: steamId }, { $set: { roles: finalRoles, role: topRole(finalRoles) } });
      await logAction(db, { steamId: socket.session.steamId, userName: socket.session.name, action: "AUTORISATION", target: doc.name, snapshot: null, collection: "whitelist" });
      await broadcastWhitelist();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("whitelist:remove", async (steamId, cb) => {
    try{
      if(!isAdminTier(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: steamId });
      if(!doc) return cb?.({ ok: false, error: "Introuvable." });
      await db.collection("whitelist").deleteOne({ _id: steamId });
      await logAction(db, { steamId: socket.session.steamId, userName: socket.session.name, action: "RÉVOCATION", target: doc.name, snapshot: null, collection: "whitelist" });
      await broadcastWhitelist();
      cb?.({ ok: true });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });
}
