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

/* Équivalent de sanitizeForBroadcast, exécuté par MongoDB lui-même : les
   data URI ne quittent jamais la base, seul le résumé léger est lu. */
const listPipeline = [
  { $match: { deleted: { $ne: true } } },
  { $addFields: {
    _plist: {
      $cond: [
        { $gt: [{ $size: { $cond: [{ $isArray: "$photos" }, "$photos", []] } }, 0] },
        "$photos",
        { $cond: [
          { $and: [{ $eq: [{ $type: "$photo" }, "string"] }, { $ne: ["$photo", ""] }] },
          [{ url: "$photo", position: { $ifNull: ["$photoPosition", 50] } }],
          []
        ] }
      ]
    }
  } },
  { $addFields: {
    photos: { $map: { input: "$_plist", as: "p", in: {
      position: { $ifNull: ["$$p.position", 50] },
      url: { $cond: [{ $regexMatch: { input: { $ifNull: ["$$p.url", ""] }, regex: "^data:" } }, "$$REMOVE", "$$p.url"] }
    } } },
    photoCount: { $size: "$_plist" }
  } },
  { $project: { _plist: 0, photo: 0 } }
];

const handlers = makeEntityHandlers({
  collectionName: "pourfendeurs",
  socketName: "pourfendeurs",
  nameField: (doc) => doc.nom || "?",
  sanitizeForBroadcast,
  listPipeline
});

export const initPourfendeurs = handlers.init;
export const registerPourfendeursHandlers = handlers.register;
