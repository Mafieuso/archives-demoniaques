/* Sert les photos individuellement (route HTTP normale, pas Socket.io) au
   lieu de les embarquer dans les diffusions d'état — c'est ce qui évite de
   renvoyer des mégaoctets de base64 à tout le monde à chaque changement.
   Le navigateur met ces réponses en cache lui-même (Cache-Control), donc
   une photo n'est vraiment retéléchargée qu'une fois par appareil tant que
   son contenu ne change pas. */
import { getDb } from "../db.js";

function sendDataUri(res, dataUri){
  if(!dataUri || !dataUri.startsWith("data:")) return res.status(404).end();
  const match = dataUri.match(/^data:([^;]+);base64,(.*)$/s);
  if(!match) return res.status(404).end();
  const [, mime, b64] = match;
  const buf = Buffer.from(b64, "base64");
  res.set("Content-Type", mime);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buf);
}

async function photoFromArrayField(db, collectionName, id, idx){
  const doc = await db.collection(collectionName).findOne({ _id: id }, { projection: { photos: 1, photo: 1, photoPosition: 1 } });
  if(!doc) return null;
  const list = Array.isArray(doc.photos) && doc.photos.length ? doc.photos : (doc.photo ? [{ url: doc.photo }] : []);
  return list[idx]?.url || null;
}

export function registerPhotoRoutes(app){
  app.get("/photo/pourfendeurs/:id/:idx?", async (req, res) => {
    const db = await getDb();
    const uri = await photoFromArrayField(db, "pourfendeurs", req.params.id, parseInt(req.params.idx || "0", 10));
    sendDataUri(res, uri);
  });

  app.get("/photo/wanted/:id", async (req, res) => {
    const db = await getDb();
    const doc = await db.collection("wanted").findOne({ _id: req.params.id }, { projection: { photo: 1 } });
    sendDataUri(res, doc?.photo);
  });

  app.get("/photo/sphere/:id", async (req, res) => {
    const db = await getDb();
    const doc = await db.collection("sphere").findOne({ _id: req.params.id }, { projection: { targetPhoto: 1 } });
    sendDataUri(res, doc?.targetPhoto);
  });
}
