import { Request, Response } from "express";
import { prisma } from "../prismaClient";

export const getFilters = async (req: Request, res: Response) => {
  try {
    const [categories, tags, instruments, authors] = await Promise.all([
      prisma.productType.findMany({ select: { id: true, name: true } }),
      prisma.tag.findMany({ select: { id: true, name: true } }),
      prisma.instrument.findMany({ select: { id: true, name: true } }),
      prisma.author.findMany({ select: { id: true, name: true } }),
    ]);

    res.json({
      categories,
      tags,
      instruments,
      authors,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch filters" });
  }
};
