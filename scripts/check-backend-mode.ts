/**
 * Quick script to check backend mode configuration
 */

import { prisma } from '../src/lib/db';

async function checkBackendMode() {
  try {
    // Check for system.backend_mode configuration
    const config = await prisma.configuration.findUnique({
      where: { key: 'system.backend_mode' }
    });

    console.log('Backend mode configuration:');
    if (config) {
      console.log('  Key:', config.key);
      console.log('  Value:', config.value);
      console.log('  Encrypted:', config.encrypted);
    } else {
      console.log('  NOT CONFIGURED (will default to "plex")');
    }

    // Check all configuration keys that might be relevant
    console.log('\nAll configuration keys:');
    const allConfigs = await prisma.configuration.findMany({
      select: { key: true, value: true, encrypted: true },
      orderBy: { key: 'asc' }
    });

    for (const cfg of allConfigs) {
      if (cfg.encrypted) {
        console.log(`  ${cfg.key}: [ENCRYPTED]`);
      } else {
        console.log(`  ${cfg.key}: ${cfg.value}`);
      }
    }
  } catch (error) {
    console.error('Error checking configuration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBackendMode();
