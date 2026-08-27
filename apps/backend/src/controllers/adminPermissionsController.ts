import { Request, Response } from "express";
import { Permission } from "@prisma/client";
import { prisma } from "../prismaClient";

// GET /admin/permissions?userId=xxx
export const getPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query as { userId?: string };
    const where = userId ? { userId } : undefined;

    const permissions = await prisma.userPermission.findMany({
      where,
      include: { user: { select: { id: true, username: true, firstName: true } } },
      orderBy: { userId: "asc" },
    });

    res.json(permissions);
  } catch (error) {
    console.error("[Admin] getPermissions failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/permissions — { userId, permission }
export const grantPermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, permission } = req.body;
    if (!userId || !permission) {
      res.status(400).json({ error: "userId and permission are required" });
      return;
    }
    if (!Object.values(Permission).includes(permission)) {
      res.status(400).json({ error: "Invalid permission value" });
      return;
    }

    const entry = await prisma.userPermission.upsert({
      where: { userId_permission: { userId, permission } },
      create: { userId, permission },
      update: {},
    });

    res.status(201).json(entry);
  } catch (error: any) {
    if (error.code === "P2003") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    console.error("[Admin] grantPermission failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /admin/permissions/:userId/:permission
export const revokePermission = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, permission } = req.params;

    await prisma.userPermission.delete({
      where: { userId_permission: { userId, permission: permission as Permission } },
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Permission entry not found" });
      return;
    }
    console.error("[Admin] revokePermission failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
