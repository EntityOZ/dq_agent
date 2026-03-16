import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use(async (config) => {
  if (typeof window !== "undefined") {
    // Dynamic import to avoid SSR issues
    const { default: clerk } = await import("@clerk/nextjs");
    // @ts-expect-error Clerk session may be available on the window object
    const token = window?.Clerk?.session?.getToken?.();
    if (token) {
      config.headers.Authorization = `Bearer ${await token}`;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error.response) {
      if (error.response.status === 401) {
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
