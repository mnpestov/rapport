import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const search = "test";
const where: any = {
  OR: [
    { title: { contains: search, mode: 'insensitive' } },
    { author: { name: { contains: search, mode: 'insensitive' } } },
    { categories: { some: { name: { contains: search, mode: 'insensitive' } } } },
    { instruments: { some: { name: { contains: search, mode: 'insensitive' } } } },
    { tags: { some: { name: { contains: search, mode: 'insensitive' } } } }
  ]
};
prisma.pattern.findMany({ where });
