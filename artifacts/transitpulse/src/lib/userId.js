const KEY = "tp_user_id";

export function getUserId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getShortId(id) {
  return id ? id.slice(0, 8) : "???";
}
