/* Petit registre partagé : chaque module d'entité (pourfendeurs, wanted,
   missions, sphere, signalements) enregistre sa fonction de broadcast ici,
   pour que logs.js puisse rafraîchir l'état envoyé aux clients après une
   restauration, sans dépendre directement de chaque module. */
const broadcasters = new Map();

export function registerBroadcaster(collectionName, fn){
  broadcasters.set(collectionName, fn);
}
export async function broadcastCollection(collectionName){
  const fn = broadcasters.get(collectionName);
  if(fn) await fn();
}
