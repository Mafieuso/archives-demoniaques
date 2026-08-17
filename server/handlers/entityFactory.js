/* Fabrique commune pour les collections à fiches (pourfendeurs, wanted,
   missions, sphere) : même forme de CRUD partout (créer/éditer, suppression
   douce, "revérifié"), même diffusion de l'état complet à chaque
   changement — c'est exactement ce que faisaient les onSnapshot() Firestore
   côté client, juste recentré sur le serveur pour ne plus retélécharger
   des collections entières à chaque frappe. */
import { getDb, newId } from "../db.js";
import { isEditor } from "../auth.js";
import { logAction } from "./logs.js";
import { registerBroadcaster } from "./entityRegistry.js";

export function makeEntityHandlers({ collectionName, socketName, nameField, createRequiresRole, requireRoleForAll, beforeSave, sanitizeForBroadcast }){
  let ioRef = null;
  const room = `room:${socketName}`;

  async function activeItems(db){
    const docs = await db.collection(collectionName).find({ deleted: { $ne: true } }).toArray();
    return sanitizeForBroadcast ? docs.map(sanitizeForBroadcast) : docs;
  }
  async function broadcastState(){
    if(!ioRef) return;
    const db = await getDb();
    const items = await activeItems(db);
    ioRef.to(room).emit(`${socketName}:state`, items);
  }
  registerBroadcaster(collectionName, broadcastState);

  function init(io){ ioRef = io; }

  function register(io, socket){
    socket.on(`${socketName}:join`, async (_arg, cb) => {
      socket.join(room);
      const db = await getDb();
      cb?.({ ok: true, items: await activeItems(db) });
    });
    socket.on(`${socketName}:leave`, () => { socket.leave(room); });

    /* Fiche complète (avec champs lourds éventuels type photos en base64) —
       utilisé uniquement à l'ouverture d'un formulaire d'édition, jamais
       diffusé à tout le monde. */
    socket.on(`${socketName}:get`, async (id, cb) => {
      const db = await getDb();
      const doc = await db.collection(collectionName).findOne({ _id: id, deleted: { $ne: true } });
      if(!doc) return cb?.({ ok: false, error: "Fiche introuvable." });
      cb?.({ ok: true, item: doc });
    });

    socket.on(`${socketName}:save`, async (payload, cb) => {
      try{
        if(!isEditor(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
        if(requireRoleForAll && !requireRoleForAll(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
        const db = await getDb();
        const col = db.collection(collectionName);
        const id = payload?._id || null;
        let old = null;
        if(id){
          old = await col.findOne({ _id: id });
          if(!old) return cb?.({ ok: false, error: "Fiche introuvable." });
        }else if(createRequiresRole && !createRequiresRole(socket.session)){
          return cb?.({ ok: false, error: "Rôle insuffisant pour créer une fiche." });
        }
        let doc = { ...payload };
        delete doc._id; delete doc.createdAt; delete doc.createdBy; delete doc.deleted; delete doc.deletedAt; delete doc.deletedBy;
        if(beforeSave) doc = await beforeSave(doc, old, socket.session, db);
        doc.updatedAt = new Date();
        doc.updatedBy = socket.session.steamId;

        if(id){
          await col.updateOne({ _id: id }, { $set: doc });
          await logAction(db, {
            steamId: socket.session.steamId, userName: socket.session.name, action: "MODIFICATION",
            target: nameField({ ...old, ...doc }), snapshot: old, collection: collectionName
          });
        }else{
          doc._id = newId();
          doc.createdAt = doc.updatedAt;
          doc.createdBy = doc.updatedBy;
          await col.insertOne(doc);
          await logAction(db, {
            steamId: socket.session.steamId, userName: socket.session.name, action: "CRÉATION",
            target: nameField(doc), snapshot: null, collection: collectionName
          });
        }
        await broadcastState();
        cb?.({ ok: true, id: id || doc._id });
      }catch(e){ cb?.({ ok: false, error: e.message }); }
    });

    socket.on(`${socketName}:delete`, async (id, cb) => {
      try{
        if(!isEditor(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
        if(requireRoleForAll && !requireRoleForAll(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
        const db = await getDb();
        const col = db.collection(collectionName);
        const old = await col.findOne({ _id: id });
        if(!old) return cb?.({ ok: false, error: "Fiche introuvable." });
        await col.updateOne({ _id: id }, { $set: { deleted: true, deletedAt: new Date(), deletedBy: socket.session.steamId } });
        await logAction(db, {
          steamId: socket.session.steamId, userName: socket.session.name, action: "SUPPRESSION",
          target: nameField(old), snapshot: old, collection: collectionName
        });
        await broadcastState();
        cb?.({ ok: true });
      }catch(e){ cb?.({ ok: false, error: e.message }); }
    });

    socket.on(`${socketName}:reverify`, async (id, cb) => {
      try{
        if(!isEditor(socket.session)) return cb?.({ ok: false, error: "Non connecté." });
        if(requireRoleForAll && !requireRoleForAll(socket.session)) return cb?.({ ok: false, error: "Rôle insuffisant." });
        const db = await getDb();
        const col = db.collection(collectionName);
        const old = await col.findOne({ _id: id });
        if(!old) return cb?.({ ok: false, error: "Fiche introuvable." });
        const updatedAt = new Date();
        await col.updateOne({ _id: id }, { $set: { updatedAt, updatedBy: socket.session.steamId } });
        await logAction(db, {
          steamId: socket.session.steamId, userName: socket.session.name, action: "VÉRIFICATION",
          target: nameField(old), snapshot: null, collection: collectionName
        });
        await broadcastState();
        cb?.({ ok: true });
      }catch(e){ cb?.({ ok: false, error: e.message }); }
    });
  }

  return { init, register, broadcastState };
}
