/**
 * Component: Audible Region Types
 * Documentation: documentation/integrations/audible.md
 */

import type { SupportedLanguage } from '../constants/language-config';

export type AudibleRegion = 'us' | 'ca' | 'uk' | 'au' | 'in' | 'de' | 'es';

export interface AudibleRegionConfig {
  code: AudibleRegion;
  name: string;
  baseUrl: string;
  audnexusParam: string;
  language: SupportedLanguage;
}

export const AUDIBLE_REGIONS: Record<AudibleRegion, AudibleRegionConfig> = {
  us: {
    code: 'us',
    name: 'United States',
    baseUrl: 'https://www.audible.com',
    audnexusParam: 'us',
    language: 'en',
  },
  ca: {
    code: 'ca',
    name: 'Canada',
    baseUrl: 'https://www.audible.ca',
    audnexusParam: 'ca',
    language: 'en',
  },
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    baseUrl: 'https://www.audible.co.uk',
    audnexusParam: 'uk',
    language: 'en',
  },
  au: {
    code: 'au',
    name: 'Australia',
    baseUrl: 'https://www.audible.com.au',
    audnexusParam: 'au',
    language: 'en',
  },
  in: {
    code: 'in',
    name: 'India',
    baseUrl: 'https://www.audible.in',
    audnexusParam: 'in',
    language: 'en',
  },
  de: {
    code: 'de',
    name: 'Germany',
    baseUrl: 'https://www.audible.de',
    audnexusParam: 'de',
    language: 'de',
  },
  es: {
    code: 'es',
    name: 'Spain',
    baseUrl: 'https://www.audible.es',
    audnexusParam: 'es',
    language: 'es',
  }
};

export const DEFAULT_AUDIBLE_REGION: AudibleRegion = 'us';
