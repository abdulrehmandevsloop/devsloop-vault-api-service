/**
 * Returns the frontend base URL for links in emails and redirects.
 * Reads from process.env.FRONTEND_URL, trims trailing slashes.
 */
export function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
