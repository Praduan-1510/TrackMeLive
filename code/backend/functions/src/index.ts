import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions";

// Region is unconfirmed (see README "Open questions"); us-central1 is the default.
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

initializeApp();

export { createSession } from "./createSession.js";
