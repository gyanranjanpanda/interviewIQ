// Backend base URL.
// Set VITE_SERVER_URL in client/.env to point at a local backend during
// development; falls back to the deployed server.
export const ServerUrl = import.meta.env.VITE_SERVER_URL || "https://interviewiq-nwin.onrender.com"
