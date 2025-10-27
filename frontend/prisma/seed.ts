/**
 * Database Seed Script
 * Creates demo practitioners and roles for development/demo
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { practitionerToFHIR, practitionerRoleToFHIR, calculateCompleteness } from '../src/lib/fhirUtils';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Clear existing data
  console.log('  Clearing existing data...');
  await prisma.syncLog.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.practitionerRole.deleteMany();
  await prisma.practitioner.deleteMany();

  // Create demo practitioners
  const practitioners = [
    {
      email: 'dr.sarah.smith@example.com',
      password: 'Demo123!',
      firstName: 'Sarah',
      middleName: 'Marie',
      lastName: 'Smith',
      suffix: 'MD',
      npi: '1234567890',
      gender: 'female',
      phone: '(555) 987-6543',
      addressLine1: '100 Main Street',
      addressLine2: 'Suite 200',
      city: 'Cambridge',
      state: 'MA',
      postalCode: '02139',
      verified: true,
      specialty: { code: '207R00000X', display: 'Internal Medicine' },
    },
    {
      email: 'dr.james.chen@example.com',
      password: 'Demo123!',
      firstName: 'James',
      middleName: 'Li',
      lastName: 'Chen',
      suffix: 'MD',
      npi: '2345678901',
      gender: 'male',
      phone: '(555) 123-4567',
      addressLine1: '456 Medical Plaza',
      city: 'Boston',
      state: 'MA',
      postalCode: '02115',
      verified: true,
      specialty: { code: '207RC0000X', display: 'Cardiovascular Disease' },
    },
    {
      email: 'dr.maria.garcia@example.com',
      password: 'Demo123!',
      firstName: 'Maria',
      lastName: 'Garcia',
      suffix: 'DO',
      npi: '3456789012',
      gender: 'female',
      phone: '(555) 234-5678',
      addressLine1: '789 Healthcare Ave',
      city: 'Worcester',
      state: 'MA',
      postalCode: '01605',
      verified: true,
      specialty: { code: '208000000X', display: 'Pediatrics' },
    },
  ];

  console.log('  Creating practitioners...');

  for (const practData of practitioners) {
    const passwordHash = await bcrypt.hash(practData.password, 10);
    const fhirId = `prac-` + Math.random().toString(36).substring(7);

    // Create temporary practitioner object for FHIR generation
    const tempPract: any = {
      fhirId,
      firstName: practData.firstName,
      middleName: practData.middleName || null,
      lastName: practData.lastName,
      suffix: practData.suffix || null,
      npi: practData.npi,
      email: practData.email,
      phone: practData.phone,
      addressLine1: practData.addressLine1,
      addressLine2: practData.addressLine2 || null,
      city: practData.city,
      state: practData.state,
      postalCode: practData.postalCode,
      country: 'US',
      gender: practData.gender,
      status: 'active',
    };

    const fhirResource = practitionerToFHIR(tempPract);
    const completeness = calculateCompleteness(tempPract);

    const practitioner = await prisma.practitioner.create({
      data: {
        fhirId,
        firstName: practData.firstName,
        middleName: practData.middleName,
        lastName: practData.lastName,
        suffix: practData.suffix,
        npi: practData.npi,
        gender: practData.gender,
        email: practData.email,
        phone: practData.phone,
        passwordHash,
        addressLine1: practData.addressLine1,
        addressLine2: practData.addressLine2,
        city: practData.city,
        state: practData.state,
        postalCode: practData.postalCode,
        country: 'US',
        fhirResource: fhirResource as any,
        status: 'active',
        completeness,
        verified: practData.verified,
      },
    });

    console.log(`  ✓ Created ` + practitioner.firstName + ` ` + practitioner.lastName);

    // Create practitioner role
    if (practData.specialty) {
      const roleFhirId = `role-` + Math.random().toString(36).substring(7);
      
      const tempRole: any = {
        fhirId: roleFhirId,
        specialtyCode: practData.specialty.code,
        specialtyDisplay: practData.specialty.display,
        practiceAddressLine1: practData.addressLine1,
        practiceCity: practData.city,
        practiceState: practData.state,
      };

      const roleFhirResource = practitionerRoleToFHIR(tempRole, fhirId);

      const role = await prisma.practitionerRole.create({
        data: {
          fhirId: roleFhirId,
          practitionerId: practitioner.id,
          specialtyCode: practData.specialty.code,
          specialtyDisplay: practData.specialty.display,
          practiceName: practitioner.lastName + ` Medical Practice`,
          practiceAddressLine1: practData.addressLine1,
          practiceAddressLine2: practData.addressLine2,
          practiceCity: practData.city,
          practiceState: practData.state,
          practicePostalCode: practData.postalCode,
          licenseState: practData.state,
          licenseNumber: `MA-` + Math.floor(Math.random() * 1000000),
          licenseExpiration: new Date('2026-12-31'),
          acceptedInsurances: [
            { name: 'Blue Cross Blue Shield MA', planType: 'PPO' },
            { name: 'Medicare', planType: 'Traditional' },
            { name: 'Aetna', planType: 'HMO' },
          ],
          fhirResource: roleFhirResource as any,
          active: true,
        },
      });

      console.log(`    ✓ Added ` + role.specialtyDisplay + ` role`);
    }
  }

  console.log('✅ Seed completed successfully!');
  console.log('');
  console.log('📋 Demo Logins:');
  console.log('  Email: dr.sarah.smith@example.com | Password: Demo123!');
  console.log('  Email: dr.james.chen@example.com | Password: Demo123!');
  console.log('  Email: dr.maria.garcia@example.com | Password: Demo123!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
