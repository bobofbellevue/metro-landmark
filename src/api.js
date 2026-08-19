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
    post: async (endpoint, body, user) => {
      const url = `${API_BASE_URL}${endpoint}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role, 'x-user-id': user?.user_id },
        body: JSON.stringify(body),
      });
      return readApiJson(response);
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
