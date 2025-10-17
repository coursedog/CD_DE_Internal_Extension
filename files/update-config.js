/**
 * ================================================================
 * Auto-Update Configuration
 * ================================================================
 * Configuration for the automatic update system that pulls updates
 * from GitHub repository
 * ================================================================
 */

const UPDATE_CONFIG = {
  /**
   * GitHub Repository Configuration
   * Base URL for fetching updates from GitHub raw content
   */
  githubBaseUrl: 'https://raw.githubusercontent.com/coursedog/CD_DE_Internal_Extension/main/',
  
  /**
   * Update Manifest File
   * Contains version info, changelog, and file checksums
   */
  manifestUrl: 'update-manifest.json',
  
  /**
   * Files Directory in GitHub
   * All updatable extension files are stored in this directory
   */
  filesBaseUrl: 'files/',
  
  /**
   * Update Check Interval
   * How often to check for updates (in milliseconds)
   * Default: 24 hours
   */
  checkInterval: 24 * 60 * 60 * 1000,
  
  /**
   * Files to Never Update
   * These files contain user-specific credentials and should never be replaced
   */
  excludedFiles: [
    'credentials.js',           // API credentials
    '.gitignore',               // Git configuration
    'update-manifest.json'      // The manifest itself
  ],
  
  /**
   * Backup Configuration
   * Number of previous versions to keep for rollback
   */
  backupRetention: 3,
  
  /**
   * Update Channel
   * Which update channel to follow
   * Options: 'production', 'beta' (future)
   */
  updateChannel: 'production',
  
  /**
   * Storage Keys
   * Chrome storage keys used by the update system
   */
  storageKeys: {
    lastCheck: 'update:lastCheck',
    availableUpdate: 'update:available',
    currentVersion: 'update:currentVersion',
    backups: 'update:backups',
    updateHistory: 'update:history'
  },
  
  /**
   * Notification Configuration
   */
  notifications: {
    enabled: true,
    showBadge: true,
    badgeText: 'NEW',
    badgeColor: '#e74c3c'
  },
  
  /**
   * Download Configuration
   */
  download: {
    timeout: 30000,           // 30 seconds per file
    maxRetries: 3,            // Retry failed downloads
    retryDelay: 2000          // 2 seconds between retries
  },
  
  /**
   * Validation Configuration
   */
  validation: {
    checksumAlgorithm: 'SHA-256',
    validateAll: true,        // Validate all files before applying
    strictMode: true          // Fail entire update if any file fails validation
  }
};

// Make globally available (works in both service workers and regular scripts)
if (typeof window !== 'undefined') {
  window.UPDATE_CONFIG = UPDATE_CONFIG;
}
// In service workers, this is already global after importScripts

