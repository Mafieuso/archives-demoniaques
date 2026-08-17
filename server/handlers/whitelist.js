/* Liste blanche + connexion. Remplace le schéma "Steam ID → code secret →
   hash comparé côté client" par la même mécanique mais vérifiée côté
   serveur : le hash ne quitte plus jamais le serveur, et le "sel" fixe
   utilisé par l'ancienne version cliente est repris ici à l'identique pour
   que les codes déjà choisis par les utilisateurs continuent de fonctionner
   après la migration (personne n'a besoin de recréer son code). */
import crypto from "crypto";
import { getDb } from "../db.js";
import { signEditorToken, verifyToken, topRole, isAdminOrSphereAdmin, isAdminTier, assignableRolesFor } from "../auth.js";
import { logAction } from "./logs.js";

const LEGACY_SALT = "codex-obscura-sel-2024";
function hashCode(steamId, code){
  return crypto.createHash("sha256").update(`${steamId}:${code}:${LEGACY_SALT}`).digest("hex");
}

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
  /* ── Connexion (public — pas besoin d'être déjà authentifié) ── */
  socket.on("auth:checkSteamId", async (steamId, cb) => {
    try{
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: String(steamId || "").trim() });
      if(!doc) return cb?.({ ok: true, exists: false });
      cb?.({ ok: true, exists: true, hasCode: !!doc.codeHash, name: doc.name });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("auth:createCode", async ({ steamId, code } = {}, cb) => {
    try{
      if(!code || code.length < 4) return cb?.({ ok: false, error: "Le code doit contenir au moins 4 caractères." });
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: String(steamId || "").trim() });
      if(!doc) return cb?.({ ok: false, error: "Steam ID non autorisé." });
      if(doc.codeHash) return cb?.({ ok: false, error: "Un code existe déjà pour ce compte." });
      const codeHash = hashCode(doc._id, code);
      await db.collection("whitelist").updateOne({ _id: doc._id }, { $set: { codeHash } });
      const entry = toEntry({ ...doc, codeHash });
      socket.session = entry;
      await logAction(db, { steamId: doc._id, userName: doc.name, action: "CONNEXION", target: doc.name, snapshot: null, collection: null });
      cb?.({ ok: true, token: signEditorToken(entry), name: entry.name, roles: entry.roles });
    }catch(e){ cb?.({ ok: false, error: e.message }); }
  });

  socket.on("auth:verifyCode", async ({ steamId, code } = {}, cb) => {
    try{
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: String(steamId || "").trim() });
      if(!doc || !doc.codeHash) return cb?.({ ok: false, error: "Compte introuvable." });
      if(hashCode(doc._id, code) !== doc.codeHash) return cb?.({ ok: false, error: "Code incorrect." });
      const entry = toEntry(doc);
      socket.session = entry;
      await logAction(db, { steamId: doc._id, userName: doc.name, action: "CONNEXION", target: doc.name, snapshot: null, collection: null });
      cb?.({ ok: true, token: signEditorToken(entry), name: entry.name, roles: entry.roles });
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
        _id: id, name, roles: finalRoles, role: topRole(finalRoles), codeHash: null,
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

  socket.on("whitelist:resetCode", async (steamId, cb) => {
    try{
      if(!isAdminTier(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: steamId });
      if(!doc) return cb?.({ ok: false, error: "Introuvable." });
      await db.collection("whitelist").updateOne({ _id: steamId }, { $set: { codeHash: null } });
      await logAction(db, { steamId: socket.session.steamId, userName: socket.session.name, action: "RESET_CODE", target: doc.name, snapshot: null, collection: "whitelist" });
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
