import axios from "axios";

const TOKEN_KEY = "mn_auth_token";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  timeout: 60_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  if (typeof window === "undefined") return config;

  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error.response) {
      if (error.response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = "/sign-in";
        return Promise.reject(error);
      }
      if (error.response.status === 402) {
        window.location.href = "/licence-error";
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
