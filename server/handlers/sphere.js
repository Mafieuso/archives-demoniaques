import { makeEntityHandlers } from "./entityFactory.js";
import { isAdminTier } from "../auth.js";

/* targetId ("p_<id>" ou "w_<id>") pointe vers une fiche pourfendeurs/wanted
   existante : on relit la fiche côté serveur pour figer un instantané
   (nom/grade/photo/motif) au moment de l'enregistrement, plutôt que de
   faire confiance à ce que le client prétend avoir vu — même résultat que
   la dénormalisation faite côté client avant la migration, juste vérifié. */
async function beforeSave(doc, _old, _session, db){
  if(doc.targetId){
    const [prefix, id] = String(doc.targetId).split("_");
    const col = prefix === "p" ? "pourfendeurs" : prefix === "w" ? "wanted" : null;
    if(col){
      const target = await db.collection(col).findOne({ _id: id });
      if(target){
        doc.targetName = col === "pourfendeurs" ? target.nom : `${target.prenom || ""} ${target.nom || ""}`.trim();
        doc.targetGrade = col === "pourfendeurs" ? target.rang : target.grade;
        doc.targetPhoto = col === "pourfendeurs" ? (target.photos?.[0]?.url || target.photo || null) : (target.photo || null);
        doc.targetRaison = target.raison || target.info || null;
      }
    }
  }
  return doc;
}

const handlers = makeEntityHandlers({
  collectionName: "sphere",
  socketName: "sphere",
  nameField: (doc) => doc.targetName || doc.type || "?",
  createRequiresRole: isAdminTier,
  requireRoleForAll: isAdminTier,
  beforeSave
});

export const initSphere = handlers.init;
export const registerSphereHandlers = handlers.register;
