/**
 * Quick Demo User Seed Script
 * Creates a single demo user for testing provider search
 *
 * Run with: POSTGRES_PRISMA_URL="..." POSTGRES_URL_NON_POOLING="..." npx tsx prisma/quick-seed-demo-user.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Creating demo user for provider search...\n');

  const email = 'demo@providercard.com';
  const password = 'demo';

  try {
    // Check if user already exists
    const existing = await prisma.practitioner.findUnique({
      where: { email },
    });

    if (existing) {
      console.log('✓ Demo user already exists!');
      console.log(`  Email: ${email}`);
      console.log(`  Password: ${password}\n`);
      return;
    }

    // Create demo user
    const passwordHash = await bcrypt.hash(password, 10);
    const fhirId = `demo-${Date.now()}`;

    const practitioner = await prisma.practitioner.create({
      data: {
        fhirId,
        firstName: 'Demo',
        lastName: 'User',
        npi: '9999999999',
        gender: 'other',
        email,
        phone: '(555) 000-0000',
        passwordHash,
        addressLine1: '123 Demo Street',
        city: 'Boston',
        state: 'MA',
        postalCode: '02101',
        country: 'US',
        status: 'active',
        completeness: 50,
        verified: true,
      },
    });

    console.log('✅ Demo user created successfully!\n');
    console.log('📋 Login Credentials:');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}\n`);
    console.log('🔍 You can now use Provider Search at /provider-search');
    console.log('   Try NPI: 1184281883 (Sara King - Audiologist)\n');

  } catch (error: any) {
    if (error.code === 'P2002') {
      console.log('✓ Demo user already exists!');
      console.log(`  Email: ${email}`);
      console.log(`  Password: ${password}\n`);
    } else {
      throw error;
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
