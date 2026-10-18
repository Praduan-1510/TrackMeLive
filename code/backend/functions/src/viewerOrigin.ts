/**
 * Where share links point: VIEWER_ORIGIN, per project in functions/.env.<projectId>.
 * The demo project points at the viewer's Vite dev server, the only build of the
 * page that talks to the emulators; a real project points at its Hosting site.
 */

/** Hosts that exist only on the machine itself. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * The origin share links use, from VIEWER_ORIGIN, for this project. A demo-
 * project (only ever on the emulators) may use http and a local host; any other
 * project must be https and never local, so a dev setting can't reach a real
 * link. Throws when the value breaks that, or isn't a URL.
 */
export function checkedViewerOrigin(value: string, projectId: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`VIEWER_ORIGIN must be http or https, not ${url.protocol}`);
  if (projectId.startsWith("demo-")) return url.origin;
  const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" || local) {
    throw new Error(`VIEWER_ORIGIN for ${projectId || "a real project"} must be an https origin that isn't local, not ${url.origin}`);
  }
  return url.origin;
}
