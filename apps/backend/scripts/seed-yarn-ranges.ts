import { prisma } from '../src/prismaClient';

// Fixed yarn-thickness buckets (m/100g), derived from real-data distribution
// analysis (yarn_report.html). Idempotent — safe to re-run.
const RANGES = [
  { label: '0–250', minValue: 0, maxValue: 250, sortOrder: 1 },
  { label: '251–350', minValue: 251, maxValue: 350, sortOrder: 2 },
  { label: '351–500', minValue: 351, maxValue: 500, sortOrder: 3 },
  { label: '501–700', minValue: 501, maxValue: 700, sortOrder: 4 },
  { label: '701+', minValue: 701, maxValue: null, sortOrder: 5 },
];

async function main() {
  for (const range of RANGES) {
    await prisma.yarnRange.upsert({
      where: { label: range.label },
      update: { minValue: range.minValue, maxValue: range.maxValue, sortOrder: range.sortOrder },
      create: range,
    });
    console.log('OK', range.label);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
