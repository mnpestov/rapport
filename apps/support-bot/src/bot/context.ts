import { Context } from 'grammy';

export interface CustomContext extends Context {
  requestId: string;
}
