import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// DICTIONARIES (Categories, Tags, Instruments)
export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await prisma.productType.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patterns: true } } },
    });
    res.json(categories.map(c => ({ id: c.id, name: c.name, patternsCount: c._count.patterns })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    const category = await prisma.productType.update({ where: { id }, data: { name: name.trim() } });
    res.json({ id: category.id, name: category.name });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Category not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.productType.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Category not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patterns: true } } },
    });
    res.json(tags.map(t => ({ id: t.id, name: t.name, patternsCount: t._count.patterns })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    const tag = await prisma.tag.update({ where: { id }, data: { name: name.trim() } });
    res.json({ id: tag.id, name: tag.name });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Tag not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.tag.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Tag not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getInstruments = async (req: Request, res: Response): Promise<void> => {
  try {
    // patternsCount добавлен вместе со страницей "Справочники": там инструменты
    // можно удалять, и без счётчика непонятно, сколько описаний зацепит
    // удаление. Формат ответа теперь совпадает с getCategories/getTags.
    const instruments = await prisma.instrument.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { patterns: true } } },
    });
    res.json(instruments.map(i => ({ id: i.id, name: i.name, patternsCount: i._count.patterns })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateInstrument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
    const instrument = await prisma.instrument.update({ where: { id }, data: { name: name.trim() } });
    res.json({ id: instrument.id, name: instrument.name });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Instrument not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteInstrument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.instrument.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') { res.status(404).json({ error: "Instrument not found" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /admin/yarn-ranges — fixed thickness buckets, not user-creatable.
export const getYarnRanges = async (req: Request, res: Response): Promise<void> => {
  try {
    const ranges = await prisma.yarnRange.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(ranges.map(r => ({ id: r.id, label: r.label, minValue: r.minValue, maxValue: r.maxValue })));
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};
