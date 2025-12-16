/**
 * Quick script to configure Audiobookshelf settings
 */

import { prisma } from '../src/lib/db';

async function setupABSConfig() {
  try {
    // Configure these values for your Audiobookshelf instance
    const config = {
      'audiobookshelf.server_url': 'http://localhost:13378',  // Change to your ABS server URL
      'audiobookshelf.api_token': 'YOUR_ABS_API_TOKEN',      // Get from ABS Settings -> Users -> Your User -> API Token
      'audiobookshelf.library_id': 'YOUR_LIBRARY_ID',        // Get from ABS or use test-abs endpoint
    };

    console.log('Setting up Audiobookshelf configuration...\n');

    for (const [key, value] of Object.entries(config)) {
      const existing = await prisma.configuration.findUnique({
        where: { key }
      });

      if (existing) {
        await prisma.configuration.update({
          where: { key },
          data: {
            value,
            encrypted: key === 'audiobookshelf.api_token',
          }
        });
        console.log(`✓ Updated: ${key}`);
      } else {
        await prisma.configuration.create({
          data: {
            key,
            value,
            encrypted: key === 'audiobookshelf.api_token',
            category: 'audiobookshelf',
            description: null,
          }
        });
        console.log(`✓ Created: ${key}`);
      }
    }

    console.log('\n✓ Audiobookshelf configuration complete!');
    console.log('\nNext steps:');
    console.log('1. Update the values above with your actual ABS settings');
    console.log('2. Run this script again');
    console.log('3. Test with: POST /api/setup/test-abs');
    console.log('4. Run scan job: POST /api/admin/jobs/{jobId}/trigger');

  } catch (error) {
    console.error('Error setting up configuration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupABSConfig();
