/**
 * Component: Hardcover API Service
 * Documentation: documentation/backend/services/hardcover-sync.md
 *
 * GraphQL queries and API communication with the Hardcover platform.
 * Exports fetchHardcoverList for use by the sync orchestration layer.
 */

import axios from 'axios';

const HARDCOVER_API_URL = 'https://api.hardcover.app/v1/graphql';

export interface HardcoverApiBook {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
}

/**
 * Fetch a Hardcover List using their GraphQL API.
 * This handles both 'status_id' user_books or 'list_id' list_books queries.
 * For simplicity, we assume `listId` provided by the user is an Int corresponding to a list_id or status_id.
 */
export async function fetchHardcoverList(
  apiToken: string,
  listIdStr: string,
): Promise<{ listName: string; books: HardcoverApiBook[] }> {
  // Check if it's a status list
  const isStatus = listIdStr.startsWith('status-');

  if (isStatus) {
    const statusId = parseInt(listIdStr.replace('status-', ''), 10);
    const query = `
      query GetStatusBooks($statusId: Int!) {
        me {
          user_books(where: {status_id: {_eq: $statusId}}, limit: 100, order_by: {id: desc}) {
            book {
              id
              title
              contributions {
                author {
                  name
                }
              }
              cached_image
              image {
                url
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(
      HARDCOVER_API_URL,
      { query, variables: { statusId } },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    if (response.data?.errors) {
      throw new Error(
        `Hardcover API Error: ${response.data.errors[0]?.message}`,
      );
    }

    const userBooks = response.data?.data?.me?.[0]?.user_books || [];
    let listName = 'Hardcover Status List';

    // Map status numbers to names
    const statusNames: Record<number, string> = {
      1: 'Want to Read',
      2: 'Currently Reading',
      3: 'Read',
      4: 'Did Not Finish',
    };
    listName = statusNames[statusId] || `Status ${statusId}`;

    const books: HardcoverApiBook[] = [];
    for (const item of userBooks) {
      const book = item.book;
      if (!book || !book.id) continue;

      const authorName =
        book.contributions?.[0]?.author?.name || 'Unknown Author';
      const cachedImg = book.cached_image;
      const coverUrl =
        (typeof cachedImg === 'string' ? cachedImg : cachedImg?.url) ||
        book.image?.url ||
        undefined;

      books.push({
        bookId: book.id.toString(),
        title: book.title || 'Unknown Title',
        author: authorName,
        coverUrl,
      });
    }

    return { listName, books };
  } else {
    // Custom list query
    // - URL with @username → query that user's lists by slug
    // - Bare slug (no username) → query authenticated user's lists via `me`
    // - Numeric ID → query globally (IDs are unique)
    const isIntId = /^\d+$/.test(listIdStr);
    let extractedSlug = listIdStr;
    let extractedUsername: string | null = null;

    if (!isIntId) {
      try {
        if (listIdStr.includes('hardcover.app')) {
          const url = new URL(
            listIdStr.startsWith('http') ? listIdStr : `https://${listIdStr}`,
          );
          const parts = url.pathname.split('/').filter(Boolean);
          // URL format: /@username/lists/slug
          if (parts.length > 0) {
            extractedSlug = parts[parts.length - 1];
          }
          const userPart = parts.find((p) => p.startsWith('@'));
          if (userPart) {
            extractedUsername = userPart.slice(1);
          }
        }
      } catch (e) {
        // use extractedSlug as-is
      }
    }

    const listBookFields = `
      name
      list_books(limit: 100, order_by: {id: desc}) {
        book {
          id title cached_image image { url }
          contributions { author { name } }
        }
      }
    `;

    // Numeric ID: globally unique, query the lists table directly
    const queryById = `
      query GetListBooks($listId: Int!) {
        lists(where: {id: {_eq: $listId}}, limit: 1) {
          ${listBookFields}
        }
      }
    `;

    // Slug with username: query through the users table to scope to that user
    const queryByUserSlug = `
      query GetUserListBySlug($username: citext!, $slug: String!) {
        users(where: {username: {_eq: $username}}, limit: 1) {
          lists(where: {slug: {_eq: $slug}}, limit: 1) {
            ${listBookFields}
          }
        }
      }
    `;

    // Bare slug (no username): scope to the authenticated user via `me`
    const queryByMySlug = `
      query GetMyListBySlug($slug: String!) {
        me {
          lists(where: {slug: {_eq: $slug}}, limit: 1) {
            ${listBookFields}
          }
        }
      }
    `;

    let activeQuery: string;
    let variables: Record<string, unknown>;

    if (isIntId) {
      activeQuery = queryById;
      variables = { listId: parseInt(listIdStr, 10) };
    } else if (extractedUsername) {
      activeQuery = queryByUserSlug;
      variables = { username: extractedUsername, slug: extractedSlug };
    } else {
      activeQuery = queryByMySlug;
      variables = { slug: extractedSlug };
    }

    const response = await axios.post(
      HARDCOVER_API_URL,
      {
        query: activeQuery,
        variables,
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    if (response.data?.errors) {
      throw new Error(
        `Hardcover API Error: ${response.data.errors[0]?.message}`,
      );
    }

    // Extract lists array from the response based on which query was used
    let listsData: any[];
    if (isIntId) {
      listsData = response.data?.data?.lists || [];
    } else if (extractedUsername) {
      const users = response.data?.data?.users || [];
      listsData = users[0]?.lists || [];
    } else {
      listsData = response.data?.data?.me?.[0]?.lists || [];
    }

    if (listsData.length === 0) {
      let identifier: string;
      if (isIntId) {
        identifier = `ID "${listIdStr}"`;
      } else if (extractedUsername) {
        identifier = `slug "${extractedSlug}" for user @${extractedUsername}`;
      } else {
        identifier = `slug "${extractedSlug}" in your Hardcover account`;
      }
      throw new Error(`Could not find a list with ${identifier}`);
    }

    const listName = listsData[0].name || 'Hardcover List';
    const listBooks = listsData[0].list_books || [];

    const books: HardcoverApiBook[] = [];
    for (const item of listBooks) {
      const book = item.book;
      if (!book || !book.id) continue;

      const authorName =
        book.contributions?.[0]?.author?.name || 'Unknown Author';
      const cachedImg = book.cached_image;
      const coverUrl =
        (typeof cachedImg === 'string' ? cachedImg : cachedImg?.url) ||
        book.image?.url ||
        undefined;

      books.push({
        bookId: book.id.toString(),
        title: book.title || 'Unknown Title',
        author: authorName,
        coverUrl,
      });
    }

    return { listName, books };
  }
}
