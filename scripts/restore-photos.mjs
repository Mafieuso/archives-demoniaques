/* Restauration des photos perdues des fiches Pourfendeurs.
 *
 * Principe : on ne touche QU'AUX fiches qui n'ont AUCUNE photo aujourd'hui, et on ne
 * fait que leur remettre la photo qu'elles avaient avant — jamais d'écrasement, jamais
 * de suppression. Sources, de la plus récente à la plus ancienne :
 *   1. le journal d'audit en base (collection « logs » : chaque MODIFICATION /
 *      SUPPRESSION y garde une copie de la fiche avant changement, photos comprises) ;
 *   2. la sauvegarde locale du journal   scripts/firestore-backup/logs.json (août) ;
 *   3. la sauvegarde locale des fiches   scripts/firestore-backup/pourfendeurs.json (août).
 *
 * Usage (par défaut : simulation, rien n'est écrit) :
 *   MONGODB_URI="mongodb+srv://..." node scripts/restore-photos.mjs
 *   MONGODB_URI="..." node scripts/restore-photos.mjs --apply
 *   MONGODB_URI="..." node scripts/restore-photos.mjs --apply --only "Keishii,Megumii"
 *
 * Le site met jusqu'à 5 minutes à afficher les photos remises (cache du serveur).
 */
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "firestore-backup");

export function photosOf(d){
  if(!d) return [];
  const list = Array.isArray(d.photos) && d.photos.length ? d.photos : (d.photo ? [{ url: d.photo, position: d.photoPosition ?? 50 }] : []);
  return list.filter(p => p && typeof p.url === "string" && p.url.length > 0).map(p => ({ url: p.url, position: p.position ?? 50 }));
}
function toDate(v){
  if(!v) return null;
  if(v instanceof Date) return v;
  if(v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
function readJson(file){
  const p = path.join(BACKUP_DIR, file);
  if(!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Array.isArray(raw) ? raw : Object.values(raw);
}

/* Fonction pure (testable) : calcule ce qu'il y a à restaurer.
   current : fiches actuelles ; sources : [{label, date, doc}] déjà triées de la plus récente à la plus ancienne. */
export function planRestore(current, sources){
  const plan = [];
  for(const cur of current){
    if(cur.deleted) continue;
    if(photosOf(cur).length) continue; // elle a déjà au moins une photo : on n'y touche pas
    const found = sources.find(s => String(s.doc._id || s.doc.id) === String(cur._id) && photosOf(s.doc).length);
    if(found) plan.push({ id: cur._id, nom: cur.nom || found.doc.nom || "?", photos: photosOf(found.doc), source: found.label, date: found.date });
  }
  return plan;
}

async function main(){
  const apply = process.argv.includes("--apply");
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > -1 ? process.argv[onlyArg + 1].split(",").map(s => s.trim().toLowerCase()) : null;
  const uri = process.env.MONGODB_URI;
  if(!uri){ console.error("MONGODB_URI n'est pas défini (voir l'en-tête du script)."); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  try{
    const current = await db.collection("pourfendeurs").find({ deleted: { $ne: true } }).toArray();
    console.log(`Fiches actuelles : ${current.length} · sans aucune photo : ${current.filter(c => !photosOf(c).length).length}`);

    const sources = [];
    const dbLogs = await db.collection("logs").find({ collection: "pourfendeurs", snapshot: { $ne: null } }).sort({ date: -1 }).toArray();
    dbLogs.forEach(l => sources.push({ label: `journal en base (${l.action})`, date: toDate(l.date), doc: l.snapshot }));
    readJson("logs.json").filter(l => l.collection === "pourfendeurs" && l.snapshot)
      .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
      .forEach(l => sources.push({ label: `sauvegarde du journal (${l.action})`, date: toDate(l.date), doc: l.snapshot }));
    readJson("pourfendeurs.json").forEach(d => sources.push({ label: "sauvegarde des fiches (août)", date: null, doc: d }));
    console.log(`Sources de photos : ${dbLogs.length} dans le journal en base + sauvegardes locales`);

    let plan = planRestore(current, sources);
    if(only) plan = plan.filter(p => only.includes(p.nom.toLowerCase()));
    if(!plan.length){ console.log("\nRien à restaurer."); return; }

    console.log(`\n${plan.length} fiche(s) à restaurer :`);
    plan.forEach(p => console.log(` - ${p.nom} : ${p.photos.length} photo(s) · ${Math.round(JSON.stringify(p.photos).length / 1024)} Ko · source : ${p.source}${p.date ? " du " + p.date.toLocaleDateString("fr-FR") : ""}`));

    if(!apply){ console.log("\nSimulation uniquement. Relance avec --apply pour écrire."); return; }

    const report = [];
    for(const p of plan){
      const r = await db.collection("pourfendeurs").updateOne(
        { _id: p.id }, { $set: { photos: p.photos, photosRestoredAt: new Date() } });
      report.push({ id: p.id, nom: p.nom, source: p.source, modified: r.modifiedCount });
      console.log(`   ✔ ${p.nom} (${r.modifiedCount ? "restaurée" : "inchangée"})`);
    }
    fs.writeFileSync(path.join(BACKUP_DIR, "restore-photos-report.json"), JSON.stringify(report, null, 2));
    console.log("\nTerminé. Rapport : scripts/firestore-backup/restore-photos-report.json");
  }finally{ await client.close(); }
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
