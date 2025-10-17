/**
 * ================================================================
 * Auto-Update Manager
 * ================================================================
 * Handles checking for, downloading, validating, and applying updates
 * from GitHub repository
 * ================================================================
 */

class UpdateManager {
  constructor() {
    // Access config from global scope (works in both service workers and window context)
    this.config = (typeof window !== 'undefined' ? window.UPDATE_CONFIG : UPDATE_CONFIG) || {};
    this.updateAvailable = false;
    this.pendingUpdate = null;
    this.isChecking = false;
    this.isDownloading = false;
    this.isApplying = false;
  }

  /**
   * Initialize the update manager
   * Called when extension starts
   */
  async initialize() {
    console.log('[UpdateManager] Initializing...');
    
    // Check if enough time has passed since last check
    const lastCheck = await this.getLastCheckTime();
    const now = Date.now();
    const timeSinceLastCheck = now - lastCheck;
    
    if (timeSinceLastCheck >= this.config.checkInterval) {
      console.log('[UpdateManager] Time for update check');
      await this.checkForUpdates();
    } else {
      const hoursRemaining = Math.round((this.config.checkInterval - timeSinceLastCheck) / (1000 * 60 * 60));
      console.log(`[UpdateManager] Next check in ~${hoursRemaining} hours`);
    }
    
    // Check if there's a pending update from previous check
    await this.loadPendingUpdate();
  }

  /**
   * Get the last update check timestamp
   */
  async getLastCheckTime() {
    const data = await chrome.storage.local.get(this.config.storageKeys.lastCheck);
    return data[this.config.storageKeys.lastCheck] || 0;
  }

  /**
   * Set the last update check timestamp
   */
  async setLastCheckTime(timestamp) {
    await chrome.storage.local.set({
      [this.config.storageKeys.lastCheck]: timestamp
    });
  }

  /**
   * Load pending update from storage
   */
  async loadPendingUpdate() {
    const data = await chrome.storage.local.get(this.config.storageKeys.availableUpdate);
    this.pendingUpdate = data[this.config.storageKeys.availableUpdate] || null;
    this.updateAvailable = !!this.pendingUpdate;
    
    if (this.updateAvailable) {
      console.log('[UpdateManager] Pending update found:', this.pendingUpdate.version);
      await this.notifyUpdateAvailable();
    }
  }

  /**
   * Check for updates from GitHub
   */
  async checkForUpdates(force = false) {
    if (this.isChecking) {
      console.log('[UpdateManager] Already checking for updates');
      return { checking: true };
    }

    this.isChecking = true;
    console.log('[UpdateManager] Checking for updates...');

    try {
      // Download manifest from GitHub
      const manifest = await this.downloadManifest();
      
      if (!manifest) {
        console.log('[UpdateManager] No update manifest available (GitHub repo not set up or unavailable)');
        return {
          updateAvailable: false,
          message: 'Update system not configured yet'
        };
      }

      // Get current version from manifest.json
      const currentVersion = await this.getCurrentVersion();
      
      // Compare versions
      const hasUpdate = this.compareVersions(manifest.version, currentVersion) > 0;
      
      console.log(`[UpdateManager] Current: ${currentVersion}, Available: ${manifest.version}, Update: ${hasUpdate}`);

      // Update last check time
      await this.setLastCheckTime(Date.now());

      if (hasUpdate || force) {
        // Store pending update
        await chrome.storage.local.set({
          [this.config.storageKeys.availableUpdate]: {
            version: manifest.version,
            releaseDate: manifest.releaseDate,
            changelog: manifest.changelog,
            files: manifest.files,
            detectedAt: Date.now()
          }
        });

        this.updateAvailable = true;
        this.pendingUpdate = manifest;
        
        await this.notifyUpdateAvailable();
        
        return {
          updateAvailable: true,
          currentVersion,
          newVersion: manifest.version,
          changelog: manifest.changelog
        };
      }

      return {
        updateAvailable: false,
        currentVersion,
        message: 'You have the latest version'
      };

    } catch (error) {
      console.warn('[UpdateManager] Error checking for updates:', error.message);
      return {
        error: false, // Don't report as error - might just be repo not set up
        updateAvailable: false,
        message: 'Could not check for updates: ' + error.message
      };
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Download update manifest from GitHub
   */
  async downloadManifest() {
    const url = this.config.githubBaseUrl + this.config.manifestUrl;
    
    try {
      const response = await fetch(url, {
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status}`);
      }

      const manifest = await response.json();
      
      // Validate manifest structure
      if (!manifest.version || !manifest.files) {
        throw new Error('Invalid manifest structure');
      }

      return manifest;
    } catch (error) {
      console.warn('[UpdateManager] Could not download manifest (this is normal if GitHub repo is not set up yet):', error.message);
      return null; // Return null instead of throwing - GitHub repo might not be set up yet
    }
  }

  /**
   * Get current extension version
   */
  async getCurrentVersion() {
    const manifest = chrome.runtime.getManifest();
    return manifest.version;
  }

  /**
   * Compare two version strings (semver-like)
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    
    return 0;
  }

  /**
   * Download and apply the update
   */
  async downloadAndApplyUpdate() {
    if (!this.pendingUpdate) {
      throw new Error('No pending update available');
    }

    if (this.isDownloading || this.isApplying) {
      throw new Error('Update already in progress');
    }

    this.isDownloading = true;
    
    try {
      console.log('[UpdateManager] Starting update download...');
      
      // Step 1: Download all files
      const files = await this.downloadFiles(this.pendingUpdate.files);
      
      // Step 2: Validate checksums
      console.log('[UpdateManager] Validating files...');
      const valid = await this.validateFiles(files, this.pendingUpdate.files);
      
      if (!valid) {
        throw new Error('File validation failed');
      }

      this.isDownloading = false;
      this.isApplying = true;

      // Step 3: Create backup
      console.log('[UpdateManager] Creating backup...');
      await this.createBackup();

      // Step 4: Apply update
      console.log('[UpdateManager] Applying update...');
      await this.applyUpdate(files);

      // Step 5: Update version in storage
      await this.recordUpdateSuccess(this.pendingUpdate.version);

      // Clear pending update
      await chrome.storage.local.remove(this.config.storageKeys.availableUpdate);
      this.pendingUpdate = null;
      this.updateAvailable = false;

      console.log('[UpdateManager] Update completed successfully!');
      
      return {
        success: true,
        version: this.pendingUpdate.version
      };

    } catch (error) {
      console.error('[UpdateManager] Update failed:', error);
      this.isDownloading = false;
      this.isApplying = false;
      
      throw error;
    }
  }

  /**
   * Download files from GitHub
   */
  async downloadFiles(fileManifest) {
    const downloadedFiles = {};
    const filenames = Object.keys(fileManifest);
    
    // Filter out excluded files
    const filesToDownload = filenames.filter(filename => 
      !this.config.excludedFiles.includes(filename)
    );

    console.log(`[UpdateManager] Downloading ${filesToDownload.length} files...`);

    for (const filename of filesToDownload) {
      const url = this.config.githubBaseUrl + this.config.filesBaseUrl + filename;
      
      try {
        const response = await this.fetchWithRetry(url);
        const content = await response.text();
        
        downloadedFiles[filename] = content;
        console.log(`[UpdateManager] ✓ ${filename}`);
      } catch (error) {
        console.error(`[UpdateManager] ✗ Failed to download ${filename}:`, error);
        throw new Error(`Failed to download ${filename}`);
      }
    }

    return downloadedFiles;
  }

  /**
   * Fetch with retry logic
   */
  async fetchWithRetry(url, retries = this.config.download.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          cache: 'no-cache',
          signal: AbortSignal.timeout(this.config.download.timeout)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        
        console.log(`[UpdateManager] Retry ${attempt}/${retries} for ${url}`);
        await new Promise(resolve => setTimeout(resolve, this.config.download.retryDelay));
      }
    }
  }

  /**
   * Validate downloaded files against checksums
   */
  async validateFiles(downloadedFiles, fileManifest) {
    console.log('[UpdateManager] Validating file checksums...');
    
    for (const filename in downloadedFiles) {
      const content = downloadedFiles[filename];
      const expectedChecksum = fileManifest[filename].checksum;
      
      const actualChecksum = await this.calculateChecksum(content);
      
      if (actualChecksum !== expectedChecksum) {
        console.error(`[UpdateManager] Checksum mismatch for ${filename}`);
        console.error(`  Expected: ${expectedChecksum}`);
        console.error(`  Actual: ${actualChecksum}`);
        return false;
      }
      
      console.log(`[UpdateManager] ✓ ${filename} checksum valid`);
    }

    return true;
  }

  /**
   * Calculate SHA-256 checksum of content
   */
  async calculateChecksum(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  /**
   * Create backup of current files
   */
  async createBackup() {
    // For extension files, we store references to current versions
    // in chrome.storage.local for rollback capability
    const currentVersion = await this.getCurrentVersion();
    
    const backup = {
      version: currentVersion,
      timestamp: Date.now(),
      note: 'Backup before update'
    };

    // Get existing backups
    const data = await chrome.storage.local.get(this.config.storageKeys.backups);
    const backups = data[this.config.storageKeys.backups] || [];
    
    // Add new backup
    backups.unshift(backup);
    
    // Keep only last N backups
    if (backups.length > this.config.backupRetention) {
      backups.splice(this.config.backupRetention);
    }

    // Save backups
    await chrome.storage.local.set({
      [this.config.storageKeys.backups]: backups
    });

    console.log('[UpdateManager] Backup created');
  }

  /**
   * Apply update (replace extension files)
   */
  async applyUpdate(files) {
    // Note: Chrome extensions cannot directly write to their own files
    // Instead, we need to prompt the user to reload the extension
    // The actual file replacement must be done manually or via developer mode
    
    // For now, we'll store the updated files in chrome.storage
    // and notify the user to manually update or we provide instructions
    
    console.log('[UpdateManager] Update files ready. User must reload extension.');
    
    // Store update data for manual application
    await chrome.storage.local.set({
      'update:readyFiles': files,
      'update:readyVersion': this.pendingUpdate.version
    });
  }

  /**
   * Record successful update
   */
  async recordUpdateSuccess(version) {
    const data = await chrome.storage.local.get(this.config.storageKeys.updateHistory);
    const history = data[this.config.storageKeys.updateHistory] || [];
    
    history.unshift({
      version,
      timestamp: Date.now(),
      success: true
    });

    // Keep last 10 updates
    if (history.length > 10) {
      history.splice(10);
    }

    await chrome.storage.local.set({
      [this.config.storageKeys.updateHistory]: history,
      [this.config.storageKeys.currentVersion]: version
    });
  }

  /**
   * Notify that update is available
   */
  async notifyUpdateAvailable() {
    if (!this.config.notifications.enabled) return;

    // Set badge on extension icon
    if (this.config.notifications.showBadge) {
      try {
        await chrome.action.setBadgeText({
          text: this.config.notifications.badgeText
        });
        await chrome.action.setBadgeBackgroundColor({
          color: this.config.notifications.badgeColor
        });
      } catch (error) {
        console.error('[UpdateManager] Failed to set badge:', error);
      }
    }

    // Send message to popup if open
    try {
      chrome.runtime.sendMessage({
        type: 'updateAvailable',
        update: this.pendingUpdate
      });
    } catch (error) {
      // Popup not open, that's fine
    }
  }

  /**
   * Clear update notification
   */
  async clearUpdateNotification() {
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (error) {
      console.error('[UpdateManager] Failed to clear badge:', error);
    }
  }

  /**
   * Dismiss pending update
   */
  async dismissUpdate() {
    await chrome.storage.local.remove(this.config.storageKeys.availableUpdate);
    this.pendingUpdate = null;
    this.updateAvailable = false;
    await this.clearUpdateNotification();
  }
}

// Make globally available (works in both service workers and regular scripts)
if (typeof window !== 'undefined') {
  window.UpdateManager = UpdateManager;
}
// In service workers, this is already global after importScripts

