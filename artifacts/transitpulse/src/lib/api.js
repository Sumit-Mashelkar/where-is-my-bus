import axios from "axios";

export const API = "/api";

export const api = axios.create({
  baseURL: API,
});

export const get = (p, c) => api.get(p, c).then((r) => r.data);
export const post = (p, b, c) => api.post(p, b, c).then((r) => r.data);
