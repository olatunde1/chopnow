/** Ports used only by the browser end-to-end run, so it never collides with dev servers. */
export const PORTS = { api: 4100, vendor: 5280, admin: 5281, customer: 5282, rider: 5283 };
export const url = (name) => `http://localhost:${PORTS[name]}`;
