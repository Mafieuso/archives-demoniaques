import { makeEntityHandlers } from "./entityFactory.js";

const handlers = makeEntityHandlers({
  collectionName: "pourfendeurs",
  socketName: "pourfendeurs",
  nameField: (doc) => doc.nom || "?"
});

export const initPourfendeurs = handlers.init;
export const registerPourfendeursHandlers = handlers.register;
