import { makeEntityHandlers } from "./entityFactory.js";

/* Les photos (base64, jusqu'à 5 par fiche) sont ce qui rend un document
   pourfendeurs lourd — jusqu'à ~100-150 Ko chacune. Diffusées telles
   quelles à chaque changement pour 124+ fiches, ça faisait un message
   Socket.io de plus de 14 Mo renvoyé à tout le monde à chaque simple
   modification. On remplace les data URI (upload) par une référence légère
   servie à la demande via /photo/pourfendeurs/:id/:idx (voir
   server/photos.js) ; les URL externes collées telles quelles (déjà
   légères) restent inchangées. */
function sanitizeForBroadcast(doc){
  const { photos, photo, ...rest } = doc;
  const list = Array.isArray(photos) && photos.length ? photos : (photo ? [{ url: photo, position: doc.photoPosition ?? 50 }] : []);
  const photosMeta = list.map(p => p.url?.startsWith("data:")
    ? { position: p.position ?? 50 }
    : { position: p.position ?? 50, url: p.url });
  return { ...rest, photos: photosMeta, photoCount: photosMeta.length };
}

const handlers = makeEntityHandlers({
  collectionName: "pourfendeurs",
  socketName: "pourfendeurs",
  nameField: (doc) => doc.nom || "?",
  sanitizeForBroadcast
});

export const initPourfendeurs = handlers.init;
export const registerPourfendeursHandlers = handlers.register;
