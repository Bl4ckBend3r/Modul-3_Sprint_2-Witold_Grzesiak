export interface User {
    id: string;
    username: string;
    password: string; // Dla uproszczenia przechowujemy hasło w postaci jawnej (w praktyce należy stosować hashowanie)
    role: 'admin' | 'user';
    balance: number;
  }
  
  export interface Car {
    id: string;
    model: string;
    price: number;
    ownerId: string;
  }
  