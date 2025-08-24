/**
 * Get the base path for the application
 * This handles both local development and GitHub Pages deployment
 */
export function getBasePath(): string {
  // Check if we're running on GitHub Pages
  if (typeof window !== 'undefined') {
    const { hostname, pathname } = window.location;
    
    // GitHub Pages pattern: username.github.io/repository-name
    if (hostname.includes('github.io')) {
      // Extract the repository name from the path
      const pathSegments = pathname.split('/').filter(Boolean);
      if (pathSegments.length > 0 && pathSegments[0] === 'QIP-test') {
        return '/QIP-test';
      }
    }
  }
  
  // Use Vite's BASE_URL if available (set during build)
  if (import.meta.env.BASE_URL && import.meta.env.BASE_URL !== '/') {
    return import.meta.env.BASE_URL.endsWith('/') 
      ? import.meta.env.BASE_URL.slice(0, -1) 
      : import.meta.env.BASE_URL;
  }
  
  // Default to root for local development
  return '';
}

/**
 * Get the full path including the base path
 * @param path - The path relative to the app root
 * @returns The full path including the base
 */
export function getFullPath(path: string): string {
  const basePath = getBasePath();
  if (!basePath) return path;
  
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}

/**
 * Get asset URL with proper base path
 * @param assetPath - The asset path relative to public directory
 * @returns The full asset URL
 */
export function getAssetUrl(assetPath: string): string {
  const basePath = getBasePath();
  const normalizedPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  return basePath ? `${basePath}${normalizedPath}` : normalizedPath;
}