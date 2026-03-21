import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "";

const client = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null) {
  currentUserId = id;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

// Inject X-User-Id header on every axios request
client.interceptors.request.use((config) => {
  if (currentUserId) {
    config.headers["X-User-Id"] = currentUserId;
  }
  return config;
});

export default client;
