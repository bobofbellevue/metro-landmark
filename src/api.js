// A centralized place for API calls to keep components clean.
// API base URL - can be configured for different environments
import { readApiJson } from './utils/api-response.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

export const api = {
    get: async (endpoint, user) => {
      const url = `${API_BASE_URL}${endpoint}`;
      const response = await fetch(url, {
        headers: { 'x-user-role': user?.role, 'x-user-id': user?.user_id },
      });
      return readApiJson(response);
    },
    post: async (endpoint, body, user, options = {}) => {
      const url = `${API_BASE_URL}${endpoint}`;
      const timeoutMs = options.timeoutMs;
      const controller = timeoutMs ? new AbortController() : undefined;
      const timer = timeoutMs
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role, 'x-user-id': user?.user_id },
          body: JSON.stringify(body),
          signal: controller?.signal,
        });
        return readApiJson(response);
      } catch (err) {
        if (err?.name === 'AbortError') {
          return {
            success: false,
            error: `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          };
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    put: async (endpoint, body, user) => {
      const url = `${API_BASE_URL}${endpoint}`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role, 'x-user-id': user?.user_id },
        body: JSON.stringify(body),
      });
      return readApiJson(response);
    },
    delete: async (endpoint, user) => {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role, 'x-user-id': user?.user_id },
      });
      return readApiJson(response);
    },
  };
