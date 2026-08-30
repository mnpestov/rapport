// Общие типы и интерфейсы для Backend и Frontend (Mini App, Admin)

export interface UserDTO {
  id: string;
  telegramId: string;
  firstName: string;
  isSubscriber: boolean;
}

export const API_URL = "/api";

export * from './contracts/botDiagnostic';
export * from './contracts/authorApplication';
