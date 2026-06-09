import { Request, Response } from "express";
import { prisma } from "../prismaClient";

export const getPatterns = async (req: Request, res: Response) => {
  try {
    const { search, isFree, isNew, limit, offset } = req.query;

    const where: any = {};

    if (search && typeof search === 'string') {
      where.title = {
        contains: search,
        mode: 'insensitive'
      };
    }

    if (isFree === 'true') {
      where.isFree = true;
    }

    if (isNew === 'true') {
      // Считаем новинками добавленные за последние 30 дней
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.createdAt = {
        gte: thirtyDaysAgo
      };
    }

    const take = limit ? parseInt(limit as string, 10) : 10;
    const skip = offset ? parseInt(offset as string, 10) : 0;

    const patterns = await prisma.pattern.findMany({
      where,
      take,
      skip,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'asc' }
      ],
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
      }
    });

    const mappedPatterns = patterns.map(p => ({
      ...p,
      author: p.author?.name || 'Неизвестно',
      instruments: p.instruments.map(i => i.name),
      productTypes: p.categories.map(pt => pt.name),
      tags: p.tags.map(t => t.name),
      primaryProductType: p.categories[0]?.name || '',
      externalLink: p.url || ''
    }));

    res.json(mappedPatterns);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch patterns" });
  }
};

export const getPatternById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pattern = await prisma.pattern.findUnique({
      where: { id },
      include: {
        author: true,
        instruments: true,
        categories: true,
        tags: true,
      }
    });
    
    if (!pattern) {
      return res.status(404).json({ error: "Pattern not found" });
    }
    
    const mappedPattern = {
      ...pattern,
      author: pattern.author?.name || 'Неизвестно',
      instruments: pattern.instruments.map(i => i.name),
      productTypes: pattern.categories.map(pt => pt.name),
      tags: pattern.tags.map(t => t.name),
      primaryProductType: pattern.categories[0]?.name || '',
      externalLink: pattern.url || ''
    };

    res.json(mappedPattern);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch pattern" });
  }
};
