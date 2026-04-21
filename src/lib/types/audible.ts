/**
 * Component: Audible Region Types
 * Documentation: documentation/integrations/audible.md
 */

import type { SupportedLanguage } from '../constants/language-config';

export type AudibleRegion = 'us' | 'ca' | 'uk' | 'au' | 'in' | 'de' | 'es' | 'fr';

export interface AudibleRegionConfig {
  code: AudibleRegion;
  name: string;
  baseUrl: string;
  apiBaseUrl: string;
  audnexusParam: string;
  language: SupportedLanguage;
}

export const AUDIBLE_REGIONS: Record<AudibleRegion, AudibleRegionConfig> = {
  us: {
    code: 'us',
    name: 'United States',
    baseUrl: 'https://www.audible.com',
    apiBaseUrl: 'https://api.audible.com',
    audnexusParam: 'us',
    language: 'en',
  },
  ca: {
    code: 'ca',
    name: 'Canada',
    baseUrl: 'https://www.audible.ca',
    apiBaseUrl: 'https://api.audible.ca',
    audnexusParam: 'ca',
    language: 'en',
  },
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    baseUrl: 'https://www.audible.co.uk',
    apiBaseUrl: 'https://api.audible.co.uk',
    audnexusParam: 'uk',
    language: 'en',
  },
  au: {
    code: 'au',
    name: 'Australia',
    baseUrl: 'https://www.audible.com.au',
    apiBaseUrl: 'https://api.audible.com.au',
    audnexusParam: 'au',
    language: 'en',
  },
  in: {
    code: 'in',
    name: 'India',
    baseUrl: 'https://www.audible.in',
    apiBaseUrl: 'https://api.audible.in',
    audnexusParam: 'in',
    language: 'en',
  },
  de: {
    code: 'de',
    name: 'Germany',
    baseUrl: 'https://www.audible.de',
    apiBaseUrl: 'https://api.audible.de',
    audnexusParam: 'de',
    language: 'de',
  },
  es: {
    code: 'es',
    name: 'Spain',
    baseUrl: 'https://www.audible.es',
    apiBaseUrl: 'https://api.audible.es',
    audnexusParam: 'es',
    language: 'es',
  },
  fr: {
    code: 'fr',
    name: 'France',
    baseUrl: 'https://www.audible.fr',
    apiBaseUrl: 'https://api.audible.fr',
    audnexusParam: 'fr',
    language: 'fr',
  },
};

export const DEFAULT_AUDIBLE_REGION: AudibleRegion = 'us';
