/**
 * Component: Audible Category Catalog Fallback
 * Documentation: documentation/integrations/audible.md
 *
 * getCategoryBooks' fallback when the storefront `/search?node=` scrape yields no books
 * (an empty page, or every retry failed): the category's bestsellers from the catalog API.
 */

import { isAcceptedLanguage, type LanguageConfig } from '../constants/language-config';
import { RMABLogger } from '../utils/logger';

const logger = RMABLogger.create('Audible.CategoryFallback');

export const CATEGORY_FALLBACK_PATH = '/1.0/catalog/products';
export const CATEGORY_FALLBACK_SORT = 'BestSellers';
/** Region-language filtering drops part of each page, so allow twice the storefront's pages */
export const CATEGORY_FALLBACK_PAGE_FACTOR = 2;

export interface CategoryFallbackProduct {
  asin?: string;
  language?: string;
}

export interface CategoryFallbackDeps<P extends CategoryFallbackProduct, B> {
  /** One catalog page (`page` is 0-based); the caller adds response groups and retries */
  fetchProducts: (params: Record<string, string | number>) => Promise<{ products?: P[] }>;
  mapProduct: (product: P) => B;
  /** The region's language: a product is kept only when it lists one of its values */
  langConfig: LanguageConfig;
  pageSize: number;
}

/**
 * The category's bestsellers, in the region's language, up to `limit`. A product without
 * a language (mostly podcasts) or in another language is left out, as on author pages.
 * Stops at a short page; a failed page ends the fallback with what was collected.
 */
export async function fetchCategoryBooksFromCatalog<P extends CategoryFallbackProduct, B>(
  categoryId: string,
  limit: number,
  deps: CategoryFallbackDeps<P, B>,
): Promise<B[]> {
  const { fetchProducts, mapProduct, langConfig, pageSize } = deps;
  logger.warn(`Category ${categoryId}: the storefront returned no books, trying the catalog API`);

  const books: B[] = [];
  const seen = new Set<string>();
  const maxPages = Math.ceil(limit / pageSize) * CATEGORY_FALLBACK_PAGE_FACTOR;
  let otherLanguage = 0;

  for (let page = 0; page < maxPages && books.length < limit; page++) {
    let products: P[];
    try {
      const envelope = await fetchProducts({
        category_id: categoryId,
        num_results: pageSize,
        page,
        products_sort_by: CATEGORY_FALLBACK_SORT,
      });
      products = envelope?.products ?? [];
    } catch (error) {
      logger.error(`Category ${categoryId}: catalog fallback failed on page ${page + 1}`, {
        error: error instanceof Error ? error.message : String(error),
        collectedSoFar: books.length,
      });
      break;
    }

    for (const product of products) {
      if (books.length >= limit) break;
      if (!product.asin || seen.has(product.asin)) continue;
      if (!product.language || !isAcceptedLanguage(product.language, langConfig)) {
        otherLanguage++;
        continue;
      }
      seen.add(product.asin);
      books.push(mapProduct(product));
    }

    if (products.length < pageSize) break;
  }

  logger.info(
    `Category ${categoryId}: collected ${books.length} books from the catalog API` +
      (otherLanguage > 0 ? ` (${otherLanguage} without the region's language left out)` : ''),
  );
  return books;
}
