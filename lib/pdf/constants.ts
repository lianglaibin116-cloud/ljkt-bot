/**
 * PDF Provider Constants
 * Separated from pdf-providers.ts to avoid importing sharp in client components
 */

import type { PDFProviderId, PDFProviderConfig } from './types';

export const MINERU_CLOUD_DEFAULT_BASE = 'https://mineru.net/api/v4';
export const ALIDOCMIND_DEFAULT_BASE = 'https://docmind-api.cn-hangzhou.aliyuncs.com';
export const MINICPM_OCR_DEFAULT_BASE = 'https://api.modelbest.cn/v1';
export const DEEPSEEK_OCR_DEFAULT_BASE = 'https://api.deepseek.com/v1';

/**
 * PDF Provider Registry
 */
export const PDF_PROVIDERS: Record<PDFProviderId, PDFProviderConfig> = {
  unpdf: {
    id: 'unpdf',
    name: 'unpdf',
    requiresApiKey: false,
    icon: '/logos/unpdf.svg',
    features: ['text', 'images', 'metadata'],
  },

  mineru: {
    id: 'mineru',
    name: 'MinerU',
    requiresApiKey: false,
    icon: '/logos/mineru.png',
    features: ['text', 'images', 'tables', 'formulas', 'layout-analysis'],
  },

  'mineru-cloud': {
    id: 'mineru-cloud',
    name: 'MinerU (Cloud)',
    requiresApiKey: true,
    icon: '/logos/mineru.png',
    features: ['text', 'images', 'tables', 'formulas', 'layout-analysis'],
  },

  alidocmind: {
    id: 'alidocmind',
    name: 'AliDocMind',
    requiresApiKey: true,
    icon: '/logos/aliyun.svg',
    features: ['text', 'images', 'tables', 'formulas', 'layout-analysis', 'ocr'],
  },

  'minicpm-ocr': {
    id: 'minicpm-ocr',
    name: 'MiniCPM-OCR',
    requiresApiKey: true,
    baseUrl: MINICPM_OCR_DEFAULT_BASE,
    icon: '/logos/minicpm-ocr.png',
    features: ['text', 'tables', 'formulas', 'layout-analysis', 'ocr'],
    displayEndpoint: `${MINICPM_OCR_DEFAULT_BASE}/document-parse/jobs`,
    apiKeyOptionalWithBaseUrl: true,
  },

  'deepseek-ocr': {
    id: 'deepseek-ocr',
    name: 'DeepSeek OCR',
    requiresApiKey: true,
    icon: '/logos/deepseek.svg',
    features: ['text', 'images', 'tables', 'formulas', 'layout-analysis', 'ocr'],
    displayEndpoint: `${DEEPSEEK_OCR_DEFAULT_BASE}/tools/ocr`,
  },
};

/**
 * Get all available PDF providers
 */
export function getAllPDFProviders(): PDFProviderConfig[] {
  return Object.values(PDF_PROVIDERS);
}

/**
 * Get PDF provider by ID
 */
export function getPDFProvider(providerId: PDFProviderId): PDFProviderConfig | undefined {
  return PDF_PROVIDERS[providerId];
}
