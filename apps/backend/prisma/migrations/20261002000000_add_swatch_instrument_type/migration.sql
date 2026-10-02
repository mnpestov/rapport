-- Тип инструмента образца: 'hook' (крючок) или 'needle' (спицы).
-- Необязательное поле — старые образцы остаются без типа, needleSizeRaw
-- продолжает хранить размер инструмента в свободном формате.
ALTER TABLE "StashSwatch" ADD COLUMN "instrumentType" TEXT;
