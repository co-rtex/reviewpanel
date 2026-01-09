import { prisma } from '../db.js';

async function main() {
  const runs = await prisma.run.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      status: true,
      triggerEvent: true,
      headSha: true,
      createdAt: true,
      repoId: true,
      prId: true,
      installationId: true,
    },
  });

  console.log(JSON.stringify(runs, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
