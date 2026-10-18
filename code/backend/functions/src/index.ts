import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions";

// Region is unconfirmed (see README "Open questions"); us-central1 is the default.
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

initializeApp();

export { createSession } from "./createSession.js";
export { saveProfile } from "./profile.js";
export { redeemLinkToken } from "./redeemLinkToken.js";
export { deleteAccount } from "./deleteAccount.js";
export { stopSession } from "./sessions/stopSession.js";
export { reportCallEnded } from "./sessions/reportCallEnded.js";
export { reportCallActive } from "./sessions/reportCallActive.js";
export { discardSession } from "./sessions/discardSession.js";
export { stopDueSessions } from "./jobs/stopDueSessions.js";
export { callWatchdog } from "./jobs/callWatchdog.js";
export { cleanupEndedSessions } from "./jobs/cleanupEndedSessions.js";
export { purgeEndedSessions } from "./jobs/purgeEndedSessions.js";
