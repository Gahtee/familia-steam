export type Member = {
  id: number;
  name: string;
  avatar: string;
  avatar_url: string;
  bought: number;
  gifted: number;
  split_in: number;
};

export type SplitMember = { id: number; name: string; avatar: string };

export type Purchase = {
  id: number;
  appid: number;
  game_name: string;
  header_image: string;
  steam_url: string;
  buyer_member_id: number;
  buyer_name: string;
  buyer_avatar: string;
  purchase_date: string;
  price_paid_cents: number;
  price_source: "manual" | "steam-atual";
  is_gift: number;
  gift_to_member_id: number | null;
  gift_to_name: string;
  gift_to_avatar: string;
  note: string;
  created_at: number;
  updated_at: number;
  splits: SplitMember[];
};

export type RankingEntry = {
  member_id: number;
  name: string;
  avatar: string;
  value: number;
  cents?: number;
  gifts?: number;
  avgCents?: number;
  rank: number;
  month?: number;
  monthLabel?: string;
};

export type Stats = {
  ready: boolean;
  year: number;
  message?: string;
  total?: number;
  totalCents?: number;
  freeCount?: number;
  avgCents?: number;
  giftCount?: number;
  splitCount?: number;
  perMonth?: Array<{ month: number; label: string; short: string; count: number; cents: number }>;
  buyers?: RankingEntry[];
  spenders?: RankingEntry[];
  givers?: RankingEntry[];
  receivers?: RankingEntry[];
  compulsive?: RankingEntry[];
  splits?: RankingEntry[];
  priciest?: Array<{
    id: number;
    game_name: string;
    header_image: string;
    cents: number;
    buyer_name: string;
    buyer_avatar: string;
    purchase_date: string;
  }>;
};

export type SteamResult = {
  appid: number;
  name: string;
  tiny_image: string;
  price_cents: number | null;
  is_free: boolean;
};

export type PurchaseInput = {
  appid?: number | string;
  steam_url?: string;
  game_name: string;
  header_image?: string;
  buyer_member_id: number;
  purchase_date: string;
  price_paid_cents: number;
  price_source: "manual" | "steam-atual";
  is_gift: boolean;
  gift_to_member_id?: number | null;
  split_with?: number[];
  note?: string;
};

const API_BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";
let csrfToken = "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? "Não foi possível concluir a ação.";
  } catch {
    return "Não foi possível concluir a ação.";
  }
}

async function request<T>(path: string, options: RequestInit = {}, retryCsrf = true): Promise<T> {
  const method = options.method?.toUpperCase() ?? "GET";
  const isMutation = ["POST", "PUT", "DELETE"].includes(method);
  const isCsrfExempt = path === "/api/login" || path === "/api/logout";
  const headers = new Headers(options.headers);
  if (options.body && typeof options.body === "string") headers.set("Content-Type", "application/json");
  if (isMutation && !isCsrfExempt && csrfToken) headers.set("X-CSRF-Token", csrfToken);

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 403 && isMutation && !isCsrfExempt && retryCsrf) {
    await api.me();
    return request<T>(path, options, false);
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<T>;
}

export const api = {
  async me() {
    const data = await request<{ ok: true; csrf: string }>("/api/me");
    csrfToken = data.csrf;
    return data;
  },
  async login(password: string) {
    const data = await request<{ ok: true; csrf: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    csrfToken = data.csrf;
    return data;
  },
  async logout() {
    const data = await request<{ ok: true }>("/api/logout", { method: "POST" });
    csrfToken = "";
    return data;
  },
  changePassword(current: string, next: string) {
    return request<{ ok: true; csrf: string }>("/api/password", {
      method: "POST",
      body: JSON.stringify({ current, new: next }),
    });
  },
  members: () => request<{ members: Member[] }>("/api/members"),
  addMember: (name: string) => request<{ ok: true; id: number }>("/api/members", { method: "POST", body: JSON.stringify({ name }) }),
  updateMember: (id: number, name: string) => request<{ ok: true }>(`/api/members/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  deleteMember: (id: number) => request<{ ok: true }>(`/api/members/${id}`, { method: "DELETE" }),
  uploadAvatar: (id: number, data: string) => request<{ ok: true; avatar_url: string }>(`/api/members/${id}/avatar`, { method: "POST", body: JSON.stringify({ mime: "image/jpeg", data }) }),
  deleteAvatar: (id: number) => request<{ ok: true }>(`/api/members/${id}/avatar`, { method: "DELETE" }),
  years: () => request<{ years: number[] }>("/api/years"),
  stats: (year: number) => request<Stats>(`/api/stats?year=${year}`),
  purchases: (year: number, member?: number, q?: string) => {
    const params = new URLSearchParams({ year: String(year) });
    if (member) params.set("member", String(member));
    if (q) params.set("q", q);
    return request<{ purchases: Purchase[] }>(`/api/purchases?${params}`);
  },
  addPurchase: (data: PurchaseInput) => request<{ ok: true; id: number }>("/api/purchases", { method: "POST", body: JSON.stringify(data) }),
  updatePurchase: (id: number, data: PurchaseInput) => request<{ ok: true }>(`/api/purchases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePurchase: (id: number) => request<{ ok: true }>(`/api/purchases/${id}`, { method: "DELETE" }),
  searchSteam: (q: string) => request<{ results: SteamResult[] }>(`/api/steam/search?q=${encodeURIComponent(q)}`),
  lookupSteam: (appid: number) => request<{ appid: number; name: string; header_image: string; current_price_cents: number | null }>(`/api/steam/lookup?appid=${appid}`),
  async exportCsv(year: number) {
    const response = await fetch(`${API_BASE}/api/export.csv?year=${year}`, { credentials: "include" });
    if (!response.ok) throw new ApiError(await parseError(response), response.status);
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const name = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? `familia-steam-${year}.csv`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  },
};

export function assetUrl(path?: string) {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}

export async function imageToJpeg(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("O arquivo não é uma imagem válida."));
    img.src = dataUrl;
  });
  const scale = Math.min(1, 256 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84).split(",")[1] ?? "";
}