const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user
  .findMany({ select: { email: true, emailVerified: true, name: true } })
  .then((users) => {
    console.log(JSON.stringify(users, null, 2));
    return prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('ERR', e.message);
    process.exit(1);
  });
