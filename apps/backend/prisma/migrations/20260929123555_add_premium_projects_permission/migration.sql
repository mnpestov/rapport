-- Новое значение enum Permission — отдельный гейт доступа к разделу
-- "Вязальные проекты" (см. комментарий у Permission.PREMIUM_PROJECTS в
-- схеме), заменяет requireAdmin на routes/projects.ts.

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'PREMIUM_PROJECTS';
