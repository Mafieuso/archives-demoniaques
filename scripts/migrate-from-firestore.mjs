/* Migration ponctuelle Firestore → MongoDB.
 *
 * Utilise le SDK client Firebase (pas de clé de service admin nécessaire —
 * mêmes droits que l'app actuelle : connexion anonyme, exactement ce que
 * fait déjà le navigateur de tout visiteur). Récupère les 7 collections,
 * les sauvegarde en JSON local (par sécurité, avant tout import), puis les
 * insère dans MongoDB.
 *
 * Usage :
 *   MONGODB_URI="mongodb+srv://..." node scripts/migrate-from-firestore.mjs
 *   MONGODB_URI="..." node scripts/migrate-from-firestore.mjs --force   (écrase les collections déjà présentes en base)
 *
 * Dépendance non permanente : `npm install firebase --no-save` avant de lancer.
 */
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "firestore-backup");
const FORCE = process.argv.includes("--force");

const COLLECTIONS = ["pourfendeurs", "wanted", "missions", "sphere", "logs", "signalements", "whitelist"];

const firebaseConfig = {
  apiKey: "AIzaSyDHc5tFYxaWeGUkrxrGJAFjeEe1RJEJTHU",
  authDomain: "archives-demoniaques.firebaseapp.com",
  projectId: "archives-demoniaques",
  storageBucket: "archives-demoniaques.firebasestorage.app",
  messagingSenderId: "660726727180",
  appId: "1:660726727180:web:de33021940c7c8b0d8a429"
};

function convertValue(v){
  if(v && typeof v === "object" && typeof v.toDate === "function") return v.toDate();
  if(Array.isArray(v)) return v.map(convertValue);
  if(v && typeof v === "object" && !(v instanceof Date)) {
    const out = {};
    for(const [k, val] of Object.entries(v)) out[k] = convertValue(val);
    return out;
  }
  return v;
}

async function main(){
  const uri = process.env.MONGODB_URI;
  if(!uri){
    console.error("MONGODB_URI n'est pas défini. Exemple : MONGODB_URI=\"mongodb+srv://...\" node scripts/migrate-from-firestore.mjs");
    process.exit(1);
  }

  console.log("── Connexion à Firebase (identique à l'app actuelle) ──");
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInAnonymously(auth);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const dumped = {};
  for(const name of COLLECTIONS){
    console.log(`Lecture de la collection "${name}"…`);
    const snap = await getDocs(collection(db, name));
    const docs = snap.docs.map(d => {
      const data = convertValue(d.data());
      return { ...data, _id: d.id };
    });
    dumped[name] = docs;
    fs.writeFileSync(path.join(BACKUP_DIR, `${name}.json`), JSON.stringify(docs, null, 2), "utf8");
    console.log(`  → ${docs.length} document(s), sauvegardé dans scripts/firestore-backup/${name}.json`);
  }

  console.log("\n── Connexion à MongoDB ──");
  const client = new MongoClient(uri);
  await client.connect();
  const mongoDb = client.db();

  for(const name of COLLECTIONS){
    const docs = dumped[name];
    if(!docs.length){ console.log(`"${name}" : rien à importer.`); continue; }
    const col = mongoDb.collection(name);
    const existing = await col.countDocuments();
    if(existing > 0 && !FORCE){
      console.log(`"${name}" contient déjà ${existing} document(s) en base — ignoré (relance avec --force pour écraser).`);
      continue;
    }
    if(existing > 0 && FORCE){
      await col.deleteMany({});
      console.log(`"${name}" : ${existing} document(s) existant(s) effacé(s) (--force).`);
    }
    await col.insertMany(docs, { ordered: false });
    console.log(`"${name}" : ${docs.length} document(s) importé(s).`);
  }

  await client.close();
  console.log("\nMigration terminée. Sauvegarde JSON conservée dans scripts/firestore-backup/ au cas où.");
}

main().catch(e => { console.error("Échec de la migration :", e); process.exit(1); });
