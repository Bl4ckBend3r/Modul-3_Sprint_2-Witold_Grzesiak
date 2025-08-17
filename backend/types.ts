export type Role = "admin" | "user";

export interface User {
    id: string;
    username: string;
    password: string; // Dla uproszczenia przechowujemy hasło w postaci jawnej (w praktyce należy stosować hashowanie)
    role: Role;
    balance: number;
    refreshVersion: number;
  }
  
  export interface Car {
    id: string;
    model: string;
    price: number;
    ownerId: string;
  }

/** SSE: zakup auta */
export interface PurchaseEvent {
  event: "purchase";
  carId: string;
  model: string;
  price: number;
  sellerId: string;
  buyerId: string;
  ts: number;
}

/** SSE: zasilenie konta (admin/faucet) */
export interface FundEvent {
  event: "fund";
  by: "admin" | "faucet";
  userId: string;
  amount: number;
  adminId?: string;
  ts?: number;
}

/** SSE: ping keep-alive */
export interface PingEvent {
  event: "ping";
  ts: number;
}

export type SSEEvent = PurchaseEvent | FundEvent | PingEvent;

/** Wpis do dziennika audytu (z *ts*) */
export type AuditEntry =
  | { ts: number; type: "admin-fund"; adminId: string; userId: string; amount: number }
  | { ts: number; type: "dev-faucet"; userId: string; amount: number }
  | { ts: number; type: "purchase"; carId: string; buyerId: string; sellerId: string; price: number };


export interface ApiSuccess<T = unknown> { success: true; data?: T; [k: string]: unknown; }
export interface ApiError { success: false; error: string; details?: string; }
