import { Request, Response } from "express";
import { prisma } from "../prismaClient";

export const getFilters = async (req: Request, res: Response) => {
  try {
    const [categories, tags, instruments, authors, yarnRangesRaw, densityRaw] = await Promise.all([
      prisma.productType.findMany({ select: { id: true, name: true } }),
      prisma.tag.findMany({ select: { id: true, name: true } }),
      prisma.instrument.findMany({ select: { id: true, name: true } }),
      prisma.author.findMany({ select: { id: true, name: true } }),
      prisma.yarnRange.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
      // Unlike the lookup tables above, there is no Density dictionary model —
      // density is just two Decimal columns on Pattern — so the filter's
      // option list is derived from the distinct combinations actually used
      // by visible patterns (scoped to isVisible, matching what /patterns
      // itself returns, so no option ever leads to zero results).
      prisma.pattern.findMany({
        where: { isVisible: true, densityStitches: { not: null }, densityRows: { not: null } },
        select: { densityStitches: true, densityRows: true },
        distinct: ["densityStitches", "densityRows"],
      }),
    ]);

    const yarnRanges = yarnRangesRaw.map((y) => ({ id: y.id, name: y.label }));

    const density = densityRaw
      .map((p) => ({ stitches: p.densityStitches!.toNumber(), rows: p.densityRows!.toNumber() }))
      .sort((a, b) => a.stitches - b.stitches || a.rows - b.rows)
      .map(({ stitches, rows }) => ({ id: `${stitches}x${rows}`, name: `${stitches} п. × ${rows} р.` }));

    res.json({
      categories,
      tags,
      instruments,
      authors,
      yarnRanges,
      density,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch filters" });
  }
};
