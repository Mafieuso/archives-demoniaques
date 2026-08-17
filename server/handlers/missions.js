import { makeEntityHandlers } from "./entityFactory.js";
import { isAdminOrSphereAdmin } from "../auth.js";

const handlers = makeEntityHandlers({
  collectionName: "missions",
  socketName: "missions",
  nameField: (doc) => doc.titre || "?",
  createRequiresRole: isAdminOrSphereAdmin
});

export const initMissions = handlers.init;
export const registerMissionsHandlers = handlers.register;
