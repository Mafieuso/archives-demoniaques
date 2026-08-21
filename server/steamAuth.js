/* Connexion via Steam (OpenID 2.0) — remplace le code secret pour tout le
   monde. L'accès reste conditionné à la liste blanche (un admin doit avoir
   ajouté le Steam ID au préalable) ; ce qui change, c'est la preuve
   d'identité : Steam lui-même, plutôt qu'un code que n'importe qui
   connaissant le Steam ID whitelisté pouvait tenter de deviner. Aucune clé
   API Steam nécessaire : on vérifie uniquement la signature OpenID renvoyée
   par Steam auprès de Steam lui-même. */
import { getDb } from "./db.js";
import { randomUUID } from "crypto";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

// Codes d'échange à usage unique, très courte durée de vie — le client
// les échange immédiatement contre un vrai token JWT via un socket, sans
// jamais faire transiter le JWT dans une URL (historique du navigateur,
// en-tête Referer, etc.).
const pendingCodes = new Map();
const CODE_TTL_MS = 30_000;

function realmAndReturnTo(req){
  const origin = `${req.protocol}://${req.get("host")}`;
  return { realm: origin, returnTo: `${origin}/auth/steam/return` };
}

export function registerSteamAuthRoutes(app){
  app.get("/auth/steam", (req, res) => {
    const { realm, returnTo } = realmAndReturnTo(req);
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": returnTo,
      "openid.realm": realm,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
    });
    res.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
  });

  app.get("/auth/steam/return", async (req, res) => {
    try{
      const rawQuery = req.originalUrl.split("?")[1] || "";
      const query = new URLSearchParams(rawQuery);

      if(query.get("openid.mode") !== "id_res"){
        return res.redirect("/?steamerror=1");
      }

      // Steam exige qu'on lui repasse exactement les mêmes paramètres pour
      // vérifier la signature — c'est ça qui empêche de forger un SteamID.
      const verifyParams = new URLSearchParams(rawQuery);
      verifyParams.set("openid.mode", "check_authentication");
      const verifyRes = await fetch(STEAM_OPENID_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verifyParams.toString()
      });
      const verifyText = await verifyRes.text();
      if(!/is_valid\s*:\s*true/.test(verifyText)){
        return res.redirect("/?steamerror=1");
      }

      const claimedId = query.get("openid.claimed_id") || "";
      const match = claimedId.match(/\/openid\/id\/(\d+)$/);
      if(!match) return res.redirect("/?steamerror=1");
      const steamId = match[1];

      const db = await getDb();
      const doc = await db.collection("whitelist").findOne({ _id: steamId });
      if(!doc){
        return res.redirect("/?steamerror=unregistered");
      }

      const code = randomUUID();
      pendingCodes.set(code, steamId);
      setTimeout(() => pendingCodes.delete(code), CODE_TTL_MS);

      res.redirect(`/?steamcode=${code}`);
    }catch(e){
      console.error("Vérification Steam OpenID échouée :", e);
      res.redirect("/?steamerror=1");
    }
  });
}

/* Usage unique : la première consommation invalide le code. */
export function exchangeSteamCode(code){
  if(!pendingCodes.has(code)) return null;
  const steamId = pendingCodes.get(code);
  pendingCodes.delete(code);
  return steamId;
}
