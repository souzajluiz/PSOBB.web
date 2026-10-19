// Where the PSOBB.web server is (the bridge and the newserv files it serves).
// The web build is served by that server, so its origin is the page's own and
// the default is empty. The native app (Capacitor) runs from its own bundle, so
// its build sets VITE_SERVER_ORIGIN to the public address, for example
// https://psobb.example.com (docs/NATIVE.md).

export const SERVER_ORIGIN = ((import.meta.env?.VITE_SERVER_ORIGIN as string | undefined) ?? '').replace(/\/$/, '');

// A server path (/keys/..., /psobb-data/..., /bridge) on the server.
export function serverUrl(path: string): string {
  return SERVER_ORIGIN + path;
}
