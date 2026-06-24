/// <reference types="vite/client" />

const _API_URL = import.meta.env.VITE_API_URL;
if (!_API_URL) {
  throw new Error("VITE_API_URL is not defined. Add it to your .env file.");
}

export const API_URL: string = _API_URL;
