/**
 * A second browser on the same link, at the protocol level: redeemLinkToken over the callable
 * protocol, signInWithCustomToken on the Auth emulator, then the session's pings over Firestore's REST
 * API with that sign-in. It asks the security rules directly whether a viewer can still read
 * locations, whatever any page shows. (Open the page first: the first browser to redeem becomes the
 * viewer, and this one should only watch.)
 */

import { authBase, firestoreBase, functionsBase, type EmulatorSet } from '../../fake-sharer/src/env.ts';

export interface Watcher {
  readonly uid: string;
  readonly role: string;
  readonly sessionId: string;
  /** Lists the session's pings as this browser: HTTP status and how many came back. */
  pings(): Promise<{ status: number; count: number }>;
  /** The session doc as this browser reads it (allowed after the end too, for the ended state). */
  session(): Promise<{ status: string; end_reason: string | null }>;
}

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

export async function redeemAsWatcher(set: EmulatorSet, linkToken: string): Promise<Watcher> {
  const redeem = await post(`${functionsBase(set)}/${set.projectId}/${set.region}/redeemLinkToken`, { data: { link_token: linkToken } });
  const result = redeem.json.result as { custom_token?: string; session_id?: string; role?: string } | undefined;
  if (!result?.custom_token || !result.session_id || !result.role) throw new Error(`redeemLinkToken failed: HTTP ${String(redeem.status)} ${JSON.stringify(redeem.json)}`);
  const signIn = await post(`${authBase(set)}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-only`, {
    token: result.custom_token,
    returnSecureToken: true,
  });
  const idToken = signIn.json.idToken as string | undefined;
  if (!idToken) throw new Error(`signInWithCustomToken failed: HTTP ${String(signIn.status)} ${JSON.stringify(signIn.json)}`);
  // The emulator's ID tokens are unsigned JWTs; the uid is the subject.
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string };
  const uid = claims.sub ?? '';
  const sessionId = result.session_id;
  return {
    uid,
    role: result.role,
    sessionId,
    async pings() {
      const res = await fetch(`${firestoreBase(set)}/v1/projects/${set.projectId}/databases/(default)/documents/shareSessions/${sessionId}/pings`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const json = (await res.json()) as { documents?: unknown[] };
      return { status: res.status, count: json.documents?.length ?? 0 };
    },
    async session() {
      const res = await fetch(`${firestoreBase(set)}/v1/projects/${set.projectId}/databases/(default)/documents/shareSessions/${sessionId}`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`reading the session as a watcher: HTTP ${String(res.status)} ${await res.text()}`);
      const fields = ((await res.json()) as { fields?: Record<string, { stringValue?: string; nullValue?: null }> }).fields ?? {};
      return { status: fields.status?.stringValue ?? '', end_reason: fields.end_reason?.stringValue ?? null };
    },
  };
}
