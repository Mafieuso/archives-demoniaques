/* Accès MongoDB côté serveur uniquement (chaîne de connexion secrète —
   variable d'env Render, jamais présente dans le dépôt public). Remplace
   Firestore : plus aucune lecture/écriture directe depuis le navigateur. */
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";

let client = null;
let dbInstance = null;

export async function getDb(){
  if(dbInstance) return dbInstance;
  const uri = process.env.MONGODB_URI;
  if(!uri){
    throw new Error("MONGODB_URI n'est pas défini (variable d'environnement Render).");
  }
  client = new MongoClient(uri);
  await client.connect();
  dbInstance = client.db();
  return dbInstance;
}

export function newId(){
  return randomUUID();
}
