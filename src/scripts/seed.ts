import '../env';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

async function seed() {
  const email = 'test@leadseize.com';

  const existing = await prisma.agent.findUnique({ where: { email } });
  if (existing) {
    console.log(`Agent ${email} already exists (id: ${existing.id}) — skipping.`);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash('testpassword123', 10);

  const agent = await prisma.agent.create({
    data: {
      name: 'Test Agent',
      email,
      passwordHash,
      phone: '+19785106430',
      websiteUrl: 'https://leadseize.com',
      businessDescription: 'Test real estate agent',
      alertEmail: 'arnavmulimani7@gmail.com',
      alertPhone: '+19785106430',
    },
  });

  console.log(`Created agent: ${agent.name} (id: ${agent.id})`);
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
