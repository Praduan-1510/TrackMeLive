/**
 * ViewerBackend on the Firebase JS SDK: Auth (the custom sign-in redeemLinkToken mints), Firestore
 * (the session and its pings, live) and the redeemLinkToken callable. The only file that imports the
 * SDK, through its modular entry points, and only by dynamic import on a real share link, so the
 * review page and the sample never load it. Auth without a popup or redirect resolver keeps the
 * sign-in code small; the page never opens a sign-in window.
 */

import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import {
  CALLABLES,
  collectionPaths,
  docPaths,
  isViewerRole,
  type RedeemLinkTokenRequest,
  type RedeemLinkTokenResponse,
} from '@tml/shared/schema/generated/ts/schema';
import { BackendError, type Redeemed, type ViewerBackend } from '../backend';
import type { SessionPing } from '../source';
import type { FirebaseTarget } from './config';
import { toBackendError } from './errors';

/** Signing in with the minted token: again after a moment if the network blinks, so the first browser keeps its role. */
const SIGN_IN_RETRY_MS = [500, 1500] as const;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function connect(target: FirebaseTarget): ViewerBackend {
  const app = initializeApp(target.options);
  // IndexedDB keeps the sign-in across reloads, so a refresh keeps the viewer's role; private
  // windows that refuse it fall back to localStorage, then to memory.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence] });
  const db = initializeFirestore(app, {});
  const functions = getFunctions(app, target.region);
  const em = target.emulators;
  if (em) {
    connectAuthEmulator(auth, `http://${em.host}:${String(em.auth)}`, { disableWarnings: true });
    connectFirestoreEmulator(db, em.host, em.firestore);
    connectFunctionsEmulator(functions, em.host, em.functions);
  }
  const redeemCall = httpsCallable<RedeemLinkTokenRequest, RedeemLinkTokenResponse>(functions, CALLABLES.redeemLinkToken);

  async function callRedeem(token: string): Promise<RedeemLinkTokenResponse> {
    try {
      return (await redeemCall({ link_token: token })).data;
    } catch (err) {
      const e = toBackendError(err);
      // A sign-in this browser kept that no longer stands: trade the link as a new browser.
      if (e.code !== 'unauthenticated' || !auth.currentUser) throw e;
      await signOut(auth);
      try {
        return (await redeemCall({ link_token: token })).data;
      } catch (again) {
        throw toBackendError(again);
      }
    }
  }

  async function signIn(customToken: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await signInWithCustomToken(auth, customToken);
        return;
      } catch (err) {
        const pause = SIGN_IN_RETRY_MS[attempt];
        if (pause === undefined) throw toBackendError(err);
        await wait(pause);
      }
    }
  }

  const sessionRef = (sessionId: string) => doc(db, docPaths.shareSession(sessionId));

  return {
    async redeem(token: string): Promise<Redeemed> {
      // The callable sends this browser's current sign-in, if it has one: a refresh keeps its role.
      await auth.authStateReady();
      const r = await callRedeem(token);
      if (typeof r.session_id !== 'string' || typeof r.custom_token !== 'string' || !isViewerRole(r.role)) {
        throw new BackendError('other', 'redeemLinkToken answered with something unexpected');
      }
      await signIn(r.custom_token);
      return { sessionId: r.session_id, role: r.role };
    },

    watchSession(sessionId, watch) {
      return onSnapshot(
        sessionRef(sessionId),
        // Metadata changes too: they say when snapshots start or stop coming from the cache only.
        { includeMetadataChanges: true },
        (snap) => {
          watch.next(snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null, snap.metadata.fromCache);
        },
        (err) => {
          watch.error(toBackendError(err));
        },
      );
    },

    watchPings(sessionId, count, watch) {
      const newest = query(collection(db, collectionPaths.ping(sessionId)), orderBy('recorded_at', 'desc'), limit(count));
      return onSnapshot(
        newest,
        (snap) => {
          watch.next(
            snap.docs.map((d) => d.data({ serverTimestamps: 'estimate' })),
            snap.metadata.fromCache,
          );
        },
        (err) => {
          watch.error(toBackendError(err));
        },
      );
    },

    async writeViewerPing(sessionId: string, ping: SessionPing, first: boolean): Promise<void> {
      const batch = writeBatch(db);
      batch.set(doc(collection(db, collectionPaths.viewerPing(sessionId))), {
        lat: ping.lat,
        lng: ping.lng,
        accuracy_m: ping.accuracy_m,
        recorded_at: Timestamp.fromDate(ping.recorded_at),
      });
      if (first) batch.update(sessionRef(sessionId), { viewer_sharing: true });
      try {
        await batch.commit();
      } catch (err) {
        throw toBackendError(err);
      }
    },

    async stopViewerSharing(sessionId: string): Promise<void> {
      try {
        await updateDoc(sessionRef(sessionId), { viewer_sharing: false });
      } catch (err) {
        throw toBackendError(err);
      }
    },
  };
}
