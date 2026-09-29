-- Новое значение enum ProjectStatus — статус "В планах" (Figma
-- node-id=1567:23115), проект задуман, но вязание ещё не начато.

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'PLANNED';
