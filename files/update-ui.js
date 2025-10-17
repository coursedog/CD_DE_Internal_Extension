/**
 * ================================================================
 * Update UI Components
 * ================================================================
 * Handles UI for update notifications, approval dialogs, and progress
 * ================================================================
 */

class UpdateUI {
  constructor() {
    this.updateManager = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the UI components
   */
  async initialize(updateManager) {
    this.updateManager = updateManager;
    this.isInitialized = true;
    
    // Check if update is available and show banner
    if (this.updateManager.updateAvailable) {
      this.showUpdateBanner();
    }

    // Listen for update messages from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'updateAvailable') {
        this.showUpdateBanner();
      }
    });
  }

  /**
   * Show update available banner
   */
  showUpdateBanner() {
    if (!this.updateManager.pendingUpdate) return;

    const existingBanner = document.getElementById('update-banner');
    if (existingBanner) return; // Already showing

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.innerHTML = `
      <div class="update-banner-content">
        <span class="update-icon">🎉</span>
        <div class="update-text">
          <strong>Update Available!</strong>
          <span>Version ${this.updateManager.pendingUpdate.version} is ready to install</span>
        </div>
        <div class="update-actions">
          <button id="view-update-btn" class="btn btn-primary btn-sm">View Details</button>
          <button id="dismiss-update-btn" class="btn btn-secondary btn-sm">Dismiss</button>
        </div>
      </div>
    `;

    // Insert at the top of the main container
    const container = document.querySelector('.main-container .container');
    if (container) {
      container.insertBefore(banner, container.firstChild);

      // Attach event listeners
      document.getElementById('view-update-btn').addEventListener('click', () => {
        this.showUpdateDialog();
      });

      document.getElementById('dismiss-update-btn').addEventListener('click', () => {
        this.dismissUpdate();
      });
    }
  }

  /**
   * Show update details dialog
   */
  showUpdateDialog() {
    if (!this.updateManager.pendingUpdate) return;

    const update = this.updateManager.pendingUpdate;
    const fileCount = Object.keys(update.files).length;

    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'update-modal';
    modal.className = 'update-modal';
    modal.innerHTML = `
      <div class="update-modal-content">
        <div class="update-modal-header">
          <h2>🎉 Update Available</h2>
          <button id="close-update-modal" class="close-btn">&times;</button>
        </div>
        <div class="update-modal-body">
          <div class="update-version-info">
            <div class="version-badge">
              <span class="version-label">Current:</span>
              <span class="version-number" id="current-version">Loading...</span>
            </div>
            <span class="version-arrow">→</span>
            <div class="version-badge version-new">
              <span class="version-label">New:</span>
              <span class="version-number">${update.version}</span>
            </div>
          </div>

          <div class="update-section">
            <h3>📝 What's New</h3>
            <div class="changelog">
              ${this.formatChangelog(update.changelog)}
            </div>
          </div>

          <div class="update-section">
            <h3>📦 Files to Update</h3>
            <div class="file-list">
              <p><strong>${fileCount} files</strong> will be updated</p>
              <details>
                <summary>Show file list</summary>
                <ul>
                  ${Object.keys(update.files).map(file => `<li>${file}</li>`).join('')}
                </ul>
              </details>
            </div>
          </div>

          <div class="update-section">
            <h3>ℹ️ Update Process</h3>
            <ol class="update-steps">
              <li>Download updated files from GitHub</li>
              <li>Validate file integrity (checksums)</li>
              <li>Create backup of current version</li>
              <li>Apply updates</li>
              <li>Reload extension</li>
            </ol>
          </div>

          <div class="update-warning">
            ⚠️ <strong>Note:</strong> The extension will reload automatically after the update is applied.
            Any unsaved work will be lost.
          </div>
        </div>
        <div class="update-modal-footer">
          <button id="cancel-update-btn" class="btn btn-secondary">Cancel</button>
          <button id="install-update-btn" class="btn btn-primary">Install Update</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Load current version
    this.updateManager.getCurrentVersion().then(version => {
      document.getElementById('current-version').textContent = version;
    });

    // Attach event listeners
    document.getElementById('close-update-modal').addEventListener('click', () => {
      this.closeUpdateDialog();
    });

    document.getElementById('cancel-update-btn').addEventListener('click', () => {
      this.closeUpdateDialog();
    });

    document.getElementById('install-update-btn').addEventListener('click', () => {
      this.installUpdate();
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeUpdateDialog();
      }
    });
  }

  /**
   * Format changelog text
   */
  formatChangelog(changelog) {
    if (!changelog) return '<p>No changelog provided.</p>';
    
    // Convert markdown-style lists to HTML
    const lines = changelog.split('\n').map(line => {
      line = line.trim();
      if (line.startsWith('- ')) {
        return `<li>${line.substring(2)}</li>`;
      } else if (line) {
        return `<p>${line}</p>`;
      }
      return '';
    });

    const hasListItems = lines.some(l => l.startsWith('<li>'));
    if (hasListItems) {
      return `<ul>${lines.join('')}</ul>`;
    }
    return lines.join('');
  }

  /**
   * Close update dialog
   */
  closeUpdateDialog() {
    const modal = document.getElementById('update-modal');
    if (modal) {
      modal.remove();
    }
  }

  /**
   * Install update
   */
  async installUpdate() {
    const installBtn = document.getElementById('install-update-btn');
    const cancelBtn = document.getElementById('cancel-update-btn');
    
    // Disable buttons
    installBtn.disabled = true;
    cancelBtn.disabled = true;
    installBtn.textContent = 'Installing...';

    try {
      // Show progress
      this.showUpdateProgress();

      // Download and apply update
      await this.updateManager.downloadAndApplyUpdate();

      // Show success and reload prompt
      this.showUpdateSuccess();

    } catch (error) {
      console.error('[UpdateUI] Update failed:', error);
      this.showUpdateError(error.message);
      
      // Re-enable buttons
      installBtn.disabled = false;
      cancelBtn.disabled = false;
      installBtn.textContent = 'Install Update';
    }
  }

  /**
   * Show update progress
   */
  showUpdateProgress() {
    const modalBody = document.querySelector('.update-modal-body');
    if (!modalBody) return;

    modalBody.innerHTML = `
      <div class="update-progress-container">
        <div class="update-progress-spinner"></div>
        <h3>Installing Update...</h3>
        <p id="update-progress-text">Downloading files...</p>
        <div class="progress-bar">
          <div class="progress-fill" id="update-progress-fill" style="width: 0%"></div>
        </div>
      </div>
    `;
  }

  /**
   * Show update success
   */
  showUpdateSuccess() {
    const modalBody = document.querySelector('.update-modal-body');
    const modalFooter = document.querySelector('.update-modal-footer');
    
    if (!modalBody || !modalFooter) return;

    modalBody.innerHTML = `
      <div class="update-success-container">
        <div class="success-icon">✅</div>
        <h3>Update Installed Successfully!</h3>
        <p>The extension has been updated to the latest version.</p>
        <p>Click the button below to reload and apply the changes.</p>
      </div>
    `;

    modalFooter.innerHTML = `
      <button id="reload-extension-btn" class="btn btn-primary btn-large">🔄 Reload Extension</button>
    `;

    document.getElementById('reload-extension-btn').addEventListener('click', () => {
      chrome.runtime.reload();
    });
  }

  /**
   * Show update error
   */
  showUpdateError(errorMessage) {
    const modalBody = document.querySelector('.update-modal-body');
    
    if (!modalBody) return;

    modalBody.innerHTML = `
      <div class="update-error-container">
        <div class="error-icon">❌</div>
        <h3>Update Failed</h3>
        <p>An error occurred while installing the update:</p>
        <div class="error-message">${errorMessage}</div>
        <p>Please try again later or check your internet connection.</p>
      </div>
    `;
  }

  /**
   * Dismiss update notification
   */
  async dismissUpdate() {
    await this.updateManager.dismissUpdate();
    
    const banner = document.getElementById('update-banner');
    if (banner) {
      banner.remove();
    }
  }

  /**
   * Add "Check for Updates" button to settings/menu
   */
  addCheckUpdateButton(container) {
    const btn = document.createElement('button');
    btn.id = 'manual-check-update-btn';
    btn.className = 'btn btn-secondary';
    btn.style.marginTop = '12px';
    btn.innerHTML = '🔄 Check for Updates';
    
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Checking...';
      
      try {
        const result = await this.updateManager.checkForUpdates(false);
        
        if (result.updateAvailable) {
          this.showUpdateDialog();
        } else if (result.error) {
          alert(`Error checking for updates: ${result.message}`);
        } else {
          alert('You have the latest version!');
        }
      } catch (error) {
        alert(`Error checking for updates: ${error.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Check for Updates';
      }
    });

    container.appendChild(btn);
  }
}

// Make globally available (works in both service workers and regular scripts)
if (typeof window !== 'undefined') {
  window.UpdateUI = UpdateUI;
}
// In service workers, this is already global after importScripts

