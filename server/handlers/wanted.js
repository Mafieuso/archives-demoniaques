import { makeEntityHandlers } from "./entityFactory.js";
import { isAdminOrSphereAdmin } from "../auth.js";

/* Règle métier reprise telle quelle du client : si le score de danger
   change d'au moins 25 points ou que le grade change lors d'une édition,
   la fiche est automatiquement marquée "Contestée", quel que soit le
   statut de fiabilité choisi dans le formulaire. */
function beforeSave(doc, old){
  if(old && (Math.abs((old.dangerScore || 0) - (doc.dangerScore || 0)) >= 25 || old.grade !== doc.grade)){
    doc.verifStatus = "conteste";
  }
  return doc;
}

/* Même traitement que pourfendeurs.js : une photo uploadée (data URI) ne
   part plus dans la diffusion, seulement sa présence ; une URL externe
   collée reste telle quelle (déjà légère). */
function sanitizeForBroadcast(doc){
  const { photo, ...rest } = doc;
  const isData = photo?.startsWith("data:");
  return { ...rest, hasPhoto: !!photo, photo: isData ? undefined : photo };
}

const handlers = makeEntityHandlers({
  collectionName: "wanted",
  socketName: "wanted",
  nameField: (doc) => `${doc.prenom || ""} ${doc.nom || ""}`.trim() || "?",
  createRequiresRole: isAdminOrSphereAdmin,
  beforeSave,
  sanitizeForBroadcast
});

export const initWanted = handlers.init;
export const registerWantedHandlers = handlers.register;
