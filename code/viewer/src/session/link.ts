/**
 * Share links look like https://trackme.live/s/{token}: 22 base64url characters (FSD §6). A link
 * that can't be a token is shown as "This link doesn't work" without asking the backend.
 */

import { LINK_TOKEN_LENGTH, SHARE_LINK_PATH } from '@tml/shared/schema/generated/ts/schema';

export type ShareLink =
  /** A path that holds a well-formed token. */
  | { readonly kind: 'token'; readonly token: string }
  /** A share path whose token is cut off, too long or mistyped. */
  | { readonly kind: 'malformed' }
  /** Not a share path at all (the page's own root during development). */
  | { readonly kind: 'none' };

const TOKEN = new RegExp(`^[A-Za-z0-9_-]{${String(LINK_TOKEN_LENGTH)}}$`);

export function parseShareLink(pathname: string): ShareLink {
  if (!pathname.startsWith(SHARE_LINK_PATH)) return { kind: 'none' };
  const rest = pathname.slice(SHARE_LINK_PATH.length).replace(/\/$/, '');
  return TOKEN.test(rest) ? { kind: 'token', token: rest } : { kind: 'malformed' };
}
