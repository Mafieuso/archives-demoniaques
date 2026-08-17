/* Jetons de session (JWT) sans état — le client les garde dans localStorage
   et les renvoie à chaque connexion socket ; aucune session n'est stockée
   côté serveur, donc un redémarrage (mise en veille du forfait gratuit
   Render) ne déconnecte jamais personne silencieusement. */
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
if(!SECRET){
  console.warn("ATTENTION : JWT_SECRET n'est pas défini — utilisation d'un secret de développement non sûr.");
}
const EFFECTIVE_SECRET = SECRET || "dev-secret-ne-pas-utiliser-en-production";
const EXPIRES_IN = "30d";

export function signEditorToken(entry){
  return jwt.sign(
    { steamId: entry.steamId, name: entry.name, roles: entry.roles },
    EFFECTIVE_SECRET, { expiresIn: EXPIRES_IN }
  );
}

export function verifyToken(token){
  if(!token) return null;
  try{ return jwt.verify(token, EFFECTIVE_SECRET); }
  catch{ return null; }
}

const ROLE_PRIORITY = ["superadmin", "admin", "adminsphere", "accesplus", "sphere", "veilleur"];
export function topRole(roles){
  for(const r of ROLE_PRIORITY){ if(roles?.includes(r)) return r; }
  return roles?.[0] || null;
}

export function hasRole(session, role){
  return !!session && Array.isArray(session.roles) && session.roles.includes(role);
}
export function hasAnyRole(session, ...roles){
  return roles.some(r => hasRole(session, r));
}
export function isEditor(session){
  return !!session && Array.isArray(session.roles) && session.roles.length > 0;
}
export function isAdminTier(session){
  return hasAnyRole(session, "admin", "superadmin");
}
export function isAdminOrSphereAdmin(session){
  return hasAnyRole(session, "admin", "superadmin", "adminsphere");
}
export function canSeeSphere(session){
  return hasAnyRole(session, "sphere", "accesplus", "admin", "superadmin");
}
export function canCreateSphere(session){
  return isAdminTier(session);
}

/* Rôles qu'un adminsphere a le droit d'attribuer/retirer sur la liste
   blanche — il ne peut pas se donner ni donner à d'autres un rôle
   admin/superadmin/adminsphere/sphere. Admin et superadmin n'ont aucune
   restriction. */
const ADMINSPHERE_ASSIGNABLE_ROLES = ["veilleur"];
export function assignableRolesFor(session){
  if(isAdminTier(session)) return null; // null = aucune restriction
  if(hasRole(session, "adminsphere")) return ADMINSPHERE_ASSIGNABLE_ROLES;
  return [];
}
