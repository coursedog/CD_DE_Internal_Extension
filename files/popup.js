class CoursedogReporter {
  constructor() {
    // Environment configurations
    this.environments = {
      staging: {
        name: 'Staging',
        baseUrl: 'https://staging.coursedog.com',
        color: '#3498db', // Blue
        icon: '🧪'
      },
      production: {
        name: 'Production',
        baseUrl: 'https://app.coursedog.com',
        color: '#e74c3c', // Red
        icon: '🔴'
      }
    };
    
    // Dual environment support - each school selector can use different environment
    this.mainSchoolEnvironment = 'staging'; // Default for main school
    this.baselineSchoolEnvironment = 'staging'; // Default for baseline school
    
    // Environment-specific credentials (loaded from credentials.js)
    this.environmentCredentials = window.APP_CREDENTIALS.coursedog;
    
    // Separate tokens for each environment
    this.stagingToken = '';
    this.productionToken = '';
    
    // Separate school lists for each environment
    this.stagingSchools = [];
    this.stagingBaselineSchools = [];
    this.productionSchools = [];
    this.productionBaselineSchools = [];
    
    // Track if production authentication failed
    this.productionAuthFailed = false;
    
    // Track environment for selected schools
    this.selectedMainSchool = { name: '', environment: '' };
    this.selectedBaselineSchool = { name: '', environment: '' };
    
    // Legacy properties (will be removed)
    this.token = '';
    this.schools = [];
    this.allSchools = [];
    this.baselineSchools = [];
    this.onlyBaselineFilterEnabled = true;
    this.mainSchool = '';
    this.baselineSchool = '';
    this.tempData = {};
    this.debugLog = [];
    this.notionLogger = new NotionLogger(); // Initialize NotionLogger
    window.notionLogger = this.notionLogger; // Make globally available
    this.comparisonReportKeys = [
      'stepsToExecute_Comparison_Report',
      'fieldExceptions_Comparison_Report',
      'courseTemplate_Comparison_Report',
      'programTemplate_Comparison_Report',
      'sectionTemplate_Comparison_Report',
      'AttributeMapping_Comparison_Report',
      'IntegrationFilters_Comparison_Report'
    ];
    this.activeDownloadUrls = new Set(); // Track active blob URLs for proper cleanup
    
    // Abort UI state
    this.abortRequestedAt = null;
    this.abortMessageTimerId = null;
    
    // Notion configuration (loaded from credentials.js)
    this.notionConfig = {
      secret: window.APP_CREDENTIALS.notion.secret,
      workspaceId: window.APP_CREDENTIALS.notion.workspaceId
    };
    
    // Initialize Notion client with NotionLogger
    this.notionClient = new NotionClient(this.notionConfig.secret, this.notionLogger);
    this.notionUploader = new NotionUploader(this.notionClient, this.notionLogger);
    window.notionUploader = this.notionUploader; // expose for download button helper

    // Default Notion URL used when no stored page id exists (loaded from credentials.js)
    this.DEFAULT_NOTION_URL = window.APP_CREDENTIALS.notion.defaultPageUrl;
    
    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => this.cleanupDownloadUrls());
    
    this.initializeEventListeners();
    this.loadStoredNotionPreferences && this.loadStoredNotionPreferences();
    this.loadEnvironmentPreference(); // Load environment before login
    this.loadSessionData();
    this.autoLogin();
    this.syncNotionUploadUiState();
    
    // Clean up old snapshots on extension load
    this.cleanupOldSnapshots().catch(console.warn);
    
    // ✅ Set up periodic banner refresh for live updates
    this.setupBannerRefresh();
    
    // ✅ Set up event listeners for dynamically created buttons
    this.setupDynamicEventListeners();
    
    // Initialize auto-update UI
    this.initializeUpdateUI();
  }

  /**
   * Initialize the auto-update UI
   */
  async initializeUpdateUI() {
    try {
      if (typeof UpdateUI !== 'undefined' && typeof UpdateManager !== 'undefined') {
        const updateManager = new UpdateManager();
        const updateUI = new UpdateUI();
        await updateUI.initialize(updateManager);
        console.log('[Popup] UpdateUI initialized');
      }
    } catch (error) {
      console.error('[Popup] Failed to initialize UpdateUI:', error);
    }
  }

  /**
   * Set up periodic refresh of banner for live updates
   */
  setupBannerRefresh() {
    // Refresh banner every 5 seconds when there are active jobs
    setInterval(async () => {
      try {
        const list = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'listUploadJobs' }, (r) => resolve(r));
        });
        
        if (list && list.ok && Array.isArray(list.jobs)) {
          const hasActiveJobs = list.jobs.some(j => 
            j && (j.status === 'running' || j.status === 'queued')
          );
          
          if (hasActiveJobs) {
            // Only refresh if there are active jobs to avoid unnecessary work
            this.syncNotionUploadUiState();
          }
        }
      } catch (e) {
        // Silently fail - this is just a background refresh
        console.debug('Banner refresh failed:', e);
      }
    }, 5000); // 5 seconds
  }
  async loadStoredNotionPreferences() {
    try {
      const { autoNotionUpload, notionTopLevelPageId } = await chrome.storage.local.get(['autoNotionUpload', 'notionTopLevelPageId']);
      const autoCheckbox = document.getElementById('send-to-notion-checkbox');
      if (autoCheckbox) {
        // Default to unchecked - users must explicitly opt-in
        autoCheckbox.checked = autoNotionUpload === true;
      }
      // Do not prefill the input (keeps it empty and focus-friendly). Show current status in feedback instead
      const feedback = document.getElementById('notion-top-level-url-feedback');
      if (feedback && notionTopLevelPageId) {
        feedback.style.display = 'block';
        feedback.textContent = `Current page id: ${notionTopLevelPageId}`;
        feedback.style.color = '#34495e';
      }

      // If no stored page id, prefill input with default Notion URL
      if (!notionTopLevelPageId) {
        const urlInput = document.getElementById('notion-top-level-url');
        if (urlInput && !urlInput.value) {
          urlInput.value = this.DEFAULT_NOTION_URL;
        }
      }
    } catch (e) {
      console.warn('Failed to load Notion prefs:', e);
    }
  }

  /**
   * Load stored environment preferences for both school selectors
   */
  async loadEnvironmentPreference() {
    try {
      const { mainSchoolEnv, baselineSchoolEnv } = await chrome.storage.local.get(['mainSchoolEnv', 'baselineSchoolEnv']);
      if (mainSchoolEnv && this.environments[mainSchoolEnv]) {
        this.mainSchoolEnvironment = mainSchoolEnv;
      }
      if (baselineSchoolEnv && this.environments[baselineSchoolEnv]) {
        this.baselineSchoolEnvironment = baselineSchoolEnv;
      }
      console.log(`🔄 Loaded preferences: Main=${this.mainSchoolEnvironment}, Baseline=${this.baselineSchoolEnvironment}`);
      // Update UI will happen after DOM is ready
    } catch (error) {
      console.error('Failed to load environment preferences:', error);
    }
  }

  /**
   * Update environment toggle UI states
   */
  updateEnvironmentToggles() {
    // Update main school environment toggle
    const mainEnvToggle = document.getElementById('main-env-toggle');
    if (mainEnvToggle) {
      mainEnvToggle.checked = (this.mainSchoolEnvironment === 'production');
      mainEnvToggle.disabled = this.productionAuthFailed;
      
      // Add tooltip if disabled
      if (this.productionAuthFailed) {
        const toggleSwitch = mainEnvToggle.closest('.env-toggle-switch-sm');
        if (toggleSwitch) {
          toggleSwitch.title = 'Production environment is unavailable';
          toggleSwitch.style.opacity = '0.5';
          toggleSwitch.style.cursor = 'not-allowed';
        }
      }
    }

    // Update baseline school environment toggle
    const baselineEnvToggle = document.getElementById('baseline-env-toggle');
    if (baselineEnvToggle) {
      baselineEnvToggle.checked = (this.baselineSchoolEnvironment === 'production');
      baselineEnvToggle.disabled = this.productionAuthFailed;
      
      // Add tooltip if disabled
      if (this.productionAuthFailed) {
        const toggleSwitch = baselineEnvToggle.closest('.env-toggle-switch-sm');
        if (toggleSwitch) {
          toggleSwitch.title = 'Production environment is unavailable';
          toggleSwitch.style.opacity = '0.5';
          toggleSwitch.style.cursor = 'not-allowed';
        }
      }
    }

    // Update label highlighting
    this.updateToggleLabels('main-env-toggle', this.mainSchoolEnvironment);
    this.updateToggleLabels('baseline-env-toggle', this.baselineSchoolEnvironment);
  }

  /**
   * Update toggle label highlighting
   */
  updateToggleLabels(toggleId, environment) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return;

    const container = toggle.closest('.env-selector-inline');
    if (!container) return;

    const labels = container.querySelectorAll('.env-toggle-label-sm');
    labels.forEach(label => {
      const labelEnv = label.getAttribute('data-env');
      if (labelEnv === environment) {
        label.classList.add('active');
      } else {
        label.classList.remove('active');
      }
    });
  }

  /**
   * Handle main school environment toggle
   * @param {boolean} isProduction - True if toggled to production
   */
  async handleMainEnvToggle(isProduction) {
    const newEnv = isProduction ? 'production' : 'staging';
    const oldEnv = this.mainSchoolEnvironment;
    
    if (newEnv === oldEnv) return; // No change

    try {
      console.log(`🔄 Switching main school environment: ${oldEnv} → ${newEnv}`);
      
      // Update environment
      this.mainSchoolEnvironment = newEnv;
      
      // Save preference
      await chrome.storage.local.set({ mainSchoolEnv: newEnv });
      
      // Clear main school selection since it may not exist in new environment
      this.mainSchool = '';
      this.selectedMainSchool = { name: '', environment: '' };
      
      // Show the school selection UI (reveals search box and dropdown)
      this.showSchoolSelection('main');
      
      // Load schools from new environment (will auth if needed)
      const mainSchoolDropdown = document.getElementById('main-school');
      if (mainSchoolDropdown) {
        mainSchoolDropdown.innerHTML = '<option value="">Loading schools...</option>';
      }
      
      await this.loadSchoolsForEnvironment(newEnv, 'main');
      
      // Update UI
      this.updateToggleLabels('main-env-toggle', newEnv);
      
      // Update generate button state
      this.checkSchoolSelection();
      
      console.log(`✅ Main school environment switched to ${newEnv}`);
      
    } catch (error) {
      console.error('Failed to switch main school environment:', error);
      
      // Revert on error
      this.mainSchoolEnvironment = oldEnv;
      document.getElementById('main-env-toggle').checked = (oldEnv === 'production');
      this.updateToggleLabels('main-env-toggle', oldEnv);
      
      alert(`Failed to load schools from ${newEnv}: ${error.message}\n\nReverted to ${oldEnv}.`);
    }
  }

  /**
   * Handle baseline school environment toggle
   * @param {boolean} isProduction - True if toggled to production
   */
  async handleBaselineEnvToggle(isProduction) {
    const newEnv = isProduction ? 'production' : 'staging';
    const oldEnv = this.baselineSchoolEnvironment;
    
    if (newEnv === oldEnv) return; // No change

    try {
      console.log(`🔄 Switching baseline school environment: ${oldEnv} → ${newEnv}`);
      
      // Update environment
      this.baselineSchoolEnvironment = newEnv;
      
      // Save preference
      await chrome.storage.local.set({ baselineSchoolEnv: newEnv });
      
      // Uncheck "show only baseline" filter when switching environments
      const baselineFilterToggle = document.getElementById('baseline-filter-toggle');
      if (baselineFilterToggle) {
        baselineFilterToggle.checked = false;
      }
      
      // Clear baseline school selection since it may not exist in new environment
      this.baselineSchool = '';
      this.selectedBaselineSchool = { name: '', environment: '' };
      
      // Show the school selection UI (reveals search box and dropdown)
      this.showSchoolSelection('baseline');
      
      // Load schools from new environment (will auth if needed)
      const baselineSchoolDropdown = document.getElementById('baseline-school');
      if (baselineSchoolDropdown) {
        baselineSchoolDropdown.innerHTML = '<option value="">Loading schools...</option>';
      }
      
      await this.loadSchoolsForEnvironment(newEnv, 'baseline');
      
      // Update UI
      this.updateToggleLabels('baseline-env-toggle', newEnv);
      
      // Update generate button state
      this.checkSchoolSelection();
      
      console.log(`✅ Baseline school environment switched to ${newEnv}`);
      
    } catch (error) {
      console.error('Failed to switch baseline school environment:', error);
      
      // Revert on error
      this.baselineSchoolEnvironment = oldEnv;
      document.getElementById('baseline-env-toggle').checked = (oldEnv === 'production');
      this.updateToggleLabels('baseline-env-toggle', oldEnv);
      
      alert(`Failed to load schools from ${newEnv}: ${error.message}\n\nReverted to ${oldEnv}.`);
    }
  }

  /**
   * Load schools for a specific environment and update the appropriate dropdown
   * @param {string} environment - 'staging' or 'production'
   * @param {string} selector - 'main' or 'baseline'
   */
  async loadSchoolsForEnvironment(environment, selector) {
    // Get schools from environment (will authenticate if needed)
    await this.getSchoolsFromEnvironment(environment);
    
    // Get the appropriate school lists
    const allSchools = environment === 'staging' ? this.stagingSchools : this.productionSchools;
    const baselineSchools = environment === 'staging' ? this.stagingBaselineSchools : this.productionBaselineSchools;
    
    // Update the appropriate dropdown
    if (selector === 'main') {
      this.populateMainSchoolDropdown(allSchools);
    } else {
      this.populateBaselineSchoolDropdown(baselineSchools, allSchools);
    }
  }

  /**
   * Populate main school dropdown - ONLY uses schools from mainSchoolEnvironment
   * @param {Array} schools - Array of schools to populate
   */
  populateMainSchoolDropdown(schools) {
    const dropdown = document.getElementById('main-school');
    if (!dropdown) return;
    
    // Clear dropdown completely
    dropdown.innerHTML = '';
    
    // Add placeholder
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a school...';
    dropdown.appendChild(placeholder);
    
    // Add schools from the SPECIFIC environment only
    if (schools && schools.length > 0) {
      schools.forEach(school => {
        const option = document.createElement('option');
        option.value = school.id;
        option.textContent = school.fullName || school.displayName || school.id;
        option.dataset.environment = this.mainSchoolEnvironment; // Mark which env this is from
        dropdown.appendChild(option);
      });
      console.log(`📋 Populated main dropdown with ${schools.length} schools from ${this.mainSchoolEnvironment}`);
    } else {
      console.warn('⚠️ No schools to populate for main dropdown');
    }
  }

  /**
   * Populate baseline school dropdown - ONLY uses schools from baselineSchoolEnvironment
   * @param {Array} baselineSchools - Array of baseline schools
   * @param {Array} allSchools - Array of all schools (for when filter is off)
   */
  populateBaselineSchoolDropdown(baselineSchools, allSchools) {
    const dropdown = document.getElementById('baseline-school');
    if (!dropdown) return;
    
    const filterToggle = document.getElementById('baseline-filter-toggle');
    const showOnlyBaseline = filterToggle ? filterToggle.checked : false;
    
    const schoolsToShow = showOnlyBaseline ? baselineSchools : allSchools;
    
    // Clear dropdown completely
    dropdown.innerHTML = '';
    
    // Add placeholder
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a school...';
    dropdown.appendChild(placeholder);
    
    // Add schools from the SPECIFIC environment only
    if (schoolsToShow && schoolsToShow.length > 0) {
      schoolsToShow.forEach(school => {
        const option = document.createElement('option');
        option.value = school.id;
        option.textContent = school.fullName || school.displayName || school.id;
        option.dataset.environment = this.baselineSchoolEnvironment; // Mark which env this is from
        dropdown.appendChild(option);
      });
      const filterStatus = showOnlyBaseline ? 'baseline only' : 'all schools';
      console.log(`📋 Populated baseline dropdown with ${schoolsToShow.length} ${filterStatus} from ${this.baselineSchoolEnvironment}`);
    } else {
      console.warn('⚠️ No schools to populate for baseline dropdown');
    }
  }

  /**
   * Hide selected school display
   * @param {string} selector - 'main' or 'baseline'
   */
  hideSelectedSchool(selector) {
    const selectedDiv = document.getElementById(`${selector}-school-selected`);
    const dropdown = document.getElementById(`${selector}-school`);
    
    if (selectedDiv) {
      selectedDiv.style.display = 'none';
    }
    if (dropdown) {
      dropdown.style.display = 'block';
      dropdown.value = '';
    }
    
    // Clear tracked selection
    if (selector === 'main') {
      this.selectedMainSchool = { name: '', environment: '' };
    } else if (selector === 'baseline') {
      this.selectedBaselineSchool = { name: '', environment: '' };
    }
  }

  /**
   * Authenticate to a specific environment with retry logic
   * @param {string} environment - 'staging' or 'production'
   * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
   * @returns {Promise<boolean>} True if successful
   */
  async authenticateToEnvironment(environment, maxRetries = 3) {
    if (!this.environments[environment]) {
      console.error(`Invalid environment: ${environment}`);
      return false;
    }

    const credentials = this.environmentCredentials[environment];
    const baseUrl = this.environments[environment].baseUrl;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔐 Authenticating to ${environment} as ${credentials.email}... (attempt ${attempt}/${maxRetries})`);
        
        const authResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(credentials),
          credentials: 'include'
        });

        if (!authResponse.ok) {
          throw new Error(`Authentication failed: ${authResponse.status}`);
        }

        const authData = await authResponse.json();
        const token = this.extractTokenFromResponse(authData);

        if (!token) {
          throw new Error('No token received from authentication response');
        }

        if (environment === 'staging') {
          this.stagingToken = token;
        } else {
          this.productionToken = token;
        }

        console.log(`✅ Token received for ${environment}, verifying...`);
        
        // Verify the token works by making a test request
        const verifyResponse = await fetch(`${baseUrl}/api/v1/admin/schools/displayNames`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Auth-Token': token,
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include'
        });

        if (!verifyResponse.ok) {
          throw new Error(`Token verification failed: ${verifyResponse.status}`);
        }

        console.log(`✅ Successfully authenticated to ${environment} and verified on attempt ${attempt}`);
        
        // Small delay to ensure everything is stable
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return true;

      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Authentication attempt ${attempt}/${maxRetries} to ${environment} failed:`, error.message);
        
        // If this isn't the last attempt, wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s (max 5s)
          console.log(`⏳ Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    console.error(`❌ Failed to authenticate to ${environment} after ${maxRetries} attempts:`, lastError);
    return false;
  }

  /**
   * Get schools from a specific environment
   * @param {string} environment - 'staging' or 'production'
   * @returns {Promise<Array>} Array of schools
   */
  async getSchoolsFromEnvironment(environment) {
    if (!this.environments[environment]) {
      console.error(`Invalid environment: ${environment}`);
      return [];
    }

    // Check if we have a token for this environment
    const token = environment === 'staging' ? this.stagingToken : this.productionToken;
    
    // If no token, authenticate first
    if (!token) {
      const authSuccess = await this.authenticateToEnvironment(environment);
      if (!authSuccess) {
        throw new Error(`Failed to authenticate to ${environment}`);
      }
    }

    const baseUrl = this.environments[environment].baseUrl;
    const currentToken = environment === 'staging' ? this.stagingToken : this.productionToken;

    try {
      const response = await fetch(`${baseUrl}/api/v1/admin/schools/displayNames`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
          'X-Auth-Token': currentToken,
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch schools: ${response.status}`);
      }

      const schoolsData = await response.json();
      const schools = Object.values(schoolsData).sort((a, b) => 
        (a.fullName || a.displayName || a.id).localeCompare(b.fullName || b.displayName || b.id)
      );

      const baselineSchools = schools.filter(school => 
        (school.displayName && school.displayName.toLowerCase().includes('baseline')) ||
        (school.fullName && school.fullName.toLowerCase().includes('baseline'))
      );

      // Cache the schools
      if (environment === 'staging') {
        this.stagingSchools = schools;
        this.stagingBaselineSchools = baselineSchools;
      } else {
        this.productionSchools = schools;
        this.productionBaselineSchools = baselineSchools;
      }

      console.log(`📚 Loaded ${schools.length} schools from ${environment} (${baselineSchools.length} baseline)`);
      return schools;

    } catch (error) {
      console.error(`Failed to load schools from ${environment}:`, error);
      throw error;
    }
  }


  async syncNotionUploadUiState() {
    try {
      const list = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'listUploadJobs' }, (r) => resolve(r));
      });
      let running = false;
      let currentJob = null;
      let queuedJobs = [];
      
      if (list && list.ok && Array.isArray(list.jobs)) {
        // Get current running job
        currentJob = list.jobs.find(j => j && j.status === 'running') || null;
        running = currentJob !== null;
        
        // Get queued jobs
        queuedJobs = list.jobs.filter(j => j && j.status === 'queued');
      }

      const banner = document.getElementById('notion-upload-banner');
      const queueStatusDiv = document.getElementById('notion-queue-status');
      const queueStatusText = document.getElementById('queue-status-text');
      const btn = document.getElementById('send-to-notion-btn');
      const abortBtn = document.getElementById('abort-notion-btn');
      const autoCheckbox = document.getElementById('send-to-notion-checkbox');
      const urlInput = document.getElementById('notion-top-level-url');
      const verifyBtn = document.getElementById('verify-notion-url-btn');
      const progressEl = document.getElementById('notion-progress');
      const progressTextEl = document.getElementById('notion-progress-text');
      const progressFillEl = document.getElementById('notion-progress-fill');
      
      // ✅ Generate smart banner text
      const queueStatus = {
        currentJob,
        queuedJobs,
        totalEstimatedTime: this.calculateTotalQueueTime(queuedJobs, currentJob)
      };
      
      const smartBannerHtml = this.generateSmartBannerText(queueStatus);
      
      // ✅ Update queue progress display
      this.updateQueueProgress(queueStatus);
      
      // ✅ Show queue status (simplified - smart banner handles most info)
      if (queueStatusDiv && queueStatusText) {
        if (queuedJobs.length > 0 && !running) {
          queueStatusDiv.style.display = 'block';
          queueStatusText.textContent = `${queuedJobs.length} job(s) queued • Next starts automatically`;
        } else if (running && queuedJobs.length > 0) {
          queueStatusDiv.style.display = 'block';
          queueStatusText.textContent = `1 uploading, ${queuedJobs.length} queued • Next starts automatically`;
        } else {
          queueStatusDiv.style.display = 'none';
        }
      }
      
      if (running || queuedJobs.length > 0) {
        // Only show banner if "Info for Nerds" is enabled
        const isNerdMode = document.getElementById('info-for-nerds-checkbox')?.checked;
        if (banner) {
          banner.style.display = isNerdMode ? 'block' : 'none';
          // ✅ Use smart banner text
          if (smartBannerHtml) {
            banner.innerHTML = smartBannerHtml;
            // Set up event listeners for the new buttons
            this.setupDynamicEventListeners();
          } else {
            // Fallback to simple banner
            const progressPercent = currentJob && currentJob.progress ? currentJob.progress.percent || 0 : 0;
            banner.innerHTML = `
              ⏳ Notion upload in progress (${progressPercent}%). 
              This will continue in the background. 
              You can close this window or generate a new report.
            `;
          }
        }
        if (abortBtn) { abortBtn.style.display = 'inline-block'; abortBtn.disabled = false; }
        if (autoCheckbox) autoCheckbox.disabled = false; // ✅ Allow checkbox toggle
        if (urlInput) urlInput.disabled = true;
        if (verifyBtn) verifyBtn.disabled = true;
        if (progressEl) {
          progressEl.style.display = 'flex';
          if (currentJob && currentJob.progress) {
            const p = currentJob.progress.percent;
            const msg = currentJob.progress.lastMessage || '';
            if (typeof p === 'number' && !Number.isNaN(p)) {
              if (progressTextEl) progressTextEl.textContent = msg && msg.includes('%') ? msg : `${p}% - ${msg || 'Working...'}`.trim();
              if (progressFillEl) progressFillEl.style.width = `${p}%`;
            } else if (msg) {
              if (progressTextEl) progressTextEl.textContent = msg;
            }
          }
        }
      } else {
        if (banner) banner.style.display = 'none';
        if (abortBtn) { abortBtn.disabled = true; }
        if (autoCheckbox) autoCheckbox.disabled = false;
        if (urlInput) urlInput.disabled = false;
        if (verifyBtn) verifyBtn.disabled = false;
        // Reset abort button UI after job stops
        if (abortBtn) {
          abortBtn.disabled = false;
          abortBtn.textContent = '🛑 Abort Notion Upload';
        }
        // Clear abort feedback message
        const feedback = document.getElementById('notion-top-level-url-feedback');
        if (feedback && this.abortRequestedAt) {
          feedback.style.display = 'none';
          feedback.textContent = '';
          feedback.style.color = '';
          this.abortRequestedAt = null;
          // Clear the abort message timer
          if (this.abortMessageTimerId) {
            try { clearTimeout(this.abortMessageTimerId); } catch (_) {}
            this.abortMessageTimerId = null;
          }
        }
        if (progressEl) {
          progressEl.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('Failed to sync Notion UI state:', e);
    }
  }

  /**
   * Check if a Notion upload is currently in progress
   * @returns {Promise<boolean>} True if upload is in progress
   */
  async checkNotionUploadInProgress() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'listUploadJobs' }, resolve);
      });
      
      if (response && response.ok && Array.isArray(response.jobs)) {
        return response.jobs.some(job => 
          job && 
          job.status === 'running' && 
          job.progress && 
          job.progress.lastHeartbeatAt &&
          (Date.now() - new Date(job.progress.lastHeartbeatAt).getTime()) < 120000 // Active within last 2 minutes
        );
      }
    } catch (error) {
      console.warn('Failed to check upload status:', error);
    }
    
    return false;
  }

  // Clean up blob URLs to free memory
  cleanupDownloadUrls() {
    for (const url of this.activeDownloadUrls) {
      URL.revokeObjectURL(url);
    }
    this.activeDownloadUrls.clear();
  }

  initializeEventListeners() {
    document.getElementById('generate-report-btn').addEventListener('click', () => this.handleGenerateReport());
    document.getElementById('reset-btn').addEventListener('click', () => this.handleReset());
    
    // Main school environment toggle handler
    const mainEnvToggle = document.getElementById('main-env-toggle');
    if (mainEnvToggle) {
      mainEnvToggle.addEventListener('change', async (e) => {
        await this.handleMainEnvToggle(e.target.checked);
      });
    }

    // Baseline school environment toggle handler
    const baselineEnvToggle = document.getElementById('baseline-env-toggle');
    if (baselineEnvToggle) {
      baselineEnvToggle.addEventListener('change', async (e) => {
        await this.handleBaselineEnvToggle(e.target.checked);
      });
    }

    // Baseline filter toggle handler
    const baselineFilterToggle = document.getElementById('baseline-filter-toggle');
    if (baselineFilterToggle) {
      baselineFilterToggle.addEventListener('change', (e) => {
        // Repopulate baseline dropdown based on filter state
        const env = this.baselineSchoolEnvironment;
        const allSchools = env === 'staging' ? this.stagingSchools : this.productionSchools;
        const baselineSchools = env === 'staging' ? this.stagingBaselineSchools : this.productionBaselineSchools;
        this.populateBaselineSchoolDropdown(baselineSchools, allSchools);
      });
    }
    
    // Add direct event listeners to change buttons
    this.setupChangeButtonListeners();
    
    // Debug functionality and other buttons
    document.addEventListener('click', (e) => {
      console.log('🔥 Document click detected on:', e.target, 'Classes:', e.target.classList);
      
      if (e.target.id === 'debug-data-btn') {
        this.showDebugData();
      }
      if (e.target.id === 'download-zip-btn') {
        this.downloadAllAsZip();
      }
      if (e.target.id === 'load-zip-btn') {
        const input = document.getElementById('load-zip-input');
        if (input) input.click();
      }
      if (e.target.id === 'simple-report-download') {
        this.downloadSimpleReport();
      }
      if (e.target.id === 'view-reports-btn') {
        this.openReportViewer();
      }
      // Handle change buttons with event delegation
      if (e.target.classList.contains('change-btn')) {
        console.log('🔥 Change button clicked via event delegation!', e.target);
        this.handleChangeButtonClick(e);
      }
      if (e.target.id === 'send-to-notion-btn') {
        if (e.target.disabled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        this.showNotionUploadConfirmation();
      }
      if (e.target.id === 'abort-notion-btn') {
        this.abortNotionUpload();
      }
      if (e.target.id === 'copy-notion-url') {
        this.copyNotionUrl();
      }
      if (e.target.id === 'open-notion-url') {
        this.openNotionUrl();
      }
      if (e.target.id === 'retry-notion-upload') {
        this.handleNotionUpload();
      }
      if (e.target.id === 'verify-notion-url-btn') {
        this.handleVerifyNotionUrl();
      }
    });

    // Listen for background job updates to resync UI immediately
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'jobsUpdated') {
        this.syncNotionUploadUiState();
      } else if (msg && msg.type === 'jobProgress') {
        // ✅ Enhanced progress updates with smart banner refresh
        const percent = typeof msg.percent === 'number' ? msg.percent : null;
        const message = msg.message || '';
        const progressFill = document.getElementById('notion-progress-fill');
        
        if (percent !== null && !Number.isNaN(percent)) {
          if (progressFill) progressFill.style.width = `${percent}%`;
          if (message && message.includes('%')) {
            this.updateNotionProgressText(message);
          } else {
            this.updateNotionProgressText(`${percent}% - ${message || 'Working...'}`.trim());
          }
        } else if (message) {
          this.updateNotionProgressText(message);
        }
        
        // ✅ Trigger smart banner update on progress changes
        this.syncNotionUploadUiState();
        // ✅ Refresh queue details if open
        this.refreshQueueDetails();
      } else if (msg && msg.type === 'jobCompleted') {
        // Reflect completion in UI if popup is open
        const url = msg.notionUrl || '';
        if (url) {
          this.showNotionResult(url);
          this.hideNotionProgress();
          // Re-enable button state
          const btn = document.getElementById('send-to-notion-btn');
          if (btn) { btn.disabled = false; btn.innerHTML = '<span class="notion-icon">📝</span> Send to Notion'; }
          // Render artifact download buttons
          this.renderNotionArtifactsDownload(msg.jobId || '__latest__');
        } else {
          this.updateNotionProgressText('Upload complete.');
        }
        // ✅ Resync UI state to reflect completion and update banner
        this.syncNotionUploadUiState();
        // ✅ Refresh queue details if open
        this.refreshQueueDetails();
      } else if (msg && msg.type === 'jobFailed') {
        const errMsg = (msg.error && msg.error.message) ? msg.error.message : 'Upload failed.';
        this.showNotionError(errMsg);
        this.hideNotionProgress();
        const btn = document.getElementById('send-to-notion-btn');
        if (btn) { btn.disabled = false; btn.innerHTML = '<span class="notion-icon">📝</span> Send to Notion'; }
        // ✅ Resync UI state to reflect failure and update banner
        this.syncNotionUploadUiState();
        // ✅ Refresh queue details if open
        this.refreshQueueDetails();
      }
    });
    // Load ZIP change handler
    const loadZipInput = document.getElementById('load-zip-input');
    if (loadZipInput) {
      loadZipInput.addEventListener('change', (ev) => this.handleLoadZip(ev));
    }

    // Info for nerds checkbox toggle
    document.addEventListener('change', (e) => {
      if (e.target.id === 'info-for-nerds-checkbox') {
        this.toggleAdvancedOptions(e.target.checked);
      }
      if (e.target.id === 'experimental-features-checkbox') {
        this.toggleExperimentalFeatures(e.target.checked);
      }
    });
    
    // Report type checkboxes
    document.getElementById('curriculum-checkbox').addEventListener('change', (e) => {
      this.logProgress(`Curriculum reports ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
    });
    
    document.getElementById('scheduling-checkbox').addEventListener('change', (e) => {
      this.logProgress(`Scheduling reports ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
    });

    // Baseline filter toggle
    const baselineToggle = document.getElementById('baseline-filter-toggle');
    if (baselineToggle) {
      // Default checked in HTML; reflect into state
      this.onlyBaselineFilterEnabled = !!baselineToggle.checked;
      baselineToggle.addEventListener('change', () => {
        this.onlyBaselineFilterEnabled = !!baselineToggle.checked;
        const query = (document.getElementById('baseline-school-search')?.value || '').trim();
        const pool = this.getBaselinePool();
        const filtered = query ? this.fuzzySearch(query, pool) : pool;
        this.updateDropdown('baseline-school', filtered, 'Select a baseline school...', query);
      });
    }
    
    // Search functionality
    document.getElementById('main-school-search').addEventListener('input', (e) => this.handleMainSchoolSearch(e.target.value));
    document.getElementById('baseline-school-search').addEventListener('input', (e) => this.handleBaselineSchoolSearch(e.target.value));
    
    // School selection
    document.getElementById('main-school').addEventListener('change', (e) => this.handleSchoolSelection(e, 'main'));
    document.getElementById('baseline-school').addEventListener('change', (e) => this.handleSchoolSelection(e, 'baseline'));

    // Notion auto-upload and URL input
    const autoCheckbox = document.getElementById('send-to-notion-checkbox');
    if (autoCheckbox) {
      autoCheckbox.addEventListener('change', async (e) => {
        try { await chrome.storage.local.set({ autoNotionUpload: !!e.target.checked }); } catch (_) {}
      });
    }
    
    // Open hardcoded Notion parent page in new tab
    const openNotionBtn = document.getElementById('open-notion-page-btn');
    if (openNotionBtn) {
      openNotionBtn.addEventListener('click', () => {
        const hardcodedPageId = '265f804589d180518502d2db7c9f8ce6';
        const workspaceId = 'coursedog1';
        // Construct Notion URL
        const notionUrl = `https://www.notion.so/${workspaceId}/${hardcodedPageId}`;
        window.open(notionUrl, '_blank');
      });
    }
    
    const urlInput = document.getElementById('notion-top-level-url');
    if (urlInput) {
      // Only validate on Enter or Verify, not on blur
      urlInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          this.handleSetNotionUrl(urlInput.value);
        }
      });
      urlInput.addEventListener('input', () => {
        const feedback = document.getElementById('notion-top-level-url-feedback');
        if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; feedback.style.color = ''; }
      });
    }
  }

  /**
   * Render download buttons for Notion artifacts (upload report + API logs)
   * @param {string} jobId
   */
  async renderNotionArtifactsDownload(jobId) {
    try {
      const resultContainer = document.getElementById('notion-result');
      if (!resultContainer) return;

      // Read artifacts from storage
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'storage:get', area: 'local', key: `artifacts:${jobId}` }, (r) => resolve(r));
      });
      if (!resp || !resp.ok || !resp.value) return;
      const artifacts = resp.value;

      // Helper to create a download button
      const makeBtn = (label, filename, mime, content) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = 'margin-top:10px;padding:8px 16px;background:#2d3436;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;width:100%;display:block;';
        btn.addEventListener('click', () => {
          try {
            const blob = new Blob([content], { type: mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename || 'download';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (e) { console.error('Download failed:', e); }
        });
        return btn;
      };

      // Upload report
      if (artifacts.uploadReport && artifacts.uploadReport.content) {
        const btn = makeBtn('📄 Download Notion Upload Report', artifacts.uploadReport.filename, artifacts.uploadReport.mime, artifacts.uploadReport.content);
        resultContainer.appendChild(btn);
      }

      // Notion API logs
      if (artifacts.notionLogs && artifacts.notionLogs.content) {
        const btn = makeBtn('📋 Download Notion API Logs', artifacts.notionLogs.filename, artifacts.notionLogs.mime, artifacts.notionLogs.content);
        resultContainer.appendChild(btn);
      }
    } catch (e) {
      console.warn('Failed to render Notion artifacts:', e);
    }
  }

  async abortNotionUpload() {
    try {
      // Immediate UI change
      const abortBtn = document.getElementById('abort-notion-btn');
      if (abortBtn) {
        abortBtn.disabled = true;
        abortBtn.textContent = '🛑 Aborting...';
        abortBtn.style.display = 'inline-block';
        abortBtn.style.whiteSpace = 'normal';
        abortBtn.style.lineHeight = '1.2';
      }
      const feedbackImmediate = document.getElementById('notion-top-level-url-feedback');
      if (feedbackImmediate) {
        feedbackImmediate.style.display = 'block';
        feedbackImmediate.textContent = 'Abort requested. Due to multiple ongoing requests, this may take up to 1 minute.';
        feedbackImmediate.style.color = '#d35400';
      }
      // Track abort request time and schedule a 60s final message
      this.abortRequestedAt = Date.now();
      if (this.abortMessageTimerId) { try { clearTimeout(this.abortMessageTimerId); } catch (_) {} }
      this.abortMessageTimerId = setTimeout(() => {
        const btn = document.getElementById('abort-notion-btn');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Notion Upload Aborted. Click on "Start New Report" to refresh the tool';
          btn.style.whiteSpace = 'normal';
          btn.style.lineHeight = '1.2';
        }
      }, 60000);

      // Send cancel to background
      const latest = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getUploadJob', jobId: '__latest__' }, (r) => resolve(r));
      });
      const job = latest && latest.ok ? latest.job : null;
      if (!job || job.status !== 'running') {
        this.logNotionProgress('No running Notion upload to abort.', 'info');
        return;
      }
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'offscreenCancelJob', jobId: job.id }, () => resolve());
      });
      this.logNotionProgress('Abort signal sent. Upload will stop shortly.', 'warning');
    } catch (e) {
      console.error('Abort error:', e);
      this.logNotionProgress('Failed to send abort signal.', 'error');
      const feedback = document.getElementById('notion-top-level-url-feedback');
      if (feedback) {
        feedback.style.display = 'block';
        feedback.textContent = 'Failed to send abort signal.';
        feedback.style.color = '#c0392b';
      }
      const abortBtn = document.getElementById('abort-notion-btn');
      if (abortBtn) {
        abortBtn.disabled = false;
        abortBtn.textContent = '🛑 Abort Notion Upload';
      }
    }
  }

  setupChangeButtonListeners() {
    console.log('🔥 Setting up Change button listeners...');
    
    // Create a bound version of the handler once
    if (!this.boundChangeHandler) {
      this.boundChangeHandler = this.handleChangeButtonClick.bind(this);
    }
    
    // Set up change button listeners with retry logic
    const setupListeners = () => {
      const changeButtons = document.querySelectorAll('.change-btn');
      console.log('🔥 Found change buttons in setupListeners:', changeButtons.length);
      
      changeButtons.forEach((btn, index) => {
        console.log(`🔥 Setting up listener for button ${index}:`, btn);
        // Remove any existing listeners to avoid duplicates
        btn.removeEventListener('click', this.boundChangeHandler);
        // Add the listener
        btn.addEventListener('click', this.boundChangeHandler);
        console.log(`🔥 Listener added to button ${index}`);
        
        // Test if button is clickable
        btn.style.border = '2px solid red';
        setTimeout(() => {
          btn.style.border = '';
        }, 1000);
      });
    };

    // Try immediately
    setupListeners();
    
    // Retry after a short delay in case DOM isn't ready
    setTimeout(setupListeners, 500);
    setTimeout(setupListeners, 1000);

    // Set up MutationObserver to watch for when Change buttons become visible
    this.setupChangeButtonObserver();
  }

  setupChangeButtonObserver() {
    // Watch for changes to the selected school divs
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const target = mutation.target;
          if (target.classList.contains('selected-school') && target.style.display === 'flex') {
            // A Change button just became visible, set up its listener
            const changeButton = target.querySelector('.change-btn');
            if (changeButton) {
              if (!this.boundChangeHandler) {
                this.boundChangeHandler = this.handleChangeButtonClick.bind(this);
              }
              changeButton.removeEventListener('click', this.boundChangeHandler);
              changeButton.addEventListener('click', this.boundChangeHandler);
              console.log('🔥 MutationObserver: Added listener to change button');
            }
          }
        }
      });
    });

    // Observe the main container for changes
    const mainContainer = document.querySelector('#school-section');
    if (mainContainer) {
      observer.observe(mainContainer, {
        attributes: true,
        subtree: true,
        attributeFilter: ['style']
      });
    }
  }

  handleChangeButtonClick(e) {
    console.log('🔥 Change button clicked!', e.target);
    console.log('🔥 Event details:', e);
    console.log('🔥 this context:', this);
    console.log('🔥 this.showSchoolSelection exists:', typeof this.showSchoolSelection);
    
    // Find the search container more safely
    const searchContainer = e.target.closest('.search-container');
    if (!searchContainer) {
      console.error('🔥 Could not find search container');
      return;
    }
    
    const selectElement = searchContainer.querySelector('select');
    if (!selectElement) {
      console.error('🔥 Could not find select element');
      return;
    }
    
    const schoolType = selectElement.id.includes('main') ? 'main' : 'baseline';
    console.log('🔥 School type detected:', schoolType);
    console.log('🔥 About to call showSchoolSelection...');
    try {
      this.showSchoolSelection(schoolType);
      console.log('🔥 showSchoolSelection call completed');
    } catch (error) {
      console.error('🔥 Error calling showSchoolSelection:', error);
    }
  }

  // Test function for debugging (can be called from browser console)
  testChangeButtons() {
    console.log('🔥 Testing Change buttons...');
    const changeButtons = document.querySelectorAll('.change-btn');
    console.log('🔥 Found change buttons:', changeButtons.length);
    
    if (changeButtons.length === 0) {
      console.log('🔥 NO BUTTONS FOUND! Checking DOM structure...');
      const mainSelected = document.getElementById('main-school-selected');
      const baselineSelected = document.getElementById('baseline-school-selected');
      console.log('🔥 Main selected div:', mainSelected);
      console.log('🔥 Baseline selected div:', baselineSelected);
      if (mainSelected) {
        console.log('🔥 Main selected display:', mainSelected.style.display);
        console.log('🔥 Main selected innerHTML:', mainSelected.innerHTML);
      }
      if (baselineSelected) {
        console.log('🔥 Baseline selected display:', baselineSelected.style.display);
        console.log('🔥 Baseline selected innerHTML:', baselineSelected.innerHTML);
      }
    }
    
    changeButtons.forEach((btn, index) => {
      console.log(`🔥 Button ${index}:`, btn, 'Visible:', btn.offsetParent !== null);
      console.log(`🔥 Button ${index} classes:`, btn.classList);
      console.log(`🔥 Button ${index} parent:`, btn.parentElement);
    });
    
    // Test clicking programmatically
    if (changeButtons.length > 0) {
      console.log('🔥 Testing programmatic click on first button...');
      changeButtons[0].click();
    }
  }

  async autoLogin() {
    // ✅ Check if we have session data WITHOUT restoring it
    const sessionInfo = await this.checkSessionData();
    
    // Authenticate to BOTH environments on startup
    this.updateLoadingStatus('Authenticating to Staging...');
    
    try {
      // Authenticate to staging (required)
      const stagingAuthSuccess = await this.authenticateToEnvironment('staging');
      
      if (!stagingAuthSuccess) {
        throw new Error('Failed to authenticate to staging environment');
      }
      
      this.updateLoadingStatus('Authenticating to Staging... ✅');
      
      // Authenticate to production (optional - continue if fails)
      this.updateLoadingStatus('Authenticating to Production... (this may take a moment)');
      const productionAuthSuccess = await this.authenticateToEnvironment('production');
      
      if (productionAuthSuccess) {
        this.updateLoadingStatus('Authenticating to Production... ✅');
      } else {
        console.warn('⚠️ Production authentication failed - continuing with Staging only');
        this.productionAuthFailed = true;
        this.updateLoadingStatus('⚠️ Production unavailable - continuing with Staging');
      }
      
      // Load schools from both environments
      this.updateLoadingStatus('Loading schools from Staging...');
      await this.getSchoolsFromEnvironment('staging');
      
      if (!this.productionAuthFailed) {
        this.updateLoadingStatus('Loading schools from Production...');
        try {
          await this.getSchoolsFromEnvironment('production');
        } catch (error) {
          console.warn('⚠️ Failed to load production schools:', error);
          this.productionAuthFailed = true;
        }
      }
      
      // Populate dropdowns with environment-specific schools
      this.populateMainSchoolDropdown(this.stagingSchools);
      this.populateBaselineSchoolDropdown(this.stagingBaselineSchools, this.stagingSchools);
      
      this.showSchoolSelectionUI();
      
      // Update toggle UI states
      this.updateEnvironmentToggles();
      
      // Show production warning banner if it failed
      if (this.productionAuthFailed) {
        this.showProductionUnavailableWarning();
      }
      
      // ✅ IF session data exists, show a restoration banner (don't auto-restore)
      if (sessionInfo.hasData) {
        this.showSessionRestorationBanner(sessionInfo);
      }
      
    } catch (error) {
      console.error('Authentication error:', error);
      this.showError(`Failed to connect to Staging: ${error.message}`);
    }
  }

  async performNormalLogin() {
    this.updateLoadingStatus('Authenticating...');
    this.logProgress('Auto-login initiated', 'info');
    
    try {
      // Authenticate
      const authResponse = await this.makeApiCall('/api/v1/sessions', 'POST', this.credentials);
      this.token = this.extractTokenFromResponse(authResponse);
      
      if (!this.token) {
        throw new Error('No token received from authentication');
      }
      
      this.logProgress('Authentication successful', 'success');
      this.updateLoadingStatus('Loading schools...');
      
      // Get all schools using displayNames endpoint
      const schoolsResponse = await this.makeApiCall('/api/v1/admin/schools/displayNames', 'GET');
      
      // Convert response object to array format
      this.allSchools = Object.values(schoolsResponse).sort((a, b) => 
        (a.fullName || a.displayName || a.id).localeCompare(b.fullName || b.displayName || b.id)
      );
      
      // Filter baseline schools using displayName field (contains 'baseline' in name, case insensitive)
      this.baselineSchools = this.allSchools.filter(school => 
        (school.displayName && school.displayName.toLowerCase().includes('baseline')) ||
        (school.fullName && school.fullName.toLowerCase().includes('baseline'))
      );
      
      this.logProgress(`Found ${this.allSchools.length} total schools, ${this.baselineSchools.length} baseline schools`, 'success');
      
      // Use environment-specific population methods
      this.populateMainSchoolDropdown(this.allSchools);
      this.populateBaselineSchoolDropdown(this.baselineSchools, this.allSchools);
      this.showSchoolSelectionUI();
      
    } catch (error) {
      console.error('Auto-login error:', error);
      this.logProgress(`Auto-login failed: ${error.message}`, 'error');
      this.showError(`Failed to connect: ${error.message}`);
    }
  }

  /**
   * Infer school ID from endpoint path
   * @param {string} endpoint - API endpoint
   * @returns {string|null} School ID or null
   */
  inferSchoolId(endpoint) {
    try {
      // Matches: /api/v1/:school/... or /api/v2/:school/...
      const m1 = endpoint.match(/^\/api\/v[12]\/([^\/?#]+)\//);
      if (m1 && m1[1] && m1[1] !== 'admin' && m1[1] !== 'all_done') return m1[1];
      // Matches: /api/v1/admin/schools/:school/...
      const m2 = endpoint.match(/^\/api\/v[12]\/admin\/schools\/([^\/?#]+)\//);
      if (m2 && m2[1]) return m2[1];
    } catch (_) {}
    return null;
  }

  async makeApiCall(endpoint, method = 'GET', body = null, environment = null) {
    // Determine which environment to use
    // If environment is explicitly provided, use it
    // Otherwise, try to infer from the endpoint (school ID) and our tracked selections
    let targetEnv = environment;
    
    if (!targetEnv) {
      // Try to infer environment from endpoint by matching school ID
      const schoolIdFromEndpoint = this.inferSchoolId(endpoint);
      if (schoolIdFromEndpoint) {
        // Check if it matches main or baseline school
        if (this.selectedMainSchool.name === schoolIdFromEndpoint) {
          targetEnv = this.selectedMainSchool.environment;
        } else if (this.selectedBaselineSchool.name === schoolIdFromEndpoint) {
          targetEnv = this.selectedBaselineSchool.environment;
        }
      }
      
      // Default to staging if we can't determine
      if (!targetEnv) {
        targetEnv = 'staging';
      }
    }
    
    // Get environment-specific baseUrl and token
    const baseUrl = this.environments[targetEnv].baseUrl;
    const token = targetEnv === 'staging' ? this.stagingToken : this.productionToken;
    const credentials = this.environmentCredentials[targetEnv];
    
    const url = `${baseUrl}${endpoint}`;
    const timestamp = new Date().toISOString();
    const schoolIdForHeader = this.inferSchoolId(endpoint);

    const options = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'include'
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
      // Some endpoints require X-Auth-Token or cookie-based auth. We can't rely on cookies from an extension (SameSite=Strict),
      // so also send the token in X-Auth-Token for compatibility with endpoints that expect it.
      options.headers['X-Auth-Token'] = token;
    }
    if (schoolIdForHeader) {
      options.headers['School-ID'] = schoolIdForHeader;
    }
    
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    
    // Log the request
    const requestLog = {
      timestamp,
      type: 'REQUEST',
      method,
      url,
      endpoint,
      headers: { ...options.headers },
      body: body || null
    };
    
    // Hide sensitive data in logs
    if (requestLog.headers['Authorization']) {
      requestLog.headers['Authorization'] = 'Bearer [REDACTED]';
    }
    if (requestLog.headers['X-Auth-Token']) {
      requestLog.headers['X-Auth-Token'] = '[REDACTED]';
    }
    if (requestLog.body && requestLog.body.password) {
      requestLog.body = { ...requestLog.body, password: '[REDACTED]' };
    }
    
    this.debugLog.push(requestLog);
    this.logProgress(`→ ${method} ${endpoint}`, 'info');
    
    try {
      const doFetch = async () => fetch(url, options);
      let response = await doFetch();

      // If unauthenticated, try a one-time silent re-auth and retry
      if (response.status === 401 && credentials && credentials.email && credentials.password) {
        try {
          const authResp = await fetch(`${baseUrl}/api/v1/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify(credentials),
            credentials: 'include'
          });
          if (authResp.ok) {
            const authJson = await authResp.json();
            const newToken = this.extractTokenFromResponse(authJson);
            if (newToken && newToken !== 'cookie-based-auth') {
              // Update the appropriate token
              if (targetEnv === 'staging') {
                this.stagingToken = newToken;
              } else {
                this.productionToken = newToken;
              }
              options.headers['Authorization'] = `Bearer ${newToken}`;
              options.headers['X-Auth-Token'] = newToken;
              response = await doFetch();
            }
          }
        } catch (_) {
          // ignore and fall through to normal error handling
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        
        // Log the error response
        const errorLog = {
          timestamp: new Date().toISOString(),
          type: 'RESPONSE_ERROR',
          method,
          url,
          endpoint,
          status: response.status,
          statusText: response.statusText,
          error: errorText
        };
        this.debugLog.push(errorLog);
        
        throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      
      // Log the successful response (with truncated data for readability)
      const responseLog = {
        timestamp: new Date().toISOString(),
        type: 'RESPONSE_SUCCESS',
        method,
        url,
        endpoint,
        status: response.status,
        statusText: response.statusText,
        dataPreview: this.truncateJson(data, 500),
        dataSize: JSON.stringify(data).length
      };
      this.debugLog.push(responseLog);
      
      return data;
      
    } catch (error) {
      // Log any network or parsing errors
      const errorLog = {
        timestamp: new Date().toISOString(),
        type: 'NETWORK_ERROR',
        method,
        url,
        endpoint,
        error: error.message
      };
      this.debugLog.push(errorLog);
      throw error;
    }
  }

  extractTokenFromResponse(response) {
    if (response.token) return response.token;
    if (response.accessToken) return response.accessToken;
    if (response.sessionToken) return response.sessionToken;
    return 'cookie-based-auth';
  }

  truncateJson(data, maxLength = 500) {
    const jsonString = JSON.stringify(data, null, 2);
    if (jsonString.length <= maxLength) {
      return jsonString;
    }
    return jsonString.substring(0, maxLength) + '\n... [TRUNCATED - Full data in individual files]';
  }

  generateDebugLogFile() {
    const reportGenerator = new CoursedogReportGenerator(
      this.selectedMainSchool.name || this.mainSchool, 
      this.selectedBaselineSchool.name || this.baselineSchool, 
      this.tempData, 
      this.debugLog,
      true,
      true,
      this.selectedMainSchool.environment || 'staging',
      this.selectedBaselineSchool.environment || 'staging'
    );
    return reportGenerator.generateDebugLogFile();
  }

  generateNotionDebugLog() {
    const notionLogs = this.notionClient ? this.notionClient.getLogs() : [];
    const reportGenerator = new CoursedogReportGenerator(
      this.selectedMainSchool.name || this.mainSchool, 
      this.selectedBaselineSchool.name || this.baselineSchool, 
      this.tempData, 
      this.debugLog,
      true,
      true,
      this.selectedMainSchool.environment || 'staging',
      this.selectedBaselineSchool.environment || 'staging'
    );
    return reportGenerator.generateNotionDebugLog(notionLogs, this.mainSchool, this.baselineSchool);
  }

  populateSchoolDropdowns() {
    const mainSelect = document.getElementById('main-school');
    const baselineSelect = document.getElementById('baseline-school');
    
    // Populate main school dropdown with all schools
    mainSelect.innerHTML = '<option value="">Select a school...</option>';
    this.allSchools.forEach(school => {
      const displayName = school.displayName || school.fullName || school.id;
      const optionText = `${school.id} - ${displayName}`;
      const option = new Option(optionText, school.id);
      mainSelect.appendChild(option);
    });
    
    // Populate baseline school dropdown based on toggle
    const baselinePool = this.getBaselinePool();
    baselineSelect.innerHTML = '<option value="">Select a baseline school...</option>';
    baselinePool.forEach(school => {
      const displayName = school.displayName || school.fullName || school.id;
      const optionText = `${school.id} - ${displayName}`;
      const option = new Option(optionText, school.id);
      baselineSelect.appendChild(option);
    });
    
    this.logProgress('School dropdowns populated with display names and fuzzy search enabled', 'info');
  }

  // Fuzzy search implementation
  fuzzySearch(query, items, key = 'displayName') {
    if (!query.trim()) return items;
    
    const searchTerm = query.toLowerCase();
    
    return items
      .map(item => {
        const displayName = item[key] || item.fullName || item.id || '';
        const searchText = `${item.id} - ${displayName}`.toLowerCase();
        let score = 0;
        
        // Exact match gets highest score
        if (searchText === searchTerm) {
          score = 1000;
        }
        // Starts with search term
        else if (searchText.startsWith(searchTerm)) {
          score = 500;
        }
        // Contains search term
        else if (searchText.includes(searchTerm)) {
          score = 200;
        }
        // Fuzzy match - check if all characters of search term exist in order
        else {
          let searchIndex = 0;
          for (let i = 0; i < searchText.length && searchIndex < searchTerm.length; i++) {
            if (searchText[i] === searchTerm[searchIndex]) {
              searchIndex++;
              score += 10;
            }
          }
          // Only include if we found all characters
          if (searchIndex < searchTerm.length) {
            score = 0;
          }
        }
        
        return { ...item, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  handleMainSchoolSearch(query) {
    // Use schools from the currently selected main school environment
    const schoolList = this.mainSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
    const filteredSchools = this.fuzzySearch(query, schoolList);
    this.updateDropdown('main-school', filteredSchools, 'Select a school...', query);
  }

  handleBaselineSchoolSearch(query) {
    // Use schools from the currently selected baseline school environment
    const schoolList = this.getBaselinePool();
    const filteredSchools = this.fuzzySearch(query, schoolList);
    this.updateDropdown('baseline-school', filteredSchools, 'Select a baseline school...', query);
  }

  updateDropdown(dropdownId, schools, placeholder, searchQuery = '') {
    const dropdown = document.getElementById(dropdownId);
    dropdown.innerHTML = `<option value="">${placeholder}</option>`;
    
    // Determine which environment we're using based on the dropdown
    const environment = dropdownId === 'main-school' ? this.mainSchoolEnvironment : this.baselineSchoolEnvironment;
    
    schools.slice(0, 50).forEach(school => { // Limit to 50 results for performance
      const displayName = school.displayName || school.fullName || school.id;
      const optionText = `${school.id} - ${displayName}`;
      const option = new Option(optionText, school.id);
      
      // Add environment attribute for tracking
      option.dataset.environment = environment;
      
      // Highlight matching text if there's a search query
      if (searchQuery.trim()) {
        option.innerHTML = this.highlightMatch(optionText, searchQuery);
      }
      
      dropdown.appendChild(option);
    });

    if (schools.length === 0 && searchQuery.trim()) {
      const noResults = new Option('No matching schools found', '');
      noResults.disabled = true;
      dropdown.appendChild(noResults);
    }
  }

  highlightMatch(text, query) {
    if (!query.trim()) return text;
    
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
  }

  getBaselinePool() {
    // Get schools from the currently selected baseline environment
    const env = this.baselineSchoolEnvironment;
    const allSchools = env === 'staging' ? this.stagingSchools : this.productionSchools;
    const baselineSchools = env === 'staging' ? this.stagingBaselineSchools : this.productionBaselineSchools;
    
    // Apply the baseline filter if enabled
    const baselineFilterToggle = document.getElementById('baseline-filter-toggle');
    const showOnlyBaseline = baselineFilterToggle ? baselineFilterToggle.checked : false;
    
    return showOnlyBaseline ? baselineSchools : allSchools;
  }

  handleSchoolSelection(event, schoolType) {
    const selectedValue = event.target.value;
    const selectedOption = event.target.options[event.target.selectedIndex];
    
    if (selectedValue) {
      // Track the school name and its environment
      const schoolEnvironment = selectedOption.dataset.environment || 
        (schoolType === 'main' ? this.mainSchoolEnvironment : this.baselineSchoolEnvironment);
      
      if (schoolType === 'main') {
        this.selectedMainSchool = {
          name: selectedValue,
          environment: schoolEnvironment
        };
        console.log(`✅ Main school selected: ${selectedValue} (${schoolEnvironment})`);
      } else if (schoolType === 'baseline') {
        this.selectedBaselineSchool = {
          name: selectedValue,
          environment: schoolEnvironment
        };
        console.log(`✅ Baseline school selected: ${selectedValue} (${schoolEnvironment})`);
      }
      
      this.hideSchoolSelection(schoolType, selectedValue);
    }
    
    this.checkSchoolSelection();
  }

  hideSchoolSelection(schoolType, selectedSchoolId) {
    const schoolElement = document.querySelector(`#${schoolType}-school`);
    if (!schoolElement) {
      console.error(`Could not find school element: #${schoolType}-school`);
      return;
    }
    
    const container = schoolElement.closest('.search-container');
    if (!container) {
      console.error(`Could not find search container for ${schoolType} school`);
      return;
    }
    
    const selectedDiv = document.getElementById(`${schoolType}-school-selected`);
    if (!selectedDiv) {
      console.error(`Could not find selected div: #${schoolType}-school-selected`);
      return;
    }
    
    const selectedText = selectedDiv.querySelector('.selected-text');
    if (!selectedText) {
      console.error(`Could not find selected text element in ${schoolType} school`);
      return;
    }
    
    // Find the school data to get the display name from environment-specific lists
    let schoolList;
    if (schoolType === 'main') {
      schoolList = this.mainSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
    } else {
      schoolList = this.baselineSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
    }
    const schoolData = schoolList.find(school => school.id === selectedSchoolId);
    const displayName = schoolData ? (schoolData.displayName || schoolData.fullName || schoolData.id) : selectedSchoolId;
    const displayText = `${selectedSchoolId} - ${displayName}`;
    
    // Update selected school display
    selectedText.textContent = displayText;
    
    // Hide search and dropdown, show selected school
    container.classList.add('selected');
    selectedDiv.style.display = 'flex';
    
    // Set up change button listener for this specific button
    const changeButton = selectedDiv.querySelector('.change-btn');
    if (changeButton) {
      if (!this.boundChangeHandler) {
        this.boundChangeHandler = this.handleChangeButtonClick.bind(this);
      }
      changeButton.removeEventListener('click', this.boundChangeHandler);
      changeButton.addEventListener('click', this.boundChangeHandler);
      console.log('🔥 hideSchoolSelection: Added listener to change button');
    }
    
    this.logProgress(`${schoolType === 'main' ? 'Main' : 'Baseline'} school selected: ${displayName}`, 'info');
  }

  showSchoolSelection(schoolType) {
    console.log('🔥 showSchoolSelection called with schoolType:', schoolType);
    
    const schoolElement = document.querySelector(`#${schoolType}-school`);
    if (!schoolElement) {
      console.error(`Could not find school element: #${schoolType}-school`);
      return;
    }
    
    const container = schoolElement.closest('.search-container');
    if (!container) {
      console.error(`Could not find search container for ${schoolType} school`);
      return;
    }
    
    const selectedDiv = document.getElementById(`${schoolType}-school-selected`);
    if (!selectedDiv) {
      console.error(`Could not find selected div: #${schoolType}-school-selected`);
      return;
    }
    
    const searchInput = document.getElementById(`${schoolType}-school-search`);
    if (!searchInput) {
      console.error(`Could not find search input: #${schoolType}-school-search`);
      return;
    }
    
    const dropdown = document.getElementById(`${schoolType}-school`);
    if (!dropdown) {
      console.error(`Could not find dropdown: #${schoolType}-school`);
      return;
    }
    
    console.log('🔥 Container found:', container);
    console.log('🔥 Selected div found:', selectedDiv);
    console.log('🔥 Search input found:', searchInput);
    console.log('🔥 Dropdown found:', dropdown);
    
    // Show search and dropdown, hide selected school
    container.classList.remove('selected');
    selectedDiv.style.display = 'none';
    
    // Clear selection and search
    dropdown.value = '';
    searchInput.value = '';
    
    // Repopulate dropdown
    if (schoolType === 'main') {
      console.log('🔥 Repopulating main school dropdown');
      const mainSchools = this.mainSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
      this.updateDropdown('main-school', mainSchools, 'Select a school...');
    } else {
      console.log('🔥 Repopulating baseline school dropdown');
      const pool = this.getBaselinePool();
      this.updateDropdown('baseline-school', pool, 'Select a baseline school...');
    }
    
    // Focus on search input
    searchInput.focus();
    
    this.checkSchoolSelection();
  }

  checkSchoolSelection() {
    const mainSchoolId = document.getElementById('main-school').value;
    const baselineSchoolId = document.getElementById('baseline-school').value;
    const generateBtn = document.getElementById('generate-report-btn');
    
    // Allow same school ID only if they're in different environments
    const isSameSchoolSameEnv = mainSchoolId && baselineSchoolId && 
      mainSchoolId === baselineSchoolId && 
      this.mainSchoolEnvironment === this.baselineSchoolEnvironment;
    
    const isValid = mainSchoolId && baselineSchoolId && !isSameSchoolSameEnv;
    generateBtn.disabled = !isValid;
    
    if (isSameSchoolSameEnv) {
      this.logProgress('Warning: Same school selected for both Main and Baseline in the same environment', 'error');
    } else if (isValid) {
      // Get display names for logging from environment-specific lists
      const mainSchoolList = this.mainSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
      const baselineSchoolList = this.baselineSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
      
      const mainSchoolData = mainSchoolList.find(school => school.id === mainSchoolId);
      const baselineSchoolData = baselineSchoolList.find(school => school.id === baselineSchoolId);
      const mainDisplayName = mainSchoolData ? (mainSchoolData.displayName || mainSchoolData.fullName || mainSchoolData.id) : mainSchoolId;
      const baselineDisplayName = baselineSchoolData ? (baselineSchoolData.displayName || baselineSchoolData.fullName || baselineSchoolData.id) : baselineSchoolId;
      
      const mainEnvLabel = this.mainSchoolEnvironment === 'production' ? '🔴' : '🧪';
      const baselineEnvLabel = this.baselineSchoolEnvironment === 'production' ? '🔴' : '🧪';
      
      this.logProgress(`Ready to compare: ${mainEnvLabel} ${mainDisplayName} vs ${baselineEnvLabel} ${baselineDisplayName}`, 'success');
    }
  }

  updateLoadingStatus(message) {
    document.getElementById('loading-status').textContent = message;
  }

  showSchoolSelectionUI() {
    document.getElementById('loading-section').style.display = 'none';
    document.getElementById('school-section').style.display = 'block';
  }

  showProductionUnavailableWarning() {
    // Create warning banner if it doesn't exist
    let banner = document.getElementById('production-unavailable-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'production-unavailable-banner';
      banner.className = 'production-warning-banner';
      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">⚠️</span>
          <div style="flex: 1;">
            <strong>Production Environment Unavailable</strong>
            <p style="margin: 4px 0 0 0; font-size: 0.9em; opacity: 0.9;">
              Authentication to Production failed. You can continue using Staging environment.
              Production toggles have been disabled.
            </p>
          </div>
          <button id="close-prod-warning-banner" style="background: none; border: none; font-size: 20px; cursor: pointer; color: inherit; opacity: 0.7; padding: 0 8px;" title="Dismiss">&times;</button>
        </div>
      `;
      
      // Insert at the top of the school section
      const schoolSection = document.getElementById('school-section');
      if (schoolSection) {
        schoolSection.insertBefore(banner, schoolSection.firstChild);
      }
      
      // Add close button handler
      const closeBtn = document.getElementById('close-prod-warning-banner');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          banner.remove();
        });
      }
    }
  }

  showError(message) {
    document.getElementById('loading-section').innerHTML = `
      <div class="status error">
        <h2>Connection Failed</h2>
        <p>${message}</p>
        <button id="retry-connection-btn" class="btn btn-secondary">Retry</button>
      </div>
    `;
    
    // Add event listener for the retry button
    const retryBtn = document.getElementById('retry-connection-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => location.reload());
    }
  }

  async handleGenerateReport() {
    this.mainSchool = document.getElementById('main-school').value;
    this.baselineSchool = document.getElementById('baseline-school').value;
    
    // Get display names for logging from environment-specific lists
    const mainSchoolList = this.mainSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
    const baselineSchoolList = this.baselineSchoolEnvironment === 'staging' ? this.stagingSchools : this.productionSchools;
    
    const mainSchoolData = mainSchoolList.find(school => school.id === this.mainSchool);
    const baselineSchoolData = baselineSchoolList.find(school => school.id === this.baselineSchool);
    const mainDisplayName = mainSchoolData ? (mainSchoolData.displayName || mainSchoolData.fullName || mainSchoolData.id) : this.mainSchool;
    const baselineDisplayName = baselineSchoolData ? (baselineSchoolData.displayName || baselineSchoolData.fullName || baselineSchoolData.id) : this.baselineSchool;
    
    // ✅ Check if a Notion upload is in progress
    const uploadInProgress = await this.checkNotionUploadInProgress();
    
    if (uploadInProgress) {
      const confirmGenerate = await this.showConfirmation(
        'Upload in Progress',
        '⚠️ A Notion upload is currently in progress.\n\n' +
        'Generating a new report will NOT cancel the upload, but:\n' +
        '• The new report will have different data\n' +
        '• You can queue a new upload after this completes\n\n' +
        'Continue with new report generation?',
        'Generate New Report',
        'Cancel'
      );
      
      if (!confirmGenerate) {
        return; // User cancelled
      }
    }
    
    // ✅ Clear old session data before starting new report
    this.logProgress('Clearing previous session data...', 'info');
    await this.clearSessionData();
    
    // ✅ Reset instance data
    this.tempData = {};
    this.debugLog = [];
    
    // ✅ Clear any previous download URLs
    this.cleanupDownloadUrls();
    
    this.logProgress(`🆕 Starting fresh report generation: ${mainDisplayName} vs ${baselineDisplayName}`, 'info');
    
    // Show appropriate progress indicator
    const isNerdMode = document.getElementById('info-for-nerds-checkbox').checked;
    if (!isNerdMode) {
      document.getElementById('simple-progress').style.display = 'flex';
      document.getElementById('simple-progress-text').textContent = 'Generating reports...';
    }
    
    document.getElementById('generate-report-btn').disabled = true;
    
    // Hide results section and progress section initially
    document.getElementById('results-section').style.display = 'none';
    if (isNerdMode) {
      document.getElementById('progress-section').style.display = 'none';
    }
    
    try {
      // Step 1: Generate main reports
      this.logProgress('Generating comparison reports...', 'info');
      await this.generateReports();
      this.logProgress('Comparison reports completed!', 'success');
      
      // Step 2: Generate snapshot for main school
      this.logProgress('Generating snapshot for main school...', 'info');
      if (!isNerdMode) {
        document.getElementById('simple-progress-text').textContent = 'Generating snapshot...';
      }
      try {
        console.log('Starting snapshot generation for school:', this.mainSchool);
        // Pass the already-fetched merge settings to avoid duplicate API calls
        const mainSchoolMergeSettings = this.tempData[`MainSchool_mergeSettings`];
        console.log('Retrieved merge settings for snapshot:', mainSchoolMergeSettings);
        const snapshotData = await this.generateSnapshot(this.mainSchool, mainSchoolMergeSettings);
        console.log('Snapshot generation completed, data:', snapshotData);
        this.logProgress('Snapshot generation completed successfully!', 'success');
        
        // Generate snapshot downloads
        this.generateSnapshotDownloads(snapshotData, this.mainSchool);
        this.logProgress('Snapshot files generated successfully!', 'success');
      } catch (snapshotError) {
        console.error('Snapshot generation error:', snapshotError);
        this.logProgress(`Snapshot generation failed: ${snapshotError.message}`, 'error');
        // Continue with report generation even if snapshot fails
      }
      
      // Step 3: Generate downloadable reports (after all API calls are complete)
      this.logProgress('Generating downloadable files...', 'info');
      
      // Ensure side-effect comparison reports are generated (fills tempData)
      try {
        this.generateComparisonReport();
      } catch (error) {
        console.warn('Side-effect report generation failed before downloads', error);
      }

      // Prepare download container
      const downloadContainer = document.getElementById('download-links');
      if (downloadContainer) {
        downloadContainer.innerHTML = '';
      }

      // Generate individual data files (exclude integration files since they're in CAC_Report.md)
      Object.keys(this.tempData).forEach(key => {
        // Skip integration-related files since they're consolidated in CAC_Report.md
        if (this.isIntegrationFile(key)) {
          return;
        }
        
        // Handle snapshot files with proper naming
        let filename = `${key}.json`;
        let mimeType = 'application/json';
        
        if (key.includes('snapshot_') && key.includes('_json')) {
          filename = key.replace('snapshot_', '').replace('_json', '_snapshot.json');
        } else if (key.includes('snapshot_') && key.includes('_markdown')) {
          // Skip markdown snapshot files - we don't need them
          return;
        }
        
        const content = mimeType === 'text/markdown' ? this.tempData[key] : JSON.stringify(this.tempData[key], null, 2);
        const link = this.createDownloadLink(filename, content, mimeType);
        downloadContainer.appendChild(link);
      });

      // Removed Configuration_Comparison_Report download (no longer needed)

      // Add CAC Report if available
      if (this.tempData['CAC_Report']) {
        const cacLink = this.createDownloadLink('CAC_Report.md', this.tempData['CAC_Report'], 'text/markdown');
        downloadContainer.appendChild(cacLink);
      }

      // Add new comparison reports (filtered by checkbox states)
      const curriculumEnabled = document.getElementById('curriculum-checkbox').checked;
      const schedulingEnabled = document.getElementById('scheduling-checkbox').checked;
      
      this.comparisonReportKeys.forEach(reportKey => {
        if (this.tempData[reportKey]) {
          // Filter reports based on checkbox states
          let shouldInclude = true;
          
          if (reportKey === 'courseTemplate_Comparison_Report' || reportKey === 'programTemplate_Comparison_Report') {
            shouldInclude = curriculumEnabled;
          } else if (reportKey === 'sectionTemplate_Comparison_Report') {
            shouldInclude = schedulingEnabled;
          }
          
          if (shouldInclude) {
            const reportLink = this.createDownloadLink(`${reportKey}.md`, this.tempData[reportKey], 'text/markdown');
            downloadContainer.appendChild(reportLink);
          }
        }
      });

      // Generate debug log file
      const debugLog = this.generateDebugLogFile();
      const debugLink = this.createDownloadLink('API_Debug_Log.md', debugLog, 'text/markdown');
      downloadContainer.appendChild(debugLink);

      // Generate Notion debug log file if available
      if (this.notionClient && this.notionClient.getLogs && this.notionClient.getLogs().length > 0) {
        const notionDebugLog = this.generateNotionDebugLog();
        const notionDebugLink = this.createDownloadLink('Notion_API_Debug_Log.md', notionDebugLog, 'text/markdown');
        downloadContainer.appendChild(notionDebugLink);
      }

      // Setup simple download button (no main report dependency)
      try {
        this.setupSimpleDownload();
      } catch (error) {
        console.error('Error setting up simple download:', error);
        this.logProgress(`✗ Error setting up simple download: ${error.message}`, 'error');
      }

      // Count only non-integration files for individual downloads
      const coreDataFiles = Object.keys(this.tempData).filter(key => !this.isIntegrationFile(key));
      
      // Count filtered comparison reports
      let availableComparisonReports = 0;
      this.comparisonReportKeys.forEach(reportKey => {
        if (this.tempData[reportKey]) {
          let shouldInclude = true;
          
          if (reportKey === 'courseTemplate_Comparison_Report' || reportKey === 'programTemplate_Comparison_Report') {
            shouldInclude = curriculumEnabled;
          } else if (reportKey === 'sectionTemplate_Comparison_Report') {
            shouldInclude = schedulingEnabled;
          }
          
          if (shouldInclude) {
            availableComparisonReports++;
          }
        }
      });
      
      const reportFiles = 1 + (this.tempData['CAC_Report'] ? 1 : 0) + availableComparisonReports; // debug log + CAC report + comparison reports
      const totalFiles = coreDataFiles.length + reportFiles;
      
      this.logProgress(`Generated ${totalFiles} downloadable files (${coreDataFiles.length} core data files + ${reportFiles} reports)`, 'success');
      
      // Hide loading state now that files are ready
      const resultsLoading = document.getElementById('results-loading');
      if (resultsLoading) {
        resultsLoading.style.display = 'none';
      }
      
      // Show Notion section and enable button only if experimental features are enabled
      const experimentalFeaturesEnabled = document.getElementById('experimental-features-checkbox').checked;
      if (experimentalFeaturesEnabled) {
        document.getElementById('notion-section').style.display = 'block';
      }
      document.getElementById('send-to-notion-btn').disabled = false;
      // Enable View Reports button
      const viewBtn = document.getElementById('view-reports-btn');
      if (viewBtn) viewBtn.style.display = 'inline-block';
      
      // Reveal results UI and hide simple progress
      const resultsSection = document.getElementById('results-section');
      if (resultsSection) {
        resultsSection.style.display = 'block';
      }
      const simpleProgress = document.getElementById('simple-progress');
      if (simpleProgress) {
        simpleProgress.style.display = 'none';
      }
      
      // Ensure advanced options reflect current Nerds toggle
      const nerdsChecked = document.getElementById('info-for-nerds-checkbox').checked;
      try { this.toggleAdvancedOptions(nerdsChecked); } catch (_) {}
      
      this.logProgress('All files ready for download and Notion upload!', 'success');

      // Auto-trigger Notion upload if enabled
      try {
        const autoEnabled = document.getElementById('send-to-notion-checkbox')?.checked;
        if (autoEnabled) {
          // Skip confirmation for auto-mode
          await this.handleNotionUpload();
        }
      } catch (e) {
        console.warn('Auto Notion upload failed to start:', e);
      }
    } catch (error) {
      console.error('Report generation error:', error);
      this.logProgress(`Error: ${error.message}`, 'error');
      
      // Hide progress indicators
      document.getElementById('simple-progress').style.display = 'none';
      
      // Hide loading state if it exists
      const resultsLoading = document.getElementById('results-loading');
      if (resultsLoading) {
        resultsLoading.style.display = 'none';
      }
      
      // Re-enable button
      document.getElementById('generate-report-btn').disabled = false;
    }
  }

  async generateReports() {
    const queries = [
      { name: 'courseTemplate', endpoint: '/api/v1/:school/general/courseTemplate' },
      { name: 'programTemplate', endpoint: '/api/v1/:school/general/programTemplate' },
      { name: 'sectionTemplate', endpoint: '/api/v2/:school/general/sectionTemplate' },
      { name: 'integrationSaveState', endpoint: '/api/v1/:school/general/enabledIntegrationSaveState' },
      { name: 'attributeMappings', endpoint: '/api/v1/:school/integration/attributeMappings?returnArray=true' },
      { name: 'integrationFilters', endpoint: '/api/v1/:school/general/integrationFilters' }
    ];

    // Calculate total steps: basic queries + merge settings + field exceptions + integration reports
    const basicSteps = queries.length * 2 + 2; // 2 schools * queries + merge settings for both (now 6*2+2=14)
    
    // Use a conservative estimate for field exceptions and integration steps (will be recalculated dynamically)
    // Field exceptions: ~10-15 entities per school (depends on formatters/merge settings)
    // Integration steps: varies by enabled entity types
    const estimatedIntegrationSteps = 50; // Conservative estimate (includes field exceptions + integration queries)
    const totalSteps = basicSteps + estimatedIntegrationSteps;
    let currentStep = 0;

    this.tempData = {};

    // Run basic queries for both schools
    for (const query of queries) {
      // Main school
      currentStep++;
      this.updateProgress(currentStep, totalSteps, `Fetching ${query.name} for ${this.mainSchool} (${this.mainSchoolEnvironment})...`);
      
      try {
        const mainEndpoint = query.endpoint.replace(':school', this.mainSchool);
        const mainData = await this.makeApiCall(mainEndpoint, 'GET', null, this.mainSchoolEnvironment);
        this.tempData[`MainSchool_${query.name}`] = mainData;
        this.logProgress(`✓ MainSchool_${query.name} completed`, 'success');
      } catch (error) {
        this.logProgress(`✗ MainSchool_${query.name} failed: ${error.message}`, 'error');
        this.tempData[`MainSchool_${query.name}`] = { error: error.message };
      }

      // Baseline school
      currentStep++;
      this.updateProgress(currentStep, totalSteps, `Fetching ${query.name} for ${this.baselineSchool} (${this.baselineSchoolEnvironment})...`);
      
      try {
        const baselineEndpoint = query.endpoint.replace(':school', this.baselineSchool);
        const baselineData = await this.makeApiCall(baselineEndpoint, 'GET', null, this.baselineSchoolEnvironment);
        this.tempData[`BaselineSchool_${query.name}`] = baselineData;
        this.logProgress(`✓ BaselineSchool_${query.name} completed`, 'success');
      } catch (error) {
        this.logProgress(`✗ BaselineSchool_${query.name} failed: ${error.message}`, 'error');
        this.tempData[`BaselineSchool_${query.name}`] = { error: error.message };
      }
    }

    // Get integration merge settings for both schools
    currentStep = await this.fetchMergeSettings(currentStep, totalSteps);

    // NEW: Fetch complete field exception maps for both schools
    // This provides ALL fields (explicit + implicit) for accurate comparison
    const mainMergeSettings = this.tempData['MainSchool_mergeSettings'];
    const baselineMergeSettings = this.tempData['BaselineSchool_mergeSettings'];

    this.logProgress('📋 Fetching complete field exception maps for accurate comparison...', 'info');
    
    currentStep = await this.fetchEntityFieldExceptions(
      currentStep, 
      totalSteps, 
      this.mainSchool, 
      mainMergeSettings, 
      'MainSchool',
      this.mainSchoolEnvironment
    );

    currentStep = await this.fetchEntityFieldExceptions(
      currentStep, 
      totalSteps, 
      this.baselineSchool, 
      baselineMergeSettings, 
      'BaselineSchool',
      this.baselineSchoolEnvironment
    );

    this.logProgress('✅ Field exception maps retrieval completed!', 'success');

    // Build unified field lists for dynamic comparison
    this.buildUnifiedFieldLists();
    this.logProgress('✅ Unified field lists built for comparison', 'success');

    // Generate comprehensive integration reports (Main School only)
    currentStep = await this.fetchIntegrationData(currentStep, totalSteps);
    
    // Save session data
    try {
      await this.saveSessionData();
    } catch (error) {
      console.error('Error saving session data:', error);
    }
  }

  async fetchMergeSettings(currentStep, totalSteps) {
    // Main school merge settings
    currentStep++;
    this.updateProgress(currentStep, totalSteps, `Fetching merge settings for ${this.mainSchool} (${this.mainSchoolEnvironment})...`);
    
    try {
      const mainIntegrationData = this.tempData[`MainSchool_integrationSaveState`];
      this.logProgress(`MainSchool integration data: ${JSON.stringify(mainIntegrationData).substring(0, 200)}...`, 'info');
      
      // Fix: Look in the correct nested path
      const mainSaveStateId = mainIntegrationData?.enabledIntegrationSaveState?.integrationSaveStateId;
      if (mainSaveStateId) {
        this.logProgress(`Found MainSchool save state ID: ${mainSaveStateId}`, 'info');
        const mainMergeSettings = await this.makeApiCall(`/api/v1/${this.mainSchool}/integration/mergeSettings?integrationSaveStateId=${mainSaveStateId}`, 'GET', null, this.mainSchoolEnvironment);
        this.tempData[`MainSchool_mergeSettings`] = mainMergeSettings;
        this.logProgress(`✓ MainSchool_mergeSettings completed`, 'success');
      } else {
        this.logProgress(`⚠ MainSchool integration save state ID not found. Available keys: ${Object.keys(mainIntegrationData || {})}`, 'error');
        this.tempData[`MainSchool_mergeSettings`] = { error: 'No integration save state ID found', rawData: mainIntegrationData };
      }
    } catch (error) {
      this.logProgress(`✗ MainSchool_mergeSettings failed: ${error.message}`, 'error');
      this.tempData[`MainSchool_mergeSettings`] = { error: error.message };
    }

    // Baseline school merge settings
    currentStep++;
    this.updateProgress(currentStep, totalSteps, `Fetching merge settings for ${this.baselineSchool} (${this.baselineSchoolEnvironment})...`);
    
    try {
      const baselineIntegrationData = this.tempData[`BaselineSchool_integrationSaveState`];
      this.logProgress(`BaselineSchool integration data: ${JSON.stringify(baselineIntegrationData).substring(0, 200)}...`, 'info');
      
      // Fix: Look in the correct nested path
      const baselineSaveStateId = baselineIntegrationData?.enabledIntegrationSaveState?.integrationSaveStateId;
      if (baselineSaveStateId) {
        this.logProgress(`Found BaselineSchool save state ID: ${baselineSaveStateId}`, 'info');
        const baselineMergeSettings = await this.makeApiCall(`/api/v1/${this.baselineSchool}/integration/mergeSettings?integrationSaveStateId=${baselineSaveStateId}`, 'GET', null, this.baselineSchoolEnvironment);
        this.tempData[`BaselineSchool_mergeSettings`] = baselineMergeSettings;
        this.logProgress(`✓ BaselineSchool_mergeSettings completed`, 'success');
      } else {
        this.logProgress(`⚠ BaselineSchool integration save state ID not found. Available keys: ${Object.keys(baselineIntegrationData || {})}`, 'error');
        this.tempData[`BaselineSchool_mergeSettings`] = { error: 'No integration save state ID found', rawData: baselineIntegrationData };
      }
    } catch (error) {
      this.logProgress(`✗ BaselineSchool_mergeSettings failed: ${error.message}`, 'error');
      this.tempData[`BaselineSchool_mergeSettings`] = { error: error.message };
    }

    this.updateProgress(currentStep, totalSteps, 'Merge settings retrieval completed!');
    return currentStep;
  }

  /**
   * Get target entities for field exceptions fetching
   * Uses formatters first (if available), then falls back to enabled merge settings
   */
  getTargetEntitiesForFieldExceptions(mergeSettings, schoolPrefix) {
    if (!mergeSettings || mergeSettings.error) {
      this.logProgress(`⚠ ${schoolPrefix}: No merge settings available for entity selection`, 'warn');
      return [];
    }

    // Try to get from formatters first (more accurate)
    const formattersKey = `${schoolPrefix}_formatters`;
    const formatters = this.tempData[formattersKey];
    
    if (formatters && !formatters.error && typeof formatters === 'object') {
      const entities = Object.keys(formatters).filter(key => formatters[key] === true);
      if (entities.length > 0) {
        this.logProgress(`${schoolPrefix}: Using ${entities.length} entities from formatters`, 'info');
        return entities;
      }
    }

    // Fallback to enabled entities in merge settings
    const enabledEntities = [];
    Object.entries(mergeSettings).forEach(([key, value]) => {
      if (value && typeof value === 'object' && value.enabled === true && value.type) {
        enabledEntities.push(value.type);
      }
    });
    
    if (enabledEntities.length > 0) {
      this.logProgress(`${schoolPrefix}: Using ${enabledEntities.length} entities from merge settings`, 'info');
    } else {
      this.logProgress(`${schoolPrefix}: No target entities found`, 'warn');
    }
    
    return enabledEntities;
  }

  /**
   * Fetch complete field exception maps for all target entities
   * Uses POST /api/v1/{school}/integration/entityFieldExceptions/{entityType}
   * This provides ALL fields (explicit + implicit) for accurate comparison
   */
  async fetchEntityFieldExceptions(currentStep, totalSteps, school, mergeSettings, schoolPrefix, environment) {
    if (!mergeSettings || mergeSettings.error) {
      this.logProgress(`⚠ ${schoolPrefix}: No merge settings available for entity field exceptions`, 'warn');
      return currentStep;
    }

    // Extract save state ID from the integrationSaveState data
    const integrationDataKey = `${schoolPrefix}_integrationSaveState`;
    const integrationData = this.tempData[integrationDataKey];
    const saveStateId = integrationData?.enabledIntegrationSaveState?.integrationSaveStateId;
    
    if (!saveStateId) {
      this.logProgress(`⚠ ${schoolPrefix}: No save state ID for field exceptions`, 'warn');
      return currentStep;
    }

    // Get target entities from formatters or merge settings
    const targetEntities = this.getTargetEntitiesForFieldExceptions(mergeSettings, schoolPrefix);
    
    if (targetEntities.length === 0) {
      this.logProgress(`⚠ ${schoolPrefix}: No target entities for field exceptions`, 'warn');
      return currentStep;
    }

    this.logProgress(`${schoolPrefix}: Fetching complete field exception maps for ${targetEntities.length} entities...`, 'info');

    for (const entityType of targetEntities) {
      currentStep++;
      this.updateProgress(currentStep, totalSteps, `Fetching ${schoolPrefix} ${entityType} field exceptions...`);

      // Get entity merge settings outside try block so it's accessible in catch block
      const entityMergeSettings = mergeSettings[entityType];
      if (!entityMergeSettings) {
        this.logProgress(`⚠ ${schoolPrefix}: No merge settings for ${entityType}, skipping`, 'warn');
        continue;
      }

      try {

        // Build request body following the API specification
        const requestBody = {
          mergeSettingsOverrides: {
            integrationSaveStateId: saveStateId,
            conflictHandlingMethod: entityMergeSettings.conflictHandlingMethod || 'alwaysInstitution',
            fieldExceptions: entityMergeSettings.fieldExceptions || [],
            stepsToExecute: {
              fetchCoursedogData: false  // Only process configuration, no DB query
            }
          }
        };

        this.logProgress(`${schoolPrefix}: POST /api/v1/${school}/integration/entityFieldExceptions/${entityType}`, 'info');
        
        const apiFieldMap = await this.makeApiCall(
          `/api/v1/${school}/integration/entityFieldExceptions/${entityType}`,
          'POST',
          requestBody,
          environment
        );

        // Detect empty response (no sample data scenario)
        const isEmpty = !apiFieldMap || Object.keys(apiFieldMap).length === 0;

        if (isEmpty) {
          this.logProgress(`⚠️ ${schoolPrefix}: Empty response for ${entityType} - likely no sample data`, 'warn');
        }

        // Build final map: Start with API response (includes global exceptions + standard fields)
        // Then overlay user-configured exceptions from merge settings (highest priority)
        const finalFieldMap = { ...apiFieldMap };
        
        // Apply user-configured exceptions from merge settings (highest priority)
        const configuredExceptions = entityMergeSettings?.fieldExceptions || [];
        configuredExceptions.forEach(exceptionGroup => {
          const method = exceptionGroup.conflictHandlingMethod;
          exceptionGroup.fields.forEach(field => {
            const pathString = field.path.join('.');
            // User configuration overrides API (merge settings are source of truth for user config)
            finalFieldMap[pathString] = method;
          });
        });

        // Store with structured metadata
        this.tempData[`${schoolPrefix}_fieldExceptionMap_${entityType}`] = {
          status: isEmpty ? 'empty-response' : 'success',
          data: finalFieldMap,
          entityType,
          source: isEmpty ? 'no-sample-data' : 'api-enhanced',
          apiAvailable: true,  // API responded, just no data
          isEmpty: isEmpty,
          timestamp: new Date().toISOString()
        };

        const fieldCount = Object.keys(finalFieldMap || {}).length;
        this.logProgress(`✓ ${schoolPrefix}_fieldExceptionMap_${entityType} completed (${fieldCount} fields)`, 'success');
        
      } catch (error) {
        this.logProgress(`✗ ${schoolPrefix}_fieldExceptionMap_${entityType} API failed: ${error.message}`, 'warn');
        this.logProgress(`⚙️ ${schoolPrefix}: Using configured fields only for ${entityType}`, 'info');
        
        // Fallback: Generate field exception map from local configuration
        // This is school-specific - uses ONLY this school's configured fields
        const localFieldExceptionMap = this.generateLocalFieldExceptionMap(entityType, entityMergeSettings);
        const fieldCount = Object.keys(localFieldExceptionMap).length;
        
        this.tempData[`${schoolPrefix}_fieldExceptionMap_${entityType}`] = {
          status: 'api-failed',
          data: localFieldExceptionMap,
          entityType,
          source: 'configured-only',
          apiAvailable: false,
          schoolPrefix: schoolPrefix,  // Track which school used fallback
          originalError: error.message,
          timestamp: new Date().toISOString()
        };
        
        this.logProgress(`⚙️ ${schoolPrefix}: Generated ${fieldCount} configured fields for ${entityType}`, 'info');
        this.logProgress(`✓ ${schoolPrefix}_fieldExceptionMap_${entityType} completed (configured fields only)`, 'success');
      }
    }

    return currentStep;
  }

  /**
   * Build unified field lists for dynamic comparison
   * Collects all unique fields from API responses and configured exceptions for both schools
   * This ensures fields present in either school's data are included in comparison
   */
  buildUnifiedFieldLists() {
    const mainMergeSettings = this.tempData['MainSchool_mergeSettings'];
    const baselineMergeSettings = this.tempData['BaselineSchool_mergeSettings'];

    if (!mainMergeSettings && !baselineMergeSettings) {
      this.logProgress('⚠️ No merge settings available for unified field list generation', 'warn');
      return;
    }

    // Get all entity types that have field exception data
    const entityTypes = new Set();
    
    // Collect entity types from tempData keys
    Object.keys(this.tempData).forEach(key => {
      const match = key.match(/^(MainSchool|BaselineSchool)_fieldExceptionMap_(.+)$/);
      if (match) {
        entityTypes.add(match[2]);
      }
    });

    this.logProgress(`Building unified field lists for ${entityTypes.size} entities...`, 'info');

    // Process each entity type
    entityTypes.forEach(entityType => {
      const unifiedFields = new Set();

      // Get field exception maps for both schools
      const mainMapData = this.tempData[`MainSchool_fieldExceptionMap_${entityType}`];
      const baselineMapData = this.tempData[`BaselineSchool_fieldExceptionMap_${entityType}`];

      // Add fields from main school's API response (if available)
      if (mainMapData?.data) {
        Object.keys(mainMapData.data).forEach(fieldPath => unifiedFields.add(fieldPath));
      }

      // Add fields from baseline school's API response (if available)
      if (baselineMapData?.data) {
        Object.keys(baselineMapData.data).forEach(fieldPath => unifiedFields.add(fieldPath));
      }

      // Add fields from main school's configured exceptions
      const mainEntitySettings = mainMergeSettings?.[entityType];
      if (mainEntitySettings?.fieldExceptions) {
        mainEntitySettings.fieldExceptions.forEach(exceptionGroup => {
          exceptionGroup.fields.forEach(field => {
            const pathString = field.path.join('.');
            unifiedFields.add(pathString);
          });
        });
      }

      // Add fields from baseline school's configured exceptions
      const baselineEntitySettings = baselineMergeSettings?.[entityType];
      if (baselineEntitySettings?.fieldExceptions) {
        baselineEntitySettings.fieldExceptions.forEach(exceptionGroup => {
          exceptionGroup.fields.forEach(field => {
            const pathString = field.path.join('.');
            unifiedFields.add(pathString);
          });
        });
      }

      // Store the unified field list
      this.tempData[`unifiedFieldList_${entityType}`] = unifiedFields;
      
      this.logProgress(`  ${entityType}: ${unifiedFields.size} unique fields`, 'info');
    });
  }

  /**
   * Generate field exception map from local configuration when API is unavailable
   * Uses 3-step process: ALL fields → user config → global exceptions
   * @param {string} entityType - Entity type (courses, sections, etc.)
   * @param {object} entityMergeSettings - School-specific merge settings for this entity
   */
  generateLocalFieldExceptionMap(entityType, entityMergeSettings) {
    const fieldExceptionMap = {};
    
    // DYNAMIC FIELD DISCOVERY: Only include fields that are explicitly configured
    // DO NOT use hardcoded MERGE_FIELD_OPTIONS list - this causes fields to be missed
    // when comparing against schools whose API succeeded
    
    // STEP 1: Extract all user-configured fields from merge settings
    const configuredExceptions = entityMergeSettings?.fieldExceptions || [];
    
    // STEP 2: Add configured fields with their configured values
    configuredExceptions.forEach(exceptionGroup => {
      const method = exceptionGroup.conflictHandlingMethod;
      exceptionGroup.fields.forEach(field => {
        const pathString = field.path.join('.');
        // User-configured exceptions are the source of truth when API fails
        fieldExceptionMap[pathString] = method;
      });
    });
    
    // STEP 3: Apply global field exceptions ONLY if they're already in configured fields
    // Global exceptions should NOT introduce new fields when API fails
    // They only resolve values for fields that exist
    const globalExceptions = this.getGlobalFieldExceptionsForEntity(entityType);
    Object.entries(globalExceptions || {}).forEach(([fieldPath, exceptionValue]) => {
      // Only apply global exception if field is already in configured exceptions
      // This prevents global exceptions from adding fields not present in API responses
      if (fieldPath in fieldExceptionMap && fieldExceptionMap[fieldPath] === '') {
        fieldExceptionMap[fieldPath] = exceptionValue;
      }
    });
    
    return fieldExceptionMap;
  }

  /**
   * Get all possible fields for a specific entity type from MERGE_FIELD_OPTIONS
   * @param {string} entityType - Entity type (courses, sections, buildings, etc.)
   * @returns {Array} Array of field definitions with label and path
   */
  getMergeFieldOptionsForEntity(entityType) {
    // Use MERGE_FIELD_OPTIONS if loaded from merge-field-options.js
    if (typeof MERGE_FIELD_OPTIONS !== 'undefined' && MERGE_FIELD_OPTIONS[entityType]) {
      return MERGE_FIELD_OPTIONS[entityType];
    }
    
    // Fallback: minimal field set for common entities
    // This should rarely be used - only if merge-field-options.js fails to load
    const MINIMAL_FIELDS = {
      courses: [
        { label: 'Subject Code', path: ['subjectCode'] },
        { label: 'Course Number', path: ['courseNumber'] },
        { label: 'Name', path: ['name'] },
        { label: 'Description', path: ['description'] },
        { label: 'Status', path: ['status'] }
      ],
      sections: [
        { label: 'Section Number', path: ['sectionNumber'] },
        { label: 'Call Number', path: ['callNumber'] },
        { label: 'Status', path: ['status'] }
      ],
      buildings: [
        { label: 'Name', path: ['name'] },
        { label: 'Display Name', path: ['displayName'] },
        { label: 'Description', path: ['description'] }
      ],
      rooms: [
        { label: 'Name', path: ['name'] },
        { label: 'Display Name', path: ['displayName'] }
      ],
      professors: [
        { label: 'First Name', path: ['firstName'] },
        { label: 'Last Name', path: ['lastName'] }
      ]
    };
    
    return MINIMAL_FIELDS[entityType] || [];
  }

  /**
   * Get global field exceptions for a specific entity type
   */
  getGlobalFieldExceptionsForEntity(entityType) {
    // Use global-field-exceptions.js if loaded
    if (typeof GLOBAL_FIELD_EXCEPTIONS !== 'undefined' && GLOBAL_FIELD_EXCEPTIONS[entityType]) {
      return GLOBAL_FIELD_EXCEPTIONS[entityType];
    }
    
    // Fallback: inline minimal global exceptions
    const GENERAL = {
      workflowStep: 'alwaysCoursedog',
      version: 'alwaysCoursedog',
      lastSyncedAt: 'alwaysCoursedog',
      lastSyncStatus: 'alwaysCoursedog',
      lastSyncErrors: 'alwaysCoursedog',
      createdAt: 'alwaysCoursedog',
      createdBy: 'alwaysCoursedog',
      lastEditedAt: 'alwaysCoursedog',
      lastEditedBy: 'alwaysCoursedog',
      allowIntegration: 'alwaysCoursedog'
    };
    
    const ENTITY_SPECIFIC = {
      sections: { 
        ...GENERAL, 
        linkedSections: 'alwaysCoursedog', 
        relationships: 'alwaysCoursedog', 
        createdInternally: 'alwaysCoursedog', 
        ruleExceptions: 'alwaysCoursedog' 
      },
      courses: { 
        ...GENERAL, 
        requisites: 'alwaysCoursedog', 
        learningOutcomes: 'alwaysCoursedog', 
        owners: 'alwaysCoursedog' 
      },
      coursesCm: { 
        ...GENERAL, 
        requisites: 'alwaysCoursedog', 
        learningOutcomes: 'alwaysCoursedog', 
        owners: 'alwaysCoursedog' 
      }
    };
    
    return ENTITY_SPECIFIC[entityType] || GENERAL;
  }

  async fetchIntegrationData(currentStep, totalSteps) {
    this.logProgress('Starting comprehensive integration data retrieval for BOTH schools...', 'info');
    
    // Get enabled entity types from merge settings for both schools
    const mainEnabledTypes = this.getEnabledEntityTypes('MainSchool_mergeSettings');
    const baselineEnabledTypes = this.getEnabledEntityTypes('BaselineSchool_mergeSettings');
    
    this.logProgress(`Main school enabled entities: ${mainEnabledTypes.join(', ')}`, 'info');
    this.logProgress(`Baseline school enabled entities: ${baselineEnabledTypes.join(', ')}`, 'info');
    
    // Calculate actual integration steps needed for both schools
    const mainIntegrationSteps = 3 + (mainEnabledTypes.length * 4); // 3 basic endpoints + 4 endpoints per entity type
    const baselineIntegrationSteps = 3 + (baselineEnabledTypes.length * 4);
    const totalIntegrationSteps = mainIntegrationSteps + baselineIntegrationSteps;
    const newTotalSteps = (totalSteps - 50) + totalIntegrationSteps; // Replace the estimate with actual count
    
    this.logProgress(`Integration will require ${totalIntegrationSteps} steps (${mainIntegrationSteps} for Main, ${baselineIntegrationSteps} for Baseline)`, 'info');
    
    // Fetch integration data for Main School
    this.logProgress(`Fetching Main School integration data (${this.mainSchoolEnvironment})...`, 'info');
    currentStep = await this.fetchSchoolIntegrationData(this.mainSchool, 'MainSchool', mainEnabledTypes, currentStep, newTotalSteps, this.mainSchoolEnvironment);
    this.updateProgress(currentStep, newTotalSteps, 'Main School integration data retrieval completed!');
    
    // Fetch integration data for Baseline School
    this.logProgress(`Fetching Baseline School integration data (${this.baselineSchoolEnvironment})...`, 'info');
    currentStep = await this.fetchSchoolIntegrationData(this.baselineSchool, 'BaselineSchool', baselineEnabledTypes, currentStep, newTotalSteps, this.baselineSchoolEnvironment);
    this.updateProgress(currentStep, newTotalSteps, 'Baseline School integration data retrieval completed!');
    
    return currentStep;
  }

  getEnabledEntityTypes(mergeSettingsKey) {
    const mergeSettings = this.tempData[mergeSettingsKey];
    if (!mergeSettings || mergeSettings.error) {
      this.logProgress(`No merge settings available for ${mergeSettingsKey}, using default entities`, 'info');
      return ['courses', 'sections', 'professors', 'students', 'terms', 'rooms'];
    }
    
    const enabledTypes = [];
    Object.entries(mergeSettings).forEach(([key, value]) => {
      if (value && typeof value === 'object' && value.enabled === true && value.type) {
        enabledTypes.push(value.type);
      }
    });
    
    return enabledTypes.length > 0 ? enabledTypes : ['courses', 'sections', 'professors', 'students', 'terms', 'rooms'];
  }

  async fetchSchoolIntegrationData(schoolId, schoolPrefix, enabledTypes, currentStep, totalSteps, environment) {
    const integrationEndpoints = [
      { name: 'integrationSettings', endpoint: `/api/v1/admin/schools/${schoolId}/integration/settings` },
      { name: 'formatters', endpoint: `/api/v1/admin/schools/${schoolId}/integration/formatters` },
      { name: 'formattersPost', endpoint: `/api/v1/admin/schools/${schoolId}/integration/formatters/post` }
    ];
    
    // Fetch basic integration endpoints
    for (const endpoint of integrationEndpoints) {
      currentStep++;
      this.updateProgress(currentStep, totalSteps, `Fetching ${endpoint.name} for ${schoolId}...`);
      
      try {
        const data = await this.makeApiCall(endpoint.endpoint, 'GET', null, environment);
        // Store structured response with metadata
        this.tempData[`${schoolPrefix}_${endpoint.name}`] = {
          status: 'success',
          statusCode: 200,
          data: data,
          error: null,
          timestamp: new Date().toISOString(),
          endpoint: endpoint.endpoint
        };
        this.logProgress(`✓ ${schoolPrefix}_${endpoint.name} completed`, 'success');
        
        // Small delay to avoid overwhelming the API
        await this.delay(100);
      } catch (error) {
        // Downgrade expected formatter 404s to info
        if (this.isExpectedFormatter404(endpoint.endpoint, error)) {
          this.logProgress(`ℹ ${schoolPrefix}_${endpoint.name} not configured (expected for many schools)`, 'info');
          this.tempData[`${schoolPrefix}_${endpoint.name}`] = { 
            status: 'not_configured', 
            statusCode: 404,
            data: null,
            error: '404 Not Found (expected)',
            timestamp: new Date().toISOString(),
            endpoint: endpoint.endpoint
          };
        } else {
          this.logProgress(`✗ ${schoolPrefix}_${endpoint.name} failed: ${error.message}`, 'error');
          this.tempData[`${schoolPrefix}_${endpoint.name}`] = { 
            status: 'error',
            statusCode: error.statusCode || null,
            data: null,
            error: error.message,
            timestamp: new Date().toISOString(),
            endpoint: endpoint.endpoint
          };
        }
      }
    }
    
    // Fetch entity-specific endpoints for each enabled type
    for (const entityType of enabledTypes) {
      const entityEndpoints = [
        { name: `fieldMappings_${entityType}`, endpoint: `/api/v1/admin/schools/${schoolId}/integration/field-mappings/${entityType}` },
        { name: `fieldMappingsPost_${entityType}`, endpoint: `/api/v1/admin/schools/${schoolId}/integration/field-mappings/post/${entityType}` },
        { name: `customFields_${entityType}`, endpoint: `/api/v1/admin/schools/${schoolId}/integration/field-mappings/${entityType}/custom-fields` },
        { name: `customFieldsPost_${entityType}`, endpoint: `/api/v1/admin/schools/${schoolId}/integration/field-mappings/post/${entityType}/custom-fields` }
      ];
      
      for (const endpoint of entityEndpoints) {
        currentStep++;
        this.updateProgress(currentStep, totalSteps, `Fetching ${endpoint.name} for ${schoolId}...`);
        
        try {
          const data = await this.makeApiCall(endpoint.endpoint, 'GET', null, environment);
          // Store structured response with metadata
          this.tempData[`${schoolPrefix}_${endpoint.name}`] = {
            status: 'success',
            statusCode: 200,
            data: data,
            error: null,
            timestamp: new Date().toISOString(),
            endpoint: endpoint.endpoint
          };
          this.logProgress(`✓ ${schoolPrefix}_${endpoint.name} completed`, 'success');
          
          // Small delay between requests
          await this.delay(100);
        } catch (error) {
          if (this.isExpectedFormatter404(endpoint.endpoint, error)) {
            this.logProgress(`ℹ ${schoolPrefix}_${endpoint.name} not configured (expected for many schools)`, 'info');
            this.tempData[`${schoolPrefix}_${endpoint.name}`] = { 
              status: 'not_configured', 
              statusCode: 404,
              data: null,
              error: '404 Not Found (expected)',
              timestamp: new Date().toISOString(),
              endpoint: endpoint.endpoint
            };
          } else {
            this.logProgress(`✗ ${schoolPrefix}_${endpoint.name} failed: ${error.message}`, 'error');
            this.tempData[`${schoolPrefix}_${endpoint.name}`] = { 
              status: 'error',
              statusCode: error.statusCode || null,
              data: null,
              error: error.message,
              timestamp: new Date().toISOString(),
              endpoint: endpoint.endpoint
            };
          }
        }
      }
    }
    
    return currentStep;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isIntegrationFile(key) {
    // Check if the file is integration-related (should be excluded from individual downloads)
    const integrationPatterns = [
      'integrationSettings',
      'formatters',
      'formattersPost',
      'fieldMappings_',
      'fieldMappingsPost_',
      'customFields_',
      'customFieldsPost_'
    ];
    
    return integrationPatterns.some(pattern => key.includes(pattern));
  }

  generateDownloadableReports() {
    // Clean up previous download URLs before generating new ones
    this.cleanupDownloadUrls();
    
    // Don't show results section here - it will be shown after all processing is complete
    const downloadContainer = document.getElementById('download-links');
    downloadContainer.innerHTML = '';

    this.logProgress('Generating downloadable files...', 'info');

    // Generate individual data files (exclude integration files since they're in CAC_Report.md)
    Object.keys(this.tempData).forEach(key => {
      // Skip integration-related files since they're consolidated in CAC_Report.md
      if (this.isIntegrationFile(key)) {
        return;
      }
      
      // Handle snapshot files with proper naming
      let filename = `${key}.json`;
      let mimeType = 'application/json';
      
      if (key.includes('snapshot_') && key.includes('_json')) {
        filename = key.replace('snapshot_', '').replace('_json', '_snapshot.json');
      } else if (key.includes('snapshot_') && key.includes('_markdown')) {
        // Skip markdown snapshot files - we don't need them
        return;
      }
      
      const content = mimeType === 'text/markdown' ? this.tempData[key] : JSON.stringify(this.tempData[key], null, 2);
      const link = this.createDownloadLink(filename, content, mimeType);
      downloadContainer.appendChild(link);
    });

    // Removed Configuration_Comparison_Report download (no longer needed)

    // Add CAC Report if available
    if (this.tempData['CAC_Report']) {
      const cacLink = this.createDownloadLink('CAC_Report.md', this.tempData['CAC_Report'], 'text/markdown');
      downloadContainer.appendChild(cacLink);
    }

    // Add new comparison reports (filtered by checkbox states)
    const curriculumEnabled = document.getElementById('curriculum-checkbox').checked;
    const schedulingEnabled = document.getElementById('scheduling-checkbox').checked;
    
    this.comparisonReportKeys.forEach(reportKey => {
      if (this.tempData[reportKey]) {
        // Filter reports based on checkbox states
        let shouldInclude = true;
        
        if (reportKey === 'courseTemplate_Comparison_Report' || reportKey === 'programTemplate_Comparison_Report') {
          shouldInclude = curriculumEnabled;
        } else if (reportKey === 'sectionTemplate_Comparison_Report') {
          shouldInclude = schedulingEnabled;
        }
        
        if (shouldInclude) {
          const reportLink = this.createDownloadLink(`${reportKey}.md`, this.tempData[reportKey], 'text/markdown');
          downloadContainer.appendChild(reportLink);
        }
      }
    });

    // Generate debug log file
    const debugLog = this.generateDebugLogFile();
    const debugLink = this.createDownloadLink('API_Debug_Log.md', debugLog, 'text/markdown');
    downloadContainer.appendChild(debugLink);

    // Generate Notion debug log file if available
    if (this.notionClient && this.notionClient.getLogs && this.notionClient.getLogs().length > 0) {
      const notionDebugLog = this.generateNotionDebugLog();
      const notionDebugLink = this.createDownloadLink('Notion_API_Debug_Log.md', notionDebugLog, 'text/markdown');
      downloadContainer.appendChild(notionDebugLink);
    }

    // Setup simple download button (no main report dependency)
    try {
      this.setupSimpleDownload();
    } catch (error) {
      console.error('Error setting up simple download:', error);
      this.logProgress(`✗ Error setting up simple download: ${error.message}`, 'error');
    }

    // Count only non-integration files for individual downloads
    const coreDataFiles = Object.keys(this.tempData).filter(key => !this.isIntegrationFile(key));
    
    // Count filtered comparison reports
    let availableComparisonReports = 0;
    this.comparisonReportKeys.forEach(reportKey => {
      if (this.tempData[reportKey]) {
        let shouldInclude = true;
        
        if (reportKey === 'courseTemplate_Comparison_Report' || reportKey === 'programTemplate_Comparison_Report') {
          shouldInclude = curriculumEnabled;
        } else if (reportKey === 'sectionTemplate_Comparison_Report') {
          shouldInclude = schedulingEnabled;
        }
        
        if (shouldInclude) {
          availableComparisonReports++;
        }
      }
    });
    
    const reportFiles = 1 + (this.tempData['CAC_Report'] ? 1 : 0) + availableComparisonReports; // debug log + CAC report + comparison reports
    const totalFiles = coreDataFiles.length + reportFiles;
    
    this.logProgress(`Generated ${totalFiles} downloadable files (${coreDataFiles.length} core data files + ${reportFiles} reports)`, 'success');
    
    // Hide loading state now that files are ready
    const resultsLoading = document.getElementById('results-loading');
    if (resultsLoading) {
      resultsLoading.style.display = 'none';
    }
    
    // Show Notion section and enable button only if experimental features are enabled
    const experimentalFeaturesEnabled = document.getElementById('experimental-features-checkbox').checked;
    if (experimentalFeaturesEnabled) {
      document.getElementById('notion-section').style.display = 'block';
    }
    document.getElementById('send-to-notion-btn').disabled = false;
    // Enable View Reports button
    const viewBtn = document.getElementById('view-reports-btn');
    if (viewBtn) viewBtn.style.display = 'inline-block';
    
    this.logProgress('All files ready for download and Notion upload!', 'success');
  }

  setupSimpleDownload(comparisonReport) {
    const simpleDownloadBtn = document.getElementById('simple-report-download');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const filename = `Coursedog_Report_${this.mainSchool}_vs_${this.baselineSchool}_${timestamp}.zip`;
    
    // Create ZIP file with all comparison reports (excluding Configuration_Comparison_Report)
    this.createSimpleZip(simpleDownloadBtn, filename);
  }

  async openReportViewer() {
    if (!this.tempData || Object.keys(this.tempData).length === 0) {
      alert('No report data available. Please generate a report first.');
      return;
    }
    try {
      // Build payload with index and reports
      const curriculumEnabled = document.getElementById('curriculum-checkbox').checked;
      const schedulingEnabled = document.getElementById('scheduling-checkbox').checked;
      const index = [];
      const reports = {};

      // Ensure side-effect reports are generated (CAC + comparison reports)
      try { this.generateComparisonReport(); } catch (e) { console.warn('Side-effect report generation failed', e); }

      // Removed Configuration_Comparison_Report from viewer payload

      // CAC Report
      if (this.tempData['CAC_Report']) {
        reports['CAC_Report'] = this.tempData['CAC_Report'];
        index.push({ key: 'CAC_Report', title: '📋 CAC Report', type: 'markdown' });
      }

      // Additional reports
      const extra = [
        { key: 'stepsToExecute_Comparison_Report', title: '🔄 Steps to Execute Comparison', cond: true },
        { key: 'fieldExceptions_Comparison_Report', title: '⚠️ Field Exceptions Comparison', cond: true },
        { key: 'courseTemplate_Comparison_Report', title: '📚 Course Template Comparison', cond: curriculumEnabled },
        { key: 'programTemplate_Comparison_Report', title: '🎓 Program Template Comparison', cond: curriculumEnabled },
        { key: 'sectionTemplate_Comparison_Report', title: '📅 Section Template Comparison', cond: schedulingEnabled },
        { key: 'AttributeMapping_Comparison_Report', title: '🗺️ Attribute Mapping Comparison', cond: true },
        { key: 'IntegrationFilters_Comparison_Report', title: '🔍 Integration Filters Comparison', cond: true }
      ];
      extra.forEach(item => {
        if (item.cond && this.tempData[item.key]) {
          reports[item.key] = this.tempData[item.key];
          index.push({ key: item.key, title: item.title, type: 'markdown' });
        }
      });

      const sessionId = 'rv_' + Date.now();
      const payload = {
        meta: { mainSchool: this.mainSchool, baselineSchool: this.baselineSchool, createdAt: new Date().toISOString() },
        index,
        reports
      };
      await chrome.storage.local.set({ [sessionId]: payload });
      const url = chrome.runtime.getURL(`report-viewer.html?session=${sessionId}`);
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Failed to open report viewer:', error);
      alert('Failed to open report viewer. See console for details.');
    }
  }

  async createSimpleZip(downloadBtn, filename) {
    if (!window.JSZip) {
      console.error('JSZip not available:', typeof window.JSZip);
      this.logProgress('✗ JSZip library not loaded for simple download', 'error');
      return;
    }

    try {
      const zip = new JSZip();
      
      // Ensure side-effect comparison reports are generated (fills tempData)
      try {
        this.generateComparisonReport();
      } catch (error) {
        console.warn('Side-effect report generation failed before simple ZIP', error);
      }
      
      // Add CAC Report if available
      if (this.tempData['CAC_Report']) {
        zip.file('CAC_Report.md', this.tempData['CAC_Report']);
        this.logProgress('Added CAC_Report.md to simple ZIP', 'info');
      }
      
      // Add comparison reports (filtered by checkbox states)
      const curriculumEnabled = document.getElementById('curriculum-checkbox').checked;
      const schedulingEnabled = document.getElementById('scheduling-checkbox').checked;
      
      this.comparisonReportKeys.forEach(reportKey => {
        if (this.tempData[reportKey]) {
          let shouldInclude = true;
          if (reportKey === 'courseTemplate_Comparison_Report' || reportKey === 'programTemplate_Comparison_Report') {
            shouldInclude = curriculumEnabled;
          } else if (reportKey === 'sectionTemplate_Comparison_Report') {
            shouldInclude = schedulingEnabled;
          }
          
          if (shouldInclude) {
            zip.file(`${reportKey}.md`, this.tempData[reportKey]);
            this.logProgress(`Added ${reportKey}.md to simple ZIP`, 'info');
          }
        }
      });
      
      // Add snapshot files if available (JSON only, skip markdown)
      Object.keys(this.tempData).forEach(key => {
        if (key.includes('snapshot_') && key.includes('_json')) {
          const filename = key.replace('snapshot_', '').replace('_json', '_snapshot.json');
          zip.file(filename, this.tempData[key]);
          this.logProgress(`Added ${filename} to simple ZIP`, 'info');
        }
      });

      // Add Notion debug log if available
      if (this.notionClient && this.notionClient.getLogs && this.notionClient.getLogs().length > 0) {
        const notionDebugLog = this.generateNotionDebugLog();
        zip.file('Notion_API_Debug_Log.md', notionDebugLog);
        this.logProgress('Added Notion_API_Debug_Log.md to simple ZIP', 'info');
      }
      
      // Generate ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      
      downloadBtn.href = url;
      downloadBtn.download = filename;
      downloadBtn.style.display = 'inline-block';
      
      // Track this URL for proper cleanup
      this.activeDownloadUrls.add(url);
      
      this.logProgress(`✓ Simple ZIP download ready: ${filename}`, 'success');
      
    } catch (error) {
      console.error('Error creating simple ZIP:', error);
      this.logProgress(`✗ Error creating simple ZIP: ${error.message}`, 'error');
    }
  }

  downloadSimpleReport() {
    // This is handled by the anchor tag's href/download attributes
    this.logProgress('✓ Downloaded reports', 'success');
  }

  toggleAdvancedOptions(show) {
    const advancedOptions = document.getElementById('advanced-options');
    const progressSection = document.getElementById('progress-section');
    const progressLogContainer = document.getElementById('progress-log-container');
    const notionProgressSection = document.getElementById('notion-progress-section');
    const notionProgressLogContainer = document.getElementById('notion-progress-log-container');
    const notionUploadBanner = document.getElementById('notion-upload-banner');
    
    advancedOptions.style.display = show ? 'block' : 'none';
    if (progressSection) {
      progressSection.style.display = show ? 'block' : 'none';
    }
    if (progressLogContainer) {
      progressLogContainer.style.display = show ? 'block' : 'none';
    }
    if (notionProgressSection) {
      notionProgressSection.style.display = show ? 'block' : 'none';
    }
    if (notionProgressLogContainer) {
      notionProgressLogContainer.style.display = show ? 'block' : 'none';
    }
    // Hide Notion upload banner unless nerds mode is enabled
    if (notionUploadBanner) {
      notionUploadBanner.style.display = show ? 'block' : 'none';
    }
    
    this.logProgress(show ? 'Advanced options enabled' : 'Advanced options hidden', 'info');
  }

  toggleExperimentalFeatures(show) {
    const notionSection = document.getElementById('notion-section');
    
    if (notionSection) {
      notionSection.style.display = show ? 'block' : 'none';
    }
  }

  generateComparisonReport() {
    const curriculumEnabled = document.getElementById('curriculum-checkbox').checked;
    const schedulingEnabled = document.getElementById('scheduling-checkbox').checked;
    
    const reportGenerator = new CoursedogReportGenerator(
      this.selectedMainSchool.name || this.mainSchool, 
      this.selectedBaselineSchool.name || this.baselineSchool, 
      this.tempData, 
      this.debugLog,
      curriculumEnabled,
      schedulingEnabled,
      this.selectedMainSchool.environment || 'staging',
      this.selectedBaselineSchool.environment || 'staging'
    );
    // Call to generate side-effect reports only; ignore returned content
    try { reportGenerator.generateComparisonReport(); } catch (e) { console.warn('Comparison generation failed', e); }
    return '';
  }


  createDownloadLink(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    // Track this URL for proper cleanup
    this.activeDownloadUrls.add(url);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'download-link';
    link.textContent = `📄 Download ${filename}`;
    
    // No automatic cleanup - URLs will be cleaned up when new reports are generated or page unloads
    
    return link;
  }

  updateProgress(current, total, message) {
    const percentage = Math.round((current / total) * 100);
    document.getElementById('progress-fill').style.width = `${percentage}%`;
    document.getElementById('progress-text').textContent = `${percentage}% - ${message}`;
  }

  logProgress(message, type = 'info') {
    const log = document.getElementById('progress-log');
    if (!log) return; // Log might not exist during initial load
    
    const entry = document.createElement('div');
    entry.className = type;
    entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  // Notion Upload Progress Methods
  updateNotionProgress(current, total, message) {
    const percentage = Math.round((current / total) * 100);
    const progressFill = document.getElementById('notion-progress-fill');
    const progressText = document.getElementById('notion-progress-text');
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
    if (progressText) {
      // Check if message already contains a percentage to avoid duplication
      if (message.includes('%')) {
        progressText.textContent = message;
      } else {
        progressText.textContent = `${percentage}% - ${message}`;
      }
    }
  }

  logNotionProgress(message, type = 'info') {
    const log = document.getElementById('notion-progress-log');
    if (!log) return; // Log might not exist during initial load
    
    const entry = document.createElement('div');
    entry.className = type;
    // Use Date.now() to ensure unique timestamps
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `${timestamp}: ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  showNotionProgress() {
    const notionProgressSection = document.getElementById('notion-progress-section');
    const notionProgressLogContainer = document.getElementById('notion-progress-log-container');
    
    if (notionProgressSection) {
      notionProgressSection.style.display = 'block';
    }
    if (notionProgressLogContainer) {
      notionProgressLogContainer.style.display = 'block';
    }
  }

  hideNotionProgress() {
    const notionProgressSection = document.getElementById('notion-progress-section');
    const notionProgressLogContainer = document.getElementById('notion-progress-log-container');
    
    if (notionProgressSection) {
      notionProgressSection.style.display = 'none';
    }
    if (notionProgressLogContainer) {
      notionProgressLogContainer.style.display = 'none';
    }
  }

  showDebugData() {
    const debugOutput = document.getElementById('debug-output');
    const debugBtn = document.getElementById('debug-data-btn');
    
    if (debugOutput.style.display === 'none') {
      // Show debug data
      debugOutput.style.display = 'block';
      debugBtn.textContent = '🔍 Debug: Hide Raw Data';
      
      let debugHtml = '<h3>🔍 Raw API Response Data</h3>';
      
      Object.keys(this.tempData).forEach(key => {
        const data = this.tempData[key];
        debugHtml += `<h3>${key}</h3>`;
        
        if (data.error) {
          debugHtml += `<div class="error-data">ERROR: ${data.error}</div>`;
          if (data.rawData) {
            debugHtml += `<pre>Raw Data: ${JSON.stringify(data.rawData, null, 2)}</pre>`;
          }
        } else {
          // Show first 500 characters of the JSON
          const jsonStr = JSON.stringify(data, null, 2);
          const preview = jsonStr.length > 500 ? jsonStr.substring(0, 500) + '...\n[TRUNCATED - Download full file]' : jsonStr;
          debugHtml += `<pre>${preview}</pre>`;
        }
        debugHtml += '<hr>';
      });
      
      if (Object.keys(this.tempData).length === 0) {
        debugHtml += '<p>No temp data available. Run a report first.</p>';
      }
      
      debugOutput.innerHTML = debugHtml;
    } else {
      // Hide debug data
      debugOutput.style.display = 'none';
      debugBtn.textContent = '🔍 Debug: Show Raw Data';
    }
  }

  // Session Storage Methods
  async loadSessionData() {
    try {
      const data = await chrome.storage.session.get(['tempData', 'mainSchool', 'baselineSchool', 'debugLog', 'lastReportTime']);
      
      if (data.tempData && data.mainSchool && data.baselineSchool) {
        this.tempData = data.tempData;
        this.mainSchool = data.mainSchool;
        this.baselineSchool = data.baselineSchool;
        this.debugLog = data.debugLog || [];
        
        const timeDiff = Date.now() - (data.lastReportTime || 0);
        const hoursSince = timeDiff / (1000 * 60 * 60);
        
        // Only restore if less than 24 hours old
        if (hoursSince < 24) {
          this.logProgress(`Restored session data from ${Math.round(hoursSince * 10) / 10} hours ago (${this.debugLog.length} API calls logged)`, 'info');
          return true;
        }
      }
    } catch (error) {
      console.log('No session data to restore:', error);
    }
    return false;
  }

  async saveSessionData() {
    try {
      await chrome.storage.session.set({
        tempData: this.tempData,
        mainSchool: this.mainSchool,
        baselineSchool: this.baselineSchool,
        debugLog: this.debugLog,
        lastReportTime: Date.now()
      });
    } catch (error) {
      console.error('Failed to save session data:', error);
    }
  }

  async clearSessionData() {
    try {
      await chrome.storage.session.clear();
    } catch (error) {
      console.error('Failed to clear session data:', error);
    }
  }

  /**
   * Check if session data exists without restoring it
   * @returns {Promise<Object>} Session info with metadata
   */
  async checkSessionData() {
    try {
      const data = await chrome.storage.session.get([
        'tempData', 
        'mainSchool', 
        'baselineSchool', 
        'debugLog', 
        'lastReportTime'
      ]);
      
      if (data.tempData && data.mainSchool && data.baselineSchool) {
        const timeDiff = Date.now() - (data.lastReportTime || 0);
        const hoursSince = timeDiff / (1000 * 60 * 60);
        
        // Only consider data less than 24 hours old
        if (hoursSince < 24) {
          const sessionInfo = {
            hasData: true,
            mainSchool: data.mainSchool,
            baselineSchool: data.baselineSchool,
            reportTime: data.lastReportTime,
            hoursSince: hoursSince,
            apiCallCount: (data.debugLog || []).length,
            fileCount: Object.keys(data.tempData).length
          };
          
          // Log session info for debugging
          console.log('📊 Session Data Status:', {
            hasData: sessionInfo.hasData,
            schools: `${sessionInfo.mainSchool} vs ${sessionInfo.baselineSchool}`,
            age: `${sessionInfo.hoursSince.toFixed(1)} hours`,
            files: sessionInfo.fileCount,
            apiCalls: sessionInfo.apiCallCount
          });
          
          return sessionInfo;
        }
      }
    } catch (error) {
      console.log('No valid session data:', error);
    }
    
    return { hasData: false };
  }

  /**
   * Show a banner offering to restore previous session
   * @param {Object} sessionInfo - Session metadata
   */
  showSessionRestorationBanner(sessionInfo) {
    const schoolSection = document.getElementById('school-section');
    
    // Don't show banner if it already exists
    if (document.getElementById('session-restore-banner')) {
      return;
    }
    
    // Create banner element
    const banner = document.createElement('div');
    banner.id = 'session-restore-banner';
    banner.style.cssText = `
      margin-bottom: 16px;
      padding: 12px 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px;
      color: white;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    `;
    
    const hoursSinceText = sessionInfo.hoursSince < 1 
      ? `${Math.round(sessionInfo.hoursSince * 60)} minutes ago`
      : `${Math.round(sessionInfo.hoursSince * 10) / 10} hours ago`;
    
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 24px;">📊</span>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 4px;">
            Previous Report Available
          </div>
          <div style="font-size: 13px; opacity: 0.9;">
            ${sessionInfo.mainSchool} vs ${sessionInfo.baselineSchool} • 
            Generated ${hoursSinceText} • 
            ${sessionInfo.fileCount} files
          </div>
        </div>
        <button id="restore-session-btn" class="btn" style="
          background: white;
          color: #667eea;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        ">
          📥 Resume
        </button>
        <button id="dismiss-session-btn" class="btn" style="
          background: rgba(255, 255, 255, 0.2);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.3);
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
        ">
          ✖ Start Fresh
        </button>
      </div>
    `;
    
    // Insert banner at the top of school section
    schoolSection.insertBefore(banner, schoolSection.firstChild);
    
    // Add event listeners
    document.getElementById('restore-session-btn').addEventListener('click', () => {
      this.restoreSessionData();
      banner.remove();
    });
    
    document.getElementById('dismiss-session-btn').addEventListener('click', async () => {
      await this.clearSessionData();
      banner.remove();
      this.logProgress('Session data cleared. Starting fresh.', 'info');
    });
  }

  /**
   * Restore session data when user explicitly chooses to
   */
  async restoreSessionData() {
    const hasData = await this.loadSessionData();
    
    if (hasData) {
      this.logProgress(`📥 Restored previous report: ${this.mainSchool} vs ${this.baselineSchool}`, 'success');
      
      // Restore UI state
      this.hideSchoolSelection('main', this.mainSchool);
      this.hideSchoolSelection('baseline', this.baselineSchool);
      this.generateDownloadableReports();
      document.getElementById('results-section').style.display = 'block';
      
      // Scroll to results
      document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    }
  }

  /**
   * Create a deep copy of tempData for isolated upload
   * Ensures upload data is immutable and won't be affected by future report generations
   * @param {Object} data - Data to snapshot
   * @returns {Object} Deep copy of the data
   */
  createDataSnapshot(data) {
    try {
      // Use JSON serialization for deep copy
      return JSON.parse(JSON.stringify(data));
    } catch (error) {
      console.error('Failed to create data snapshot:', error);
      // Fallback: return the original data (better than failing completely)
      return data;
    }
  }

  /**
   * Get upload queue status
   * @returns {Promise<Object>} Queue status with running/pending jobs
   */
  async getUploadQueueStatus() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'listUploadJobs' }, resolve);
      });
      
      if (response && response.ok && Array.isArray(response.jobs)) {
        const running = response.jobs.filter(j => 
          j && (j.status === 'running' || j.status === 'pending')
        );
        const queued = response.jobs.filter(j => j && j.status === 'queued');
        
        return {
          hasRunning: running.length > 0,
          hasQueued: queued.length > 0,
          runningJobs: running,
          queuedJobs: queued,
          queueLength: running.length + queued.length,
          totalJobs: response.jobs.length
        };
      }
    } catch (error) {
      console.warn('Failed to get queue status:', error);
    }
    
    return { 
      hasRunning: false, 
      hasQueued: false, 
      queueLength: 0,
      runningJobs: [],
      queuedJobs: [],
      totalJobs: 0
    };
  }

  /**
   * Clean up old snapshots (older than 7 days or completed uploads)
   */
  async cleanupOldSnapshots() {
    try {
      const data = await chrome.storage.local.get(['notionSnapshots', 'uploadJobs']);
      const snapshots = data.notionSnapshots || {};
      const jobs = data.uploadJobs || {};
      
      const now = Date.now();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      let cleanedCount = 0;
      
      for (const [jobId, snapshot] of Object.entries(snapshots)) {
        const job = jobs[jobId];
        const age = now - snapshot.createdAt;
        
        // Delete if:
        // 1. Older than 7 days
        // 2. Job completed successfully
        // 3. Job doesn't exist anymore
        const shouldDelete = age > SEVEN_DAYS || 
                           (job && job.status === 'succeeded') || 
                           !job;
        
        if (shouldDelete) {
          // Remove payload from storage
          try {
            if (snapshot.payloadKey) {
              await chrome.storage.local.remove(snapshot.payloadKey);
            }
            if (snapshot.secretKey) {
              await chrome.storage.local.remove(snapshot.secretKey);
            }
            cleanedCount++;
          } catch (e) {
            console.warn('Cleanup error for job', jobId, ':', e);
          }
          
          // Remove from snapshot registry
          delete snapshots[jobId];
        }
      }
      
      // Save updated snapshots
      await chrome.storage.local.set({ notionSnapshots: snapshots });
      
      if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} old snapshot(s)`);
      }
    } catch (error) {
      console.warn('Cleanup old snapshots failed:', error);
    }
  }

  /**
   * Generate smart banner text based on queue status and job progress
   * @param {Object} queueStatus - Current queue status
   * @returns {string} Smart banner HTML
   */
  generateSmartBannerText(queueStatus) {
    const { currentJob, queuedJobs, totalEstimatedTime } = queueStatus;
    
    if (currentJob) {
      return this.generateCurrentJobBanner(currentJob, queuedJobs);
    } else if (queuedJobs.length > 0) {
      return this.generateQueueBanner(queuedJobs);
    }
    
    return null;
  }

  /**
   * Generate banner text for current job with queue info
   * @param {Object} currentJob - Current running job
   * @param {Array} queuedJobs - Array of queued jobs
   * @returns {string} Banner HTML
   */
  generateCurrentJobBanner(currentJob, queuedJobs = []) {
    const jobId = currentJob.id;
    const progress = currentJob.progress || {};
    const meta = currentJob.meta || {};
    const percent = progress.percent || 0;
    const operation = this.getOperationDisplayText(progress.currentOperation);
    const filesInfo = this.getFilesInfo(progress);
    const timeInfo = this.getTimeInfo(progress);
    const queueInfo = this.getQueueInfo(queuedJobs);
    
    const mainSchool = meta.mainSchool || 'Unknown';
    const baselineSchool = meta.baselineSchool || 'Unknown';
    
    let bannerHtml = `
      <div style="margin-bottom: 8px;">
        <strong>⏳ Uploading: ${mainSchool} vs ${baselineSchool} (${percent}% complete)</strong>
      </div>
      <div style="font-size: 0.9em; color: #666; margin-bottom: 4px;">
        ${filesInfo} • ${operation} • ${timeInfo}
      </div>
      <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <button class="btn btn-danger btn-sm cancel-job-btn" data-job-id="${jobId}" 
                style="font-size: 0.8em; padding: 4px 8px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">
          🛑 Cancel This Upload
        </button>
        ${queuedJobs.length > 0 ? `
          <button class="btn btn-secondary btn-sm toggle-queue-btn" 
                  style="font-size: 0.8em; padding: 4px 8px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">
            📋 View Queue (${queuedJobs.length} more)
          </button>
        ` : ''}
      </div>
    `;
    
    if (queuedJobs.length > 0) {
      bannerHtml += `
        <div style="font-size: 0.85em; color: #555; margin-top: 8px;">
          📋 ${queueInfo}
        </div>
      `;
    }
    
    bannerHtml += `
      <div style="font-size: 0.85em; color: #666; margin-top: 6px;">
        This continues in background. You can close or generate new reports.
      </div>
    `;
    
    return bannerHtml;
  }

  /**
   * Generate banner text for queued jobs only
   * @param {Array} queuedJobs - Array of queued jobs
   * @returns {string} Banner HTML
   */
  generateQueueBanner(queuedJobs) {
    const totalTime = this.calculateTotalQueueTime(queuedJobs);
    
    let bannerHtml = `
      <div style="margin-bottom: 8px;">
        <strong>📋 Upload Queue: ${queuedJobs.length} job(s) queued</strong>
      </div>
    `;
    
    // Show first few queued jobs
    const displayJobs = queuedJobs.slice(0, 3);
    displayJobs.forEach((job, index) => {
      const meta = job.meta || {};
      const mainSchool = meta.mainSchool || 'Unknown';
      const baselineSchool = meta.baselineSchool || 'Unknown';
      const position = index + 1;
      
      bannerHtml += `
        <div style="font-size: 0.9em; color: #666; margin: 2px 0;">
          ${position === 1 ? '⏳ Next:' : `⏳ #${position}:`} ${mainSchool} vs ${baselineSchool}
        </div>
      `;
    });
    
    if (queuedJobs.length > 3) {
      bannerHtml += `
        <div style="font-size: 0.9em; color: #666; margin: 2px 0;">
          ... and ${queuedJobs.length - 3} more
        </div>
      `;
    }
    
    bannerHtml += `
      <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <button class="btn btn-secondary btn-sm toggle-queue-btn" 
                style="font-size: 0.8em; padding: 4px 8px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">
          📋 Manage Queue
        </button>
      </div>
      <div style="font-size: 0.85em; color: #555; margin-top: 6px;">
        ⏱️ ~${this.formatTime(totalTime)} total • Next starts automatically
      </div>
    `;
    
    return bannerHtml;
  }

  /**
   * Get display text for current operation
   * @param {string} operation - Current operation code
   * @returns {string} Display text
   */
  getOperationDisplayText(operation) {
    const operations = {
      'initializing': '🔄 Initializing...',
      'page_creation': '📄 Creating pages...',
      'file_upload': '📤 Uploading files...',
      'finalizing': '✨ Finalizing...'
    };
    return operations[operation] || '🔄 Working...';
  }

  /**
   * Get files information string
   * @param {Object} progress - Job progress object
   * @returns {string} Files info
   */
  getFilesInfo(progress) {
    const processed = progress.filesProcessed || 0;
    const total = progress.totalFiles || 0;
    
    if (total > 0) {
      return `📄 ${processed}/${total} files`;
    }
    return '📄 Processing files...';
  }

  /**
   * Get time information string
   * @param {Object} progress - Job progress object
   * @returns {string} Time info
   */
  getTimeInfo(progress) {
    const remaining = progress.estimatedTimeRemaining;
    
    if (remaining && remaining > 0) {
      return `⏱️ ~${this.formatTime(remaining)} remaining`;
    }
    return '⏱️ Calculating...';
  }

  /**
   * Get queue information string
   * @param {Array} queuedJobs - Array of queued jobs
   * @returns {string} Queue info
   */
  getQueueInfo(queuedJobs) {
    if (queuedJobs.length === 0) return '';
    
    const parts = [];
    if (queuedJobs.length === 1) {
      parts.push('1 queued');
    } else {
      parts.push(`${queuedJobs.length} queued`);
    }
    
    return parts.join(', ') + ' • Next starts automatically';
  }

  /**
   * Calculate total estimated time for queue
   * @param {Array} queuedJobs - Array of queued jobs
   * @param {Object} currentJob - Current running job (optional)
   * @returns {number} Total time in milliseconds
   */
  calculateTotalQueueTime(queuedJobs, currentJob = null) {
    let totalTime = 0;
    
    // Add time for current job if running
    if (currentJob && currentJob.progress) {
      const progress = currentJob.progress;
      const remaining = progress.estimatedTimeRemaining || 0;
      if (remaining > 0) {
        totalTime += remaining;
      } else {
        // Fallback estimation for current job
        const percent = progress.percent || 0;
        const elapsed = progress.startedAt ? Date.now() - new Date(progress.startedAt).getTime() : 0;
        if (percent > 0 && elapsed > 0) {
          const estimatedTotal = (elapsed / percent) * 100;
          totalTime += Math.max(0, estimatedTotal - elapsed);
        } else {
          totalTime += 25 * 60 * 1000; // 25 min fallback
        }
      }
    }
    
    // Add time for queued jobs
    const ESTIMATED_JOB_TIME = 25 * 60 * 1000; // 25 minutes per job
    totalTime += queuedJobs.length * ESTIMATED_JOB_TIME;
    
    return totalTime;
  }

  /**
   * Format time in milliseconds to human readable string
   * @param {number} ms - Time in milliseconds
   * @returns {string} Formatted time
   */
  formatTime(ms) {
    if (!ms || ms <= 0) return '0 min';
    
    const minutes = Math.round(ms / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours > 0) {
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
    return `${minutes} min`;
  }

  /**
   * Update queue progress display
   * @param {Object} queueStatus - Current queue status
   */
  updateQueueProgress(queueStatus) {
    const queueProgressDiv = document.getElementById('queue-progress');
    const queueProgressText = document.getElementById('queue-progress-text');
    const queueProgressPercent = document.getElementById('queue-progress-percent');
    const queueProgressFill = document.getElementById('queue-progress-fill');
    
    if (!queueProgressDiv || !queueProgressText || !queueProgressPercent || !queueProgressFill) {
      return;
    }
    
    const { currentJob, queuedJobs } = queueStatus;
    const totalJobs = (currentJob ? 1 : 0) + queuedJobs.length;
    
    if (totalJobs > 1) {
      // Show queue progress
      queueProgressDiv.style.display = 'block';
      
      if (currentJob) {
        // Current job is running
        const currentProgress = currentJob.progress?.percent || 0;
        const jobProgress = currentProgress / 100; // Convert to 0-1
        const queueProgress = jobProgress / totalJobs; // Progress of current job within total queue
        const percent = Math.round(queueProgress * 100);
        
        const jobDetails = this.getJobDetails(currentJob);
        queueProgressText.textContent = `Job 1 of ${totalJobs} • ${jobDetails.mainSchool} vs ${jobDetails.baselineSchool} (${currentProgress}%)`;
        queueProgressPercent.textContent = `${percent}%`;
        queueProgressFill.style.width = `${percent}%`;
      } else {
        // Only queued jobs
        queueProgressText.textContent = `${queuedJobs.length} job(s) queued • Next starts automatically`;
        queueProgressPercent.textContent = '0%';
        queueProgressFill.style.width = '0%';
      }
    } else {
      // Hide queue progress for single job
      queueProgressDiv.style.display = 'none';
    }
  }

  /**
   * Get enhanced job details for display
   * @param {Object} job - Job object
   * @returns {Object} Enhanced job details
   */
  getJobDetails(job) {
    const meta = job.meta || {};
    const progress = job.progress || {};
    
    return {
      mainSchool: meta.mainSchool || 'Unknown',
      baselineSchool: meta.baselineSchool || 'Unknown',
      percent: progress.percent || 0,
      operation: progress.currentOperation || 'unknown',
      filesProcessed: progress.filesProcessed || 0,
      totalFiles: progress.totalFiles || 0,
      estimatedTimeRemaining: progress.estimatedTimeRemaining || 0,
      lastMessage: progress.lastMessage || '',
      status: job.status || 'unknown'
    };
  }

  /**
   * Cancel specific job by ID
   * @param {string} jobId - Job ID to cancel
   */
  async cancelSpecificJob(jobId) {
    try {
      // Confirm cancellation
      const confirmed = await this.showConfirmation(
        'Cancel Upload',
        'Are you sure you want to cancel this upload? This action cannot be undone.',
        'Cancel Upload',
        'Keep Running'
      );
      if (!confirmed) return;
      
      // Show immediate feedback
      this.logNotionProgress('Cancelling upload...', 'info');
      
      // Send cancel request
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'cancelNotionUpload', jobId }, (resp) => {
          resolve(resp);
        });
      });
      
      if (response && response.ok) {
        // Update UI
        this.logNotionProgress(`✅ Upload cancelled successfully`, 'success');
        this.syncNotionUploadUiState();
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
      
    } catch (error) {
      console.error('Cancel job error:', error);
      this.logNotionProgress(`❌ Failed to cancel upload: ${error.message}`, 'error');
    }
  }

  /**
   * Remove job from queue
   * @param {string} jobId - Job ID to remove
   */
  async removeFromQueue(jobId) {
    try {
      const confirmed = await this.showConfirmation(
        'Remove from Queue',
        'Remove this job from the queue? It will not be uploaded.',
        'Remove',
        'Keep in Queue'
      );
      if (!confirmed) return;
      
      // Show immediate feedback
      this.logNotionProgress('Removing job from queue...', 'info');
      
      // Send remove request to background
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'removeFromQueue', jobId }, (resp) => {
          resolve(resp);
        });
      });
      
      if (response && response.ok) {
        // Update UI
        this.logNotionProgress(`✅ Job removed from queue successfully`, 'success');
        this.syncNotionUploadUiState();
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
      
    } catch (error) {
      console.error('Remove from queue error:', error);
      this.logNotionProgress(`❌ Failed to remove job: ${error.message}`, 'error');
    }
  }

  /**
   * Toggle queue details panel
   */
  toggleQueueDetails() {
    const panel = document.getElementById('queue-details-panel');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    } else {
      // Generate and show queue details
      this.showQueueDetails();
    }
  }

  /**
   * Show queue details panel
   */
  async showQueueDetails() {
    try {
      const list = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'listUploadJobs' }, (r) => resolve(r));
      });
      
      if (!list || !list.ok || !Array.isArray(list.jobs)) {
        this.logNotionProgress('Failed to load queue details', 'error');
        return;
      }
      
      const currentJob = list.jobs.find(j => j && j.status === 'running') || null;
      const queuedJobs = list.jobs.filter(j => j && j.status === 'queued');
      
      const queueStatus = {
        currentJob,
        queuedJobs,
        totalEstimatedTime: this.calculateTotalQueueTime(queuedJobs, currentJob)
      };
      
      const panelHtml = this.generateQueueDetailsPanel(queueStatus);
      
      // Add panel to banner
      const banner = document.getElementById('notion-upload-banner');
      if (banner) {
        banner.insertAdjacentHTML('beforeend', panelHtml);
        // Set up event listeners for the new buttons
        this.setupDynamicEventListeners();
      }
      
    } catch (error) {
      console.error('Show queue details error:', error);
      this.logNotionProgress(`Failed to show queue details: ${error.message}`, 'error');
    }
  }

  /**
   * Hide queue details panel
   */
  hideQueueDetails() {
    const panel = document.getElementById('queue-details-panel');
    if (panel) {
      panel.remove();
    }
  }

  /**
   * Refresh queue details panel if it's open
   */
  async refreshQueueDetails() {
    const panel = document.getElementById('queue-details-panel');
    if (panel) {
      // Hide current panel and show updated one
      this.hideQueueDetails();
      await this.showQueueDetails();
    }
  }

  /**
   * Set up event listeners for dynamically created buttons
   */
  setupDynamicEventListeners() {
    // Remove existing listeners to avoid duplicates
    document.removeEventListener('click', this.handleDynamicButtonClick);
    
    // Add new listener
    document.addEventListener('click', this.handleDynamicButtonClick.bind(this));
  }

  /**
   * Custom confirmation modal to replace window.confirm() which doesn't work in popup contexts
   */
  async showConfirmation(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmation-modal');
      const titleEl = document.getElementById('confirmation-title');
      const messageEl = document.getElementById('confirmation-message');
      const confirmBtn = document.getElementById('confirmation-confirm');
      const cancelBtn = document.getElementById('confirmation-cancel');
      const closeBtn = document.getElementById('confirmation-close');

      // Set content
      titleEl.textContent = title;
      messageEl.textContent = message;
      confirmBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      // Show modal
      modal.style.display = 'flex';

      // Handle confirm
      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };

      // Handle cancel
      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      // Cleanup function
      const cleanup = () => {
        modal.style.display = 'none';
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
      };

      // Handle backdrop click
      const handleBackdropClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      // Add event listeners
      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleBackdropClick);
    });
  }

  /**
   * Handle clicks on dynamically created buttons
   * @param {Event} event - Click event
   */
  handleDynamicButtonClick(event) {
    const target = event.target;
    
    if (target.classList.contains('cancel-job-btn')) {
      const jobId = target.getAttribute('data-job-id');
      if (jobId) {
        this.cancelSpecificJob(jobId);
      }
    } else if (target.classList.contains('remove-queue-btn')) {
      const jobId = target.getAttribute('data-job-id');
      if (jobId) {
        this.removeFromQueue(jobId);
      }
    } else if (target.classList.contains('toggle-queue-btn')) {
      this.toggleQueueDetails();
    } else if (target.classList.contains('hide-queue-btn')) {
      this.hideQueueDetails();
    }
  }

  /**
   * Generate queue details panel
   * @param {Object} queueStatus - Current queue status
   * @returns {string} Queue details panel HTML
   */
  generateQueueDetailsPanel(queueStatus) {
    const { currentJob, queuedJobs } = queueStatus;
    const allJobs = currentJob ? [currentJob, ...queuedJobs] : queuedJobs;
    
    let panelHtml = `
      <div id="queue-details-panel" style="margin-top: 12px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; background: #f9f9f9;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="margin: 0; font-size: 1.1em;">📋 Upload Queue (${allJobs.length} jobs)</h4>
          <button class="hide-queue-btn" 
                  style="background: none; border: none; font-size: 1.2em; cursor: pointer; color: #666;">✕</button>
        </div>
    `;
    
    allJobs.forEach((job, index) => {
      const jobDetails = this.getJobDetails(job);
      const isRunning = job.status === 'running';
      const isQueued = job.status === 'queued';
      const jobId = job.id;
      
      panelHtml += `
        <div class="queue-job-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin: 4px 0; background: white; border-radius: 4px; border-left: 4px solid ${isRunning ? '#f39c12' : '#3498db'};">
          <div style="flex: 1;">
            <div style="font-weight: bold; font-size: 0.9em;">
              ${isRunning ? '🔄' : '⏳'} ${jobDetails.mainSchool} vs ${jobDetails.baselineSchool}
            </div>
            <div style="font-size: 0.8em; color: #666; margin-top: 2px;">
              ${isRunning ? `${jobDetails.percent}% complete • ${this.getOperationDisplayText(jobDetails.operation)}` : `Queued #${index + 1}`}
            </div>
            ${isRunning && jobDetails.filesProcessed > 0 ? `
              <div style="font-size: 0.75em; color: #888; margin-top: 2px;">
                📄 ${jobDetails.filesProcessed}/${jobDetails.totalFiles} files
              </div>
            ` : ''}
          </div>
          <div style="display: flex; gap: 4px;">
            ${isRunning ? `
              <button class="btn btn-danger btn-sm cancel-job-btn" data-job-id="${jobId}" 
                      style="font-size: 0.7em; padding: 2px 6px;">
                🛑 Cancel
              </button>
            ` : `
              <button class="btn btn-warning btn-sm remove-queue-btn" data-job-id="${jobId}" 
                      style="font-size: 0.7em; padding: 2px 6px;">
                ❌ Remove
              </button>
            `}
          </div>
        </div>
      `;
    });
    
    panelHtml += `</div>`;
    return panelHtml;
  }

  // Zip Download Functionality
  async downloadAllAsZip() {
    this.logProgress('Attempting to create ZIP file...', 'info');
    
    if (!window.JSZip) {
      console.error('JSZip not available:', typeof window.JSZip);
      this.logProgress('✗ JSZip library not loaded', 'error');
      alert('JSZip library not loaded. Please reload the extension and try again.');
      return;
    }

    if (Object.keys(this.tempData).length === 0) {
      alert('No report data available. Please generate a report first.');
      return;
    }

    try {
      const zip = new JSZip();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      
      // Ensure side-effect comparison reports are generated (fills tempData)
      try {
        this.generateComparisonReport();
      } catch (error) {
        console.warn('Side-effect report generation failed before ZIP', error);
      }

      // Count non-integration files for accurate logging
      const coreDataFiles = Object.keys(this.tempData).filter(key => !this.isIntegrationFile(key));
      this.logProgress(`Creating ZIP with ${coreDataFiles.length} core data files...`, 'info');
      
      // Add individual JSON files (exclude integration files since they're in CAC_Report.md)
      Object.keys(this.tempData).forEach(key => {
        // Skip integration-related files since they're consolidated in CAC_Report.md
        if (this.isIntegrationFile(key)) {
          return;
        }
        
        const content = JSON.stringify(this.tempData[key], null, 2);
        zip.file(`${key}.json`, content);
        this.logProgress(`Added ${key}.json to ZIP`, 'info');
      });

      // Removed Configuration_Comparison_Report from ZIP

      // Add CAC Report if available
      if (this.tempData['CAC_Report']) {
        zip.file('CAC_Report.md', this.tempData['CAC_Report']);
        this.logProgress('Added CAC Report to ZIP', 'info');
      }

      // Add new comparison reports
      // Add comparison reports (filtered by checkbox states)
      const curriculumEnabled = document.getElementById('curriculum-checkbox').checked;
      const schedulingEnabled = document.getElementById('scheduling-checkbox').checked;
      
      this.comparisonReportKeys.forEach(reportKey => {
        if (this.tempData[reportKey]) {
          // Filter reports based on checkbox states
          let shouldInclude = true;
          
          if (reportKey === 'courseTemplate_Comparison_Report' || reportKey === 'programTemplate_Comparison_Report') {
            shouldInclude = curriculumEnabled;
          } else if (reportKey === 'sectionTemplate_Comparison_Report') {
            shouldInclude = schedulingEnabled;
          }
          
          if (shouldInclude) {
            zip.file(`${reportKey}.md`, this.tempData[reportKey]);
            this.logProgress(`Added ${reportKey} to ZIP`, 'info');
          }
        }
      });
      
      // Add snapshot files if available (JSON only, skip markdown)
      Object.keys(this.tempData).forEach(key => {
        if (key.includes('snapshot_') && key.includes('_json')) {
          const filename = key.replace('snapshot_', '').replace('_json', '_snapshot.json');
          zip.file(filename, this.tempData[key]);
          this.logProgress(`Added ${filename} to ZIP`, 'info');
        }
      });

      // Add debug log file
      const debugLog = this.generateDebugLogFile();
      zip.file('API_Debug_Log.md', debugLog);
      this.logProgress('Added debug log to ZIP', 'info');

      // Add Notion debug log if available
      if (this.notionClient && this.notionClient.getLogs && this.notionClient.getLogs().length > 0) {
        const notionDebugLog = this.generateNotionDebugLog();
        zip.file('Notion_API_Debug_Log.md', notionDebugLog);
        this.logProgress('Added Notion debug log to ZIP', 'info');
      }

      // Generate and download zip
      this.logProgress('Generating ZIP file...', 'info');
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      
      const url = URL.createObjectURL(blob);
      const filename = `Coursedog_Report_${this.mainSchool}_vs_${this.baselineSchool}_${timestamp}.zip`;
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Track this URL for proper cleanup
      this.activeDownloadUrls.add(url);
      this.logProgress(`✓ Downloaded ZIP file: ${filename}`, 'success');
      
    } catch (error) {
      console.error('Failed to create ZIP:', error);
      this.logProgress(`✗ ZIP creation failed: ${error.message}`, 'error');
      alert(`Failed to create ZIP file: ${error.message}\n\nPlease try downloading individual files instead.`);
    }
  }

  async handleReset() {
    // Disable reset button to prevent double-clicks
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.disabled = true;
      resetBtn.textContent = 'Resetting...';
    }
    
    try {
      // Clear progress logs and feedback messages immediately
      const notionLog = document.getElementById('notion-progress-log');
      if (notionLog) notionLog.innerHTML = '';
      const progressLog = document.getElementById('progress-log');
      if (progressLog) progressLog.innerHTML = '';
      const feedback = document.getElementById('notion-top-level-url-feedback');
      if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; }
      
      // ✅ AWAIT the session clear to prevent race condition
      await this.clearSessionData();
      
      // Small delay to ensure storage clear completes
      await this.delay(100);
      
    } catch (error) {
      console.error('Error during reset:', error);
    }
    
    // Now safe to reload
    window.location.reload();
  }

  // Load Report (ZIP) -> Open in Viewer
  async handleLoadZip(event) {
    try {
      const input = event.target;
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      // Reset input so the same file can be chosen again later
      input.value = '';

      if (!window.JSZip) {
        alert('JSZip library not available.');
        return;
      }

      this.logProgress(`Loading ZIP: ${file.name}`, 'info');
      const arrayBuf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuf);

      // Collect markdown files
      const mdFiles = [];
      zip.forEach((path, entry) => {
        if (!entry.dir && path.toLowerCase().endsWith('.md')) {
          mdFiles.push(entry);
        }
      });

      if (mdFiles.length === 0) {
        alert('No markdown (.md) files found in the ZIP.');
        return;
      }

      // Read all MD files
      const reports = {};
      for (const entry of mdFiles) {
        try {
          const content = await entry.async('string');
          const key = this.deriveReportKeyFromPath(entry.name);
          reports[key] = content;
        } catch (e) {
          console.warn('Failed reading', entry.name, e);
        }
      }

      // Build index and meta
      const index = this.buildReportIndexFromKeys(Object.keys(reports));
      const meta = this.inferMetaFromReports(reports);

      const sessionId = 'zip_' + Date.now();
      const payload = { meta, index, reports };
      await chrome.storage.local.set({ [sessionId]: payload });
      const url = chrome.runtime.getURL(`report-viewer.html?session=${sessionId}`);
      if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url }); else window.open(url, '_blank');

      this.logProgress(`✓ Loaded ${mdFiles.length} markdown files from ZIP`, 'success');
    } catch (err) {
      console.error('Load ZIP error:', err);
      alert('Failed to load ZIP: ' + (err?.message || err));
    }
  }

  deriveReportKeyFromPath(path) {
    const file = path.split('/').pop();
    return file.replace(/\.md$/i, '');
  }

  buildReportIndexFromKeys(keys) {
    const titleMap = {
      'CAC_Report': '📋 CAC Report',
      'stepsToExecute_Comparison_Report': '🔄 Steps to Execute Comparison',
      'fieldExceptions_Comparison_Report': '⚠️ Field Exceptions Comparison',
      'courseTemplate_Comparison_Report': '📚 Course Template Comparison',
      'programTemplate_Comparison_Report': '🎓 Program Template Comparison',
      'sectionTemplate_Comparison_Report': '📅 Section Template Comparison',
      'AttributeMapping_Comparison_Report': '🗺️ Attribute Mapping Comparison',
      'IntegrationFilters_Comparison_Report': '🔍 Integration Filters Comparison'
    };
    return keys.map(k => ({ key: k, title: titleMap[k] || k, type: 'markdown' }));
  }

  inferMetaFromReports(reports) {
    try {
      const first = Object.values(reports)[0] || '';
      const mainMatch = first.match(/\*\*Main School:\*\*\s*(.*)/i);
      const baseMatch = first.match(/\*\*Baseline School:\*\*\s*(.*)/i);
      const genMatch = first.match(/\*\*Generated:\*\*\s*(.*)/i);
      return {
        mainSchool: mainMatch ? mainMatch[1].trim() : 'Unknown',
        baselineSchool: baseMatch ? baseMatch[1].trim() : 'Unknown',
        createdAt: genMatch ? new Date(genMatch[1]).toISOString() : new Date().toISOString()
      };
    } catch {
      return { mainSchool: 'Unknown', baselineSchool: 'Unknown', createdAt: new Date().toISOString() };
    }
  }


  /**
   * Generate snapshot data by making all 24 API requests
   */
  async generateSnapshot(schoolId, existingMergeSettings = null) {
    console.log('generateSnapshot called with schoolId:', schoolId);
    const snapshotData = {
      codeAsConfig: {},
      notifications: {},
      formsAndWorkflows: {},
      templates: {},
      integration: {}
    };
    
    const requestStatus = { successful: 0, total: 0, errors: [] };
    
    try {
      // Use existing merge settings if provided, otherwise fetch them
      let mergeSettings;
      if (existingMergeSettings) {
        console.log('Using existing merge settings:', existingMergeSettings);
        console.log('Existing merge settings type:', typeof existingMergeSettings);
        console.log('Existing merge settings keys:', Object.keys(existingMergeSettings || {}));
        mergeSettings = existingMergeSettings;
      } else {
        this.logProgress('Fetching merge settings to determine enabled entity types...', 'info');
        console.log('Making API call for merge settings...');
        mergeSettings = await this.makeApiCall(`/api/v1/${schoolId}/integration/mergeSettings`);
        console.log('Merge settings received:', mergeSettings);
        requestStatus.total++;
        requestStatus.successful++;
      }
      
      // Extract enabled entity types from merge settings
      const enabledEntityTypes = [];
      if (mergeSettings) {
        Object.keys(mergeSettings).forEach(entityType => {
          if (mergeSettings[entityType] && mergeSettings[entityType].enabled) {
            enabledEntityTypes.push(entityType);
          }
        });
      }
      
      this.logProgress(`Found enabled entity types: ${enabledEntityTypes.join(', ')}`, 'info');
      
      // 1. Integration Configuration Requests
      this.logProgress('Fetching integration configuration...', 'info');
      
      try {
        snapshotData.codeAsConfig.configuration = await this.makeApiCall(`/api/v1/${schoolId}/integration/configuration`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.codeAsConfig.configuration = { error: error.message, status: 'not_configured' };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'configuration', message: error.message });
      }
      
      try {
        snapshotData.codeAsConfig.settings = await this.makeApiCall(`/api/v1/admin/schools/${schoolId}/integration/settings/`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.codeAsConfig.settings = { error: error.message, status: 'not_configured' };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'settings', message: error.message });
      }
      
      try {
        snapshotData.codeAsConfig.formattersGet = await this.makeApiCall(`/api/v1/admin/schools/${schoolId}/integration/formatters/`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        if (this.isExpectedFormatter404(`/api/v1/admin/schools/${schoolId}/integration/formatters/`, error)) {
          this.logProgress(`ℹ formatters (GET) not configured for ${schoolId} (expected for many schools)`, 'info');
          snapshotData.codeAsConfig.formattersGet = { status: 'not_configured', error: '404 Not Found (expected)' };
        } else {
          snapshotData.codeAsConfig.formattersGet = { error: error.message, status: 'not_configured' };
          requestStatus.errors.push({ endpoint: 'formattersGet', message: error.message });
        }
        requestStatus.total++;
      }
      
      try {
        snapshotData.codeAsConfig.formattersPost = await this.makeApiCall(`/api/v1/admin/schools/${schoolId}/integration/formatters/post`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        if (this.isExpectedFormatter404(`/api/v1/admin/schools/${schoolId}/integration/formatters/post`, error)) {
          this.logProgress(`ℹ formatters (POST) not configured for ${schoolId} (expected for many schools)`, 'info');
          snapshotData.codeAsConfig.formattersPost = { status: 'not_configured', error: '404 Not Found (expected)' };
        } else {
          snapshotData.codeAsConfig.formattersPost = { error: error.message, status: 'not_configured' };
          requestStatus.errors.push({ endpoint: 'formattersPost', message: error.message });
        }
        requestStatus.total++;
      }
      
      try {
        snapshotData.codeAsConfig.schedule = await this.makeApiCall(`/api/v1/${schoolId}/general/integrationSchedule`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.codeAsConfig.schedule = { error: error.message, status: 'not_configured' };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'schedule', message: error.message });
      }
      
      // Field mappings for enabled entity types only
      snapshotData.codeAsConfig.fieldMappingsGet = {};
      snapshotData.codeAsConfig.fieldMappingsPost = {};
      snapshotData.codeAsConfig.customFieldMappingsGet = {};
      
      for (const entityType of enabledEntityTypes) {
        try {
          snapshotData.codeAsConfig.fieldMappingsGet[entityType] = await this.makeApiCall(`/api/v1/admin/schools/${schoolId}/integration/field-mappings/${entityType}`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.codeAsConfig.fieldMappingsGet[entityType] = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: `field-mappings/${entityType}`, message: error.message });
        }
        
        try {
          snapshotData.codeAsConfig.fieldMappingsPost[entityType] = await this.makeApiCall(`/api/v1/admin/schools/${schoolId}/integration/field-mappings/post/${entityType}`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.codeAsConfig.fieldMappingsPost[entityType] = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: `field-mappings/post/${entityType}`, message: error.message });
        }
        
        try {
          snapshotData.codeAsConfig.customFieldMappingsGet[entityType] = await this.makeApiCall(`/api/v1/admin/schools/${schoolId}/integration/field-mappings/${entityType}/custom-fields`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.codeAsConfig.customFieldMappingsGet[entityType] = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: `field-mappings/${entityType}/custom-fields`, message: error.message });
        }
      }
      
      // 2. Notification Settings Requests
      this.logProgress('Fetching notification settings...', 'info');
      
      try {
        snapshotData.notifications.scheduling = await this.makeApiCall('/api/v1/all_done/notifications_settings/sm');
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.notifications.scheduling = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'notifications/scheduling', message: error.message });
      }
      
      try {
        snapshotData.notifications.catalog = await this.makeApiCall('/api/v1/all_done/notifications_settings/ca');
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.notifications.catalog = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'notifications/catalog', message: error.message });
      }
      
      try {
        snapshotData.notifications.curriculum = await this.makeApiCall('/api/v1/all_done/notifications_settings/cm');
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.notifications.curriculum = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'notifications/curriculum', message: error.message });
      }
      
      try {
        snapshotData.notifications.events = await this.makeApiCall('/api/v1/all_done/notifications_settings/em');
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.notifications.events = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'notifications/events', message: error.message });
      }
      
      // 3. Forms and Workflows Requests
      this.logProgress('Fetching forms and workflows...', 'info');
      
      try {
        snapshotData.formsAndWorkflows.forms = await this.makeApiCall(`/api/v1/${schoolId}/formsv2?formType=cm`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.formsAndWorkflows.forms = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'forms', message: error.message });
      }
      
      try {
        snapshotData.formsAndWorkflows.workflows = await this.makeApiCall(`/api/v1/${schoolId}/general/approvalWorkflows`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.formsAndWorkflows.workflows = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'workflows', message: error.message });
      }
      
      // 4. Template Requests
      this.logProgress('Fetching templates...', 'info');
      
      // Reuse existing template data if available to avoid duplicate API calls
      const schoolPrefix = schoolId === this.mainSchool ? 'MainSchool' : 'BaselineSchool';
      
      // Room template (not in main reports, so fetch it)
      try {
        snapshotData.templates.room = await this.makeApiCall(`/api/v1/${schoolId}/general/roomTemplate`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.templates.room = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'roomTemplate', message: error.message });
      }
      
      // Section template (reuse from main reports)
      if (this.tempData[`${schoolPrefix}_sectionTemplate`]) {
        console.log('Reusing existing sectionTemplate data');
        snapshotData.templates.section = this.tempData[`${schoolPrefix}_sectionTemplate`];
        requestStatus.total++;
        requestStatus.successful++;
      } else {
        try {
          snapshotData.templates.section = await this.makeApiCall(`/api/v2/${schoolId}/general/sectionTemplate`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.templates.section = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: 'sectionTemplate', message: error.message });
        }
      }
      
      // Instructor template (not in main reports, so fetch it)
      try {
        snapshotData.templates.instructor = await this.makeApiCall(`/api/v1/${schoolId}/general/instructorTemplate`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.templates.instructor = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'instructorTemplate', message: error.message });
      }
      
      // Course template (reuse from main reports)
      if (this.tempData[`${schoolPrefix}_courseTemplate`]) {
        console.log('Reusing existing courseTemplate data');
        snapshotData.templates.course = this.tempData[`${schoolPrefix}_courseTemplate`];
        requestStatus.total++;
        requestStatus.successful++;
      } else {
        try {
          snapshotData.templates.course = await this.makeApiCall(`/api/v1/${schoolId}/general/courseTemplate`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.templates.course = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: 'courseTemplate', message: error.message });
        }
      }
      
      // Program template (reuse from main reports)
      if (this.tempData[`${schoolPrefix}_programTemplate`]) {
        console.log('Reusing existing programTemplate data');
        snapshotData.templates.program = this.tempData[`${schoolPrefix}_programTemplate`];
        requestStatus.total++;
        requestStatus.successful++;
      } else {
        try {
          snapshotData.templates.program = await this.makeApiCall(`/api/v1/${schoolId}/general/programTemplate`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.templates.program = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: 'programTemplate', message: error.message });
        }
      }
      
      // Term template (not in main reports, so fetch it)
      try {
        snapshotData.templates.term = await this.makeApiCall(`/api/v1/${schoolId}/general/termTemplate`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.templates.term = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'termTemplate', message: error.message });
      }
      
      // 5. Integration State and Settings Requests
      this.logProgress('Fetching integration state and settings...', 'info');
      
      // Reuse existing integration save state data if available
      if (this.tempData[`${schoolPrefix}_integrationSaveState`]) {
        console.log('Reusing existing integrationSaveState data');
        snapshotData.integration.enabledSavedState = this.tempData[`${schoolPrefix}_integrationSaveState`];
        requestStatus.total++;
        requestStatus.successful++;
      } else {
        try {
          snapshotData.integration.enabledSavedState = await this.makeApiCall(`/api/v1/${schoolId}/general/enabledIntegrationSaveState`);
          requestStatus.total++;
          requestStatus.successful++;
        } catch (error) {
          snapshotData.integration.enabledSavedState = { error: error.message };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: 'enabledIntegrationSaveState', message: error.message });
        }
      }
      
      // Use existing merge settings instead of making another API call
      if (existingMergeSettings) {
        console.log('Reusing existing merge settings for integration section');
        console.log('Integration section merge settings:', existingMergeSettings);
        snapshotData.integration.mergeSettings = existingMergeSettings;
        requestStatus.total++;
        requestStatus.successful++;
      } else {
        // Fallback: Get save state ID for merge settings
        const saveStateId = snapshotData.integration.enabledSavedState?.enabledIntegrationSaveState?.integrationSaveStateId;
        if (saveStateId) {
          try {
            snapshotData.integration.mergeSettings = await this.makeApiCall(`/api/v1/${schoolId}/integration/mergeSettings?integrationSaveStateId=${saveStateId}`);
            requestStatus.total++;
            requestStatus.successful++;
          } catch (error) {
            snapshotData.integration.mergeSettings = { error: error.message };
            requestStatus.total++;
            requestStatus.errors.push({ endpoint: 'mergeSettings', message: error.message });
          }
        } else {
          snapshotData.integration.mergeSettings = { error: 'No integration save state ID found' };
          requestStatus.total++;
          requestStatus.errors.push({ endpoint: 'mergeSettings', message: 'No integration save state ID found' });
        }
      }
      
      try {
        snapshotData.integration.attrMappings = await this.makeApiCall('/api/v1/all_done/integration/attributeMappings?returnArray=true');
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.integration.attrMappings = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'attrMappings', message: error.message });
      }
      
      try {
        snapshotData.integration.filters = await this.makeApiCall(`/api/v1/${schoolId}/general/filters`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.integration.filters = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'filters', message: error.message });
      }
      
      try {
        snapshotData.integration.rules = await this.makeApiCall(`/api/v1/${schoolId}/rules`);
        requestStatus.total++;
        requestStatus.successful++;
      } catch (error) {
        snapshotData.integration.rules = { error: error.message };
        requestStatus.total++;
        requestStatus.errors.push({ endpoint: 'rules', message: error.message });
      }
      
      this.logProgress(`Snapshot generation completed: ${requestStatus.successful}/${requestStatus.total} requests successful`, 'success');
      
      // Store snapshot data and request status
      this.tempData[`snapshot_${schoolId}`] = snapshotData;
      this.tempData[`snapshot_${schoolId}_status`] = requestStatus;
      
      console.log('Snapshot data stored in tempData:', this.tempData[`snapshot_${schoolId}`]);
      console.log('Snapshot status stored:', this.tempData[`snapshot_${schoolId}_status`]);
      
      return snapshotData;
      
    } catch (error) {
      console.error('Snapshot generation error:', error);
      requestStatus.errors.push({ endpoint: 'general', message: error.message });
      throw error;
    }
  }

  /**
   * Generate downloadable files for snapshot
   */
  generateSnapshotDownloads(snapshotData, schoolId) {
    console.log('generateSnapshotDownloads called with schoolId:', schoolId);
    console.log('snapshotData received:', snapshotData);
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    
    // Generate JSON output
    const jsonContent = JSON.stringify(snapshotData, null, 2);
    const jsonFilename = `snapshot_${schoolId}_${timestamp}.json`;
    this.tempData[`snapshot_${schoolId}_json`] = jsonContent;
    console.log('JSON content stored:', jsonFilename);
    
    // Generate Markdown report
    const markdownContent = this.generateSnapshotMarkdownReport(snapshotData, schoolId);
    const markdownFilename = `snapshot_${schoolId}_${timestamp}.md`;
    this.tempData[`snapshot_${schoolId}_markdown`] = markdownContent;
    console.log('Markdown content stored:', markdownFilename);
    
    // Add to download links
    const downloadContainer = document.getElementById('download-links');
    
    // Add JSON download
    const jsonLink = this.createDownloadLink(jsonFilename, jsonContent, 'application/json');
    downloadContainer.appendChild(jsonLink);
    
    // Add Markdown download
    const markdownLink = this.createDownloadLink(markdownFilename, markdownContent, 'text/markdown');
    downloadContainer.appendChild(markdownLink);
    
    this.logProgress(`Generated snapshot files: ${jsonFilename}, ${markdownFilename}`, 'success');
  }

  /**
   * Generate Markdown report for snapshot
   */
  generateSnapshotMarkdownReport(data, schoolId) {
    const timestamp = new Date().toISOString();
    const config = data.codeAsConfig.configuration;
    const settings = data.codeAsConfig.settings;
    const requestStatus = this.tempData[`snapshot_${schoolId}_status`] || { successful: 0, total: 24, errors: [] };
    
    let report = `# Coursedog Integration Snapshot Report\n\n`;
    report += `**School ID:** ${schoolId}\n`;
    report += `**Generated:** ${timestamp}\n`;
    // Snapshot is only for main school, so use mainSchoolEnvironment
    const envInfo = this.environments[this.mainSchoolEnvironment];
    const envBaseUrl = envInfo ? envInfo.baseUrl : 'Unknown';
    report += `**Environment:** ${envInfo.icon} ${envInfo.name} (${envBaseUrl})\n\n`;
    
    report += `## 📋 Executive Summary\n`;
    report += `- **Integration Platform:** ${config?.sisPlatform || 'Not Available'}\n`;
    report += `- **Integration Broker:** ${config?.integrationBroker || 'Not Available'}\n`;
    report += `- **Enabled Save State ID:** ${data.integration.enabledSavedState?.enabledIntegrationSaveState?.integrationSaveStateId || 'Not Available'}\n`;
    report += `- **Total API Requests:** 24\n`;
    report += `- **Request Status:** ${requestStatus.successful}/${requestStatus.total} successful\n\n`;
    
    report += `## 🔧 Integration Configuration\n`;
    report += `### SIS Platform Details\n`;
    report += `- **Platform:** ${config?.sisPlatform || 'Not Available'}\n`;
    report += `- **Broker:** ${config?.integrationBroker || 'Not Available'}\n`;
    report += `- **API Key Status:** ${settings?.apiKey ? 'Configured' : 'Not Configured'}\n\n`;
    
    report += `### Supported Entity Types\n`;
    report += `#### GET Operations\n`;
    if (config?.getTypes) {
      Object.entries(config.getTypes).forEach(([type, enabled]) => {
        report += `- **${type}:** ${enabled ? 'Enabled' : 'Disabled'}\n`;
      });
    } else {
      report += `- No GET operations configured\n`;
    }
    report += `\n#### POST Operations\n`;
    if (config?.postTypes) {
      Object.entries(config.postTypes).forEach(([type, enabled]) => {
        report += `- **${type}:** ${enabled ? 'Enabled' : 'Disabled'}\n`;
      });
    } else {
      report += `- No POST operations configured\n`;
    }
    report += `\n`;
    
    report += `## 📊 Merge Settings Summary\n`;
    report += `### Entity Sync Configuration\n`;
    if (data.integration.mergeSettings && !data.integration.mergeSettings.error) {
      Object.entries(data.integration.mergeSettings).forEach(([entityType, settings]) => {
        if (settings && typeof settings === 'object') {
          report += `- **${entityType}:**\n`;
          report += `  - Sync to Coursedog: ${settings.syncCoursedogData ? 'Yes' : 'No'}\n`;
          report += `  - Sync to SIS: ${settings.syncSisData ? 'Yes' : 'No'}\n`;
          report += `  - Conflict Handling: ${settings.conflictHandlingMethod || 'Not Set'}\n`;
          report += `  - Status: ${settings.enabled ? 'Enabled' : 'Disabled'}\n`;
        }
      });
    } else {
      report += `- Merge settings not available: ${data.integration.mergeSettings?.error || 'Unknown error'}\n`;
    }
    report += `\n`;
    
    report += `## 🔔 Notification Settings\n`;
    report += `### Module Status\n`;
    report += `- **Scheduling (SM):** ${data.notifications.scheduling?.totalCount || 0} notifications\n`;
    report += `- **Catalog (CA):** ${data.notifications.catalog?.totalCount || 0} notifications\n`;
    report += `- **Curriculum (CM):** ${data.notifications.curriculum?.totalCount || 0} notifications\n`;
    report += `- **Events (EM):** ${data.notifications.events?.totalCount || 0} notifications\n\n`;
    
    report += `## 📝 Forms & Workflows\n`;
    report += `- **Available Forms:** ${data.formsAndWorkflows.forms?.totalCount || 0}\n`;
    report += `- **Approval Workflows:** ${data.formsAndWorkflows.workflows?.approvalWorkflows ? Object.keys(data.formsAndWorkflows.workflows.approvalWorkflows).length : 0}\n\n`;
    
    report += `## 🏗️ Templates Configuration\n`;
    report += `- **Room Template:** ${data.templates.room ? 'Configured' : 'Not Configured'}\n`;
    report += `- **Section Template:** ${data.templates.section ? 'Configured' : 'Not Configured'}\n`;
    report += `- **Instructor Template:** ${data.templates.instructor ? 'Configured' : 'Not Configured'}\n`;
    report += `- **Course Template:** ${data.templates.course ? 'Configured' : 'Not Configured'}\n`;
    report += `- **Term Template:** ${data.templates.term ? 'Configured' : 'Not Configured'}\n\n`;
    
    report += `## ⚙️ Integration Rules & Filters\n`;
    report += `- **Active Rules:** ${data.integration.rules ? Object.keys(data.integration.rules).length : 0}\n`;
    report += `- **Configured Filters:** ${data.integration.filters?.filters ? Object.keys(data.integration.filters.filters).length : 0}\n`;
    report += `- **Attribute Mappings:** ${Array.isArray(data.integration.attrMappings) ? data.integration.attrMappings.length : 0}\n\n`;
    
    if (requestStatus.errors.length > 0) {
      report += `## ❌ Errors & Warnings\n`;
      requestStatus.errors.forEach(error => {
        report += `- **${error.endpoint}:** ${error.message}\n`;
      });
      report += `\n`;
    }
    
    report += `---\n`;
    report += `*Report generated by Coursedog Snapshot Tool*\n`;
    
    return report;
  }

  // Notion Integration Methods
  
  /**
   * Show Notion upload confirmation with time estimate
   */
  async showNotionUploadConfirmation() {
    try {
      // Calculate time estimate
      const timeEstimate = this.notionUploader.calculateUploadTimeEstimate(
        this.tempData, 
        this.mainSchool, 
        this.baselineSchool
      );
      
      // Create confirmation message
      let message = `This will upload your reports to Notion.\n\n`;
      message += `📊 Upload Details:\n`;
      message += `• Estimated time (conservative): ${timeEstimate.estimatedTimeFormatted}\n`;
      message += `• Total API calls: ${timeEstimate.totalApiCalls}\n`;
      message += `• Total batches: ${timeEstimate.totalBatches}\n`;
      message += `• Total blocks: ${timeEstimate.totalBlocks}\n\n`;
      
      if (document.getElementById('info-for-nerds-checkbox').checked) {
        message += `📋 Detailed Breakdown:\n`;
        timeEstimate.details.forEach(detail => {
          message += `• ${detail}\n`;
        });
        message += `\n`;
      }
      
      message += `⏱️ Rate Limiting:\n`;
      message += `• 3 requests per second\n`;
      message += `• 350ms delay between batches\n`;
      message += `• Exponential backoff for rate limits\n\n`;
      
      message += `Do you want to proceed with the upload?`;
      
      // Show confirmation dialog
      const confirmed = await this.showConfirmation(
        'Upload to Notion',
        message,
        'Upload to Notion',
        'Cancel'
      );
      
      if (confirmed) {
        await this.handleNotionUpload();
      }
      
    } catch (error) {
      console.error('Error calculating time estimate:', error);
      // Fallback to simple confirmation
      const confirmed = await this.showConfirmation(
        'Upload to Notion',
        'This will upload your reports to Notion. Do you want to proceed?',
        'Upload to Notion',
        'Cancel'
      );
      if (confirmed) {
        await this.handleNotionUpload();
      }
    }
  }
  
  /**
   * Handle Notion upload process
   */
  async handleNotionUpload() {
    try {
      // ✅ Check queue status first
      const queueStatus = await this.getUploadQueueStatus();
      
      if (queueStatus.queueLength > 0) {
        const queuePosition = queueStatus.queueLength + 1;
        const estimatedWaitMinutes = queueStatus.queueLength * 25; // ~25 min per upload
        
        const confirmQueue = await this.showConfirmation(
          'Upload Queue',
          `📤 Upload Queue Status\n\n` +
          `• Currently ${queueStatus.queueLength} upload(s) in progress/queued\n` +
          `• Your upload will be queued at position ${queuePosition}\n` +
          `• Estimated wait time: ~${estimatedWaitMinutes} minutes\n` +
          `• You can continue using the extension while uploads process\n\n` +
          `Continue and add to queue?`,
          'Add to Queue',
          'Cancel'
        );
        
        if (!confirmQueue) {
          return; // User cancelled
        }
      }
      
      // Ensure a Notion page id exists: if not stored yet, lazily parse from current input
      let stored = await chrome.storage.local.get(['notionTopLevelPageId']);
      if (!stored?.notionTopLevelPageId) {
        const urlInput = document.getElementById('notion-top-level-url');
        const raw = (urlInput?.value || '').trim();
        const sanitized = this.sanitizeDefaultNotionUrl(raw);
        if (sanitized) {
          try {
            await this.handleSetNotionUrl(sanitized);
            stored = await chrome.storage.local.get(['notionTopLevelPageId']);
          } catch (_) {
            // handleSetNotionUrl already shows feedback; proceed will fail later if still missing
          }
        }
      }

      // ✅ Create immutable snapshot of current tempData
      this.logNotionProgress('Creating data snapshot for upload...', 'info');
      const dataSnapshot = this.createDataSnapshot(this.tempData);
      const snapshotSize = JSON.stringify(dataSnapshot).length;
      this.logNotionProgress(`Snapshot created: ${(snapshotSize / 1024 / 1024).toFixed(2)} MB`, 'info');

      // Calculate time estimate using the snapshot
      this.logNotionProgress('Calculating upload time estimate...', 'info');
      const timeEstimate = this.notionUploader.calculateUploadTimeEstimate(
        dataSnapshot, 
        this.mainSchool, 
        this.baselineSchool
      );
      
      // Store time estimate for progress tracking
      this.notionUploadStartTime = Date.now();
      this.notionUploadTimeEstimate = timeEstimate;
      
      // Show estimate to user
      this.logNotionProgress(`Estimated upload time (conservative): ${timeEstimate.estimatedTimeFormatted}`, 'info');
      this.logNotionProgress(`Total API calls: ${timeEstimate.totalApiCalls}, Batches: ${timeEstimate.totalBatches}, Blocks: ${timeEstimate.totalBlocks}`, 'info');
      
      // Show detailed breakdown for nerds
      if (document.getElementById('info-for-nerds-checkbox').checked) {
        this.logNotionProgress('Upload breakdown:', 'info');
        timeEstimate.details.forEach(detail => {
          this.logNotionProgress(`  • ${detail}`, 'info');
        });
      }
      
      // Show progress and hide other states
      this.showNotionProgress();
      this.hideNotionError();
      this.hideNotionResult();
      
      // Disable button during upload
      const btn = document.getElementById('send-to-notion-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="notion-icon">⏳</span> Uploading...';
      
      // Initialize progress tracking
      this.logNotionProgress('Starting Notion upload process...', 'info');
      this.updateNotionProgress(0, 100, 'Initializing upload...');
      
      // ✅ Create unique job ID with timestamp and random suffix
      const jobId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // ✅ Store snapshot with unique keys
      const payloadKey = `notionUpload:${jobId}:payload`;
      const secretKey = `notionUpload:${jobId}:secret`;
      
      await chrome.storage.local.set({ 
        [payloadKey]: { 
          tempData: dataSnapshot,  // ✅ Immutable snapshot
          mainSchool: this.mainSchool,
          baselineSchool: this.baselineSchool,
          timestamp: Date.now()
        }
      });
      
      await chrome.storage.local.set({ 
        [secretKey]: this.notionConfig.secret 
      });
      
      // ✅ Store metadata about the snapshot for cleanup
      const snapshotMeta = await chrome.storage.local.get('notionSnapshots');
      const snapshots = snapshotMeta.notionSnapshots || {};
      snapshots[jobId] = {
        payloadKey,
        secretKey,
        createdAt: Date.now(),
        status: queueStatus.queueLength > 0 ? 'queued' : 'pending',
        size: snapshotSize,
        mainSchool: this.selectedMainSchool.name || this.mainSchool,
        baselineSchool: this.selectedBaselineSchool.name || this.baselineSchool,
        mainEnv: this.selectedMainSchool.environment || 'staging',
        baselineEnv: this.selectedBaselineSchool.environment || 'staging'
      };
      await chrome.storage.local.set({ notionSnapshots: snapshots });
      
      this.logNotionProgress('Snapshot stored successfully', 'info');

      stored = await chrome.storage.local.get(['notionTopLevelPageId']);
      const meta = { 
        mainSchool: this.selectedMainSchool.name || this.mainSchool, 
        baselineSchool: this.selectedBaselineSchool.name || this.baselineSchool, 
        mainEnv: this.selectedMainSchool.environment || 'staging',
        baselineEnv: this.selectedBaselineSchool.environment || 'staging',
        notionWorkspaceId: this.notionConfig.workspaceId, 
        notionTopLevelPageId: stored?.notionTopLevelPageId || null 
      };
      const payloadRef = { location: 'local', key: payloadKey };
      const secretRef = { location: 'local', key: secretKey };

      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'startNotionUpload', jobId, meta, payloadRef, secretRef }, (resp) => {
          resolve(resp);
        });
      });

      // Inform user that background upload started or queued
      if (queueStatus.queueLength > 0) {
        this.logNotionProgress(`Upload queued (position ${queueStatus.queueLength + 1}). Will start automatically when ready.`, 'success');
      } else {
        this.logNotionProgress('Notion upload started in background. You can close this window.', 'success');
      }
      this.updateNotionProgress(5, 100, 'Background upload initiated...');
      // Immediately reflect running state in UI (without requiring refresh)
      try { await this.syncNotionUploadUiState(); } catch (_) {}
      
    } catch (error) {
      console.error('Notion upload error:', error);
      
      // Log error details
      this.logNotionProgress(`Upload failed: ${error.message}`, 'error');
      
      // Provide more helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('413')) {
        errorMessage = 'Files are too large for Notion upload. Large files will be uploaded as placeholders with download instructions.';
      } else if (error.message.includes('401')) {
        errorMessage = 'Notion authentication failed. Please check your API key.';
      } else if (error.message.includes('404')) {
        errorMessage = 'Notion page not found. Please check your parent page ID.';
      }
      
      this.showNotionError(errorMessage);
      this.hideNotionProgress();
      
      // Re-enable button
      const btn = document.getElementById('send-to-notion-btn');
      btn.disabled = false;
      btn.innerHTML = '<span class="notion-icon">📝</span> Send to Notion';
    }
  }
  
  /**
   * Show Notion progress indicator
   */
  showNotionProgress() {
    document.getElementById('notion-progress').style.display = 'flex';
  }
  
  /**
   * Hide Notion progress indicator
   */
  hideNotionProgress() {
    document.getElementById('notion-progress').style.display = 'none';
  }
  
  /**
   * Update Notion progress text only (for simple message updates)
   */
  updateNotionProgressText(message) {
    document.getElementById('notion-progress-text').textContent = message;
  }
  
  /**
   * Show Notion success result
   */
  showNotionResult(notionUrl) {
    document.getElementById('notion-url').value = notionUrl;
    document.getElementById('notion-result').style.display = 'block';
  }
  
  /**
   * Hide Notion success result
   */
  hideNotionResult() {
    document.getElementById('notion-result').style.display = 'none';
  }
  
  /**
   * Show Notion error
   */
  showNotionError(message) {
    document.getElementById('notion-error-text').textContent = message;
    document.getElementById('notion-error').style.display = 'block';
  }
  
  /**
   * Hide Notion error
   */
  hideNotionError() {
    document.getElementById('notion-error').style.display = 'none';
  }
  
  /**
   * Copy Notion URL to clipboard
   */
  async copyNotionUrl() {
    const urlInput = document.getElementById('notion-url');
    try {
      await navigator.clipboard.writeText(urlInput.value);
      this.logProgress('Notion URL copied to clipboard!', 'success');
      
      // Show temporary feedback
      const copyBtn = document.getElementById('copy-notion-url');
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
      this.logProgress('Failed to copy URL to clipboard', 'error');
    }
  }
  
  /**
   * Open Notion URL in new tab
   */
  openNotionUrl() {
    const url = document.getElementById('notion-url').value;
    if (url) {
      window.open(url, '_blank');
      this.logProgress('Opening Notion page...', 'info');
    }
  }
  
  /**
   * Calculate time remaining based on current progress
   * @param {number} currentProgress - Current progress percentage (0-100)
   * @returns {string} Formatted time remaining string
   */
  calculateTimeRemaining(currentProgress) {
    if (!this.notionUploadStartTime || !this.notionUploadTimeEstimate || currentProgress <= 0) {
      return '';
    }
    
    const elapsedTime = Date.now() - this.notionUploadStartTime;
    const estimatedTotalTime = this.notionUploadTimeEstimate.estimatedTimeMs;
    
    // Calculate time remaining based on progress
    const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);
    
    // Format time remaining
    const seconds = Math.ceil(remainingTime / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    } else {
      return '';
    }
  }

  // ---- Notion URL parsing/verification ----
  parseNotionPageIdFromUrl(urlStr) {
    const input = String(urlStr || '').trim();
    if (!input) throw new Error('This URL does not contain a Notion page ID. Open the page in Notion and copy its URL.');
    if (!/^https?:\/\//i.test(input)) throw new Error('Invalid URL scheme');
    let url;
    try { url = new URL(input); } catch (_) { throw new Error('Invalid URL'); }
    if (!/^https?:$/i.test(url.protocol)) throw new Error('Invalid URL scheme');
    const path = (url.pathname || '');
    
    // 1) Prefer ID that appears between a '-' and a following '#' in the full URL string
    //    Example: ...-224f804589d181bbb5abe2b3c9c6c7c2#224f804589d181bbb5abe2b3c9c6c7c2
    //    We want the token right before the '#'
    let token = null;
    try {
      const hyphenHashRe = /-([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?=#)/g;
      let m;
      while ((m = hyphenHashRe.exec(input)) !== null) {
        token = m[1]; // keep last occurrence
      }
    } catch (_) {}
    
    // 2) Fall back to scanning the path for dashed UUID then compact 32-hex
    if (!token) {
      const dashedMatches = path.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9a-fA-F])/g);
      token = dashedMatches ? dashedMatches[dashedMatches.length - 1] : null;
    }
    if (!token) {
      const compactMatches = path.match(/[0-9a-fA-F]{32}(?![0-9a-fA-F])/g);
      token = compactMatches ? compactMatches[compactMatches.length - 1] : null;
    }
    if (!token) {
      throw new Error('This URL does not contain a Notion page ID. Open the page in Notion and copy its URL.');
    }
    const hex = token.replace(/-/g, '').toLowerCase();
    if (hex.length !== 32 || /[^0-9a-f]/.test(hex)) throw new Error('Malformed Notion page ID');
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    return id;
  }

  async handleSetNotionUrl(urlStr) {
    const feedback = document.getElementById('notion-top-level-url-feedback');
    if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; feedback.style.color = ''; }
    try {
      const id = this.parseNotionPageIdFromUrl(urlStr);
      // Optional verification
      try {
        const res = await this.notionClient.retrievePage(id);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Grant your Notion integration access to this page, then try again.');
          } else if (res.status === 404) {
            throw new Error('No page found for that ID or access is denied. Share the page with the integration and try again.');
          } else {
            throw new Error(`Verification failed (${res.status || 'network error'})`);
          }
        }
      } catch (verifyErr) {
        this.showToast(verifyErr.message || String(verifyErr), 'error');
        if (feedback) { feedback.style.display = 'block'; feedback.textContent = verifyErr.message || String(verifyErr); feedback.style.color = '#c0392b'; }
        return;
      }
      await chrome.storage.local.set({ notionTopLevelPageId: id });
      this.showToast('Top-level Notion page set.', 'success');
      if (feedback) { feedback.style.display = 'block'; feedback.textContent = 'Top-level Notion page set.'; feedback.style.color = '#2ecc71'; }
    } catch (e) {
      const message = e?.message || 'This URL does not contain a Notion page ID. Open the page in Notion and copy its URL.';
      this.showToast(message, 'error');
      if (feedback) { feedback.style.display = 'block'; feedback.textContent = message; feedback.style.color = '#c0392b'; }
    }
  }

  async handleVerifyNotionUrl() {
    const input = document.getElementById('notion-top-level-url');
    if (!input) return;
    await this.handleSetNotionUrl(input.value);
  }

  showToast(message, type = 'info') {
    try {
      const el = document.getElementById('notion-top-level-url-feedback');
      if (el) {
        el.style.display = 'block';
        el.textContent = message;
        el.style.color = type === 'success' ? '#2ecc71' : (type === 'error' ? '#c0392b' : '#34495e');
      }
    } catch (_) {}
  }

  sanitizeDefaultNotionUrl(urlStr) {
    if (!urlStr) return '';
    let s = String(urlStr).trim();
    // Strip leading '@' if present
    if (s.startsWith('@')) s = s.slice(1);
    return s.trim();
  }

  /**
   * Determines if an error is an expected 404 from formatter endpoints
   * These are normal for schools without formatter config
   */
  isExpectedFormatter404(endpoint, error) {
    try {
      const ep = String(endpoint || '');
      const msg = String(error && (error.message || error) || '');
      const isFormatterEndpoint = /\/integration\/formatters(\/post)?\/?$/i.test(ep);
      const is404 = /(^|\b)404(\b|:|\s)/.test(msg);
      return isFormatterEndpoint && is404;
    } catch (_) {
      return false;
    }
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  window.coursedogReporter = new CoursedogReporter();
  // Expose test function globally for debugging
  window.testChangeButtons = () => window.coursedogReporter.testChangeButtons();
  
  // Test immediately after DOM loads
  setTimeout(() => {
    console.log('🔥 DOM loaded, testing Change buttons...');
    window.testChangeButtons();
  }, 1000);
  
  // Test again after schools are loaded
  setTimeout(() => {
    console.log('🔥 After schools loaded, testing Change buttons...');
    window.testChangeButtons();
  }, 3000);
});

/**
 * Add download button for Notion Upload Report
 */
function addUploadReportDownloadButton() {
  // Check if notionUploader exists and has a report
  if (!window.notionUploader) {
    console.log('NotionUploader not available');
    return;
  }
  
  const report = window.notionUploader.getUploadReport();
  if (!report) {
    console.log('No upload report available for download');
    return;
  }

  // Find the result container (correct ID is 'notion-result')
  const resultContainer = document.getElementById('notion-result');
  if (!resultContainer) {
    console.error('Could not find notion result container');
    return;
  }

  // Check if download button already exists
  if (document.getElementById('downloadReportBtn')) {
    return; // Button already exists
  }

  // Create download button
  const downloadButton = document.createElement('button');
  downloadButton.id = 'downloadReportBtn';
  downloadButton.className = 'download-report-btn';
  downloadButton.innerHTML = '📊 Download Upload Report';
  downloadButton.style.cssText = `
    margin-top: 10px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.3s ease;
    display: block;
    width: 100%;
  `;

  // Add hover effects
  downloadButton.addEventListener('mouseenter', () => {
    downloadButton.style.transform = 'translateY(-2px)';
    downloadButton.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
  });

  downloadButton.addEventListener('mouseleave', () => {
    downloadButton.style.transform = 'translateY(0)';
    downloadButton.style.boxShadow = 'none';
  });

  // Add click handler
  downloadButton.addEventListener('click', () => {
    try {
      const success = window.notionUploader.downloadUploadReport();
      if (success) {
        // Show success feedback
        const originalText = downloadButton.innerHTML;
        downloadButton.innerHTML = '✅ Downloaded!';
        downloadButton.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
        
        setTimeout(() => {
          downloadButton.innerHTML = originalText;
          downloadButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }, 2000);
      } else {
        // Show error feedback
        const originalText = downloadButton.innerHTML;
        downloadButton.innerHTML = '❌ Download Failed';
        downloadButton.style.background = 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';
        
        setTimeout(() => {
          downloadButton.innerHTML = originalText;
          downloadButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }, 2000);
      }
    } catch (error) {
      console.error('Error downloading report:', error);
    }
  });

  // Add button to result container
  resultContainer.appendChild(downloadButton);

  // Add Notion logs download button
  addNotionLogsDownloadButton(resultContainer);

  // Log report summary (reuse existing report variable)
  if (report && report.report) {
    console.log('📊 Upload Report Summary:');
    console.log(`   • Total Blocks: ${report.report.summary.totalBlocks}`);
    console.log(`   • Success Rate: ${report.report.summary.successRate}%`);
    console.log(`   • API Calls: ${report.report.summary.apiCalls}`);
    console.log(`   • Duration: ${report.report.summary.duration}`);
  }
}

/**
 * Add download button for Notion Integration Logs
 */
function addNotionLogsDownloadButton(container) {
  // Check if notionLogger exists
  if (!window.notionLogger) {
    console.log('NotionLogger not available');
    return;
  }

  // Check if download button already exists
  if (document.getElementById('downloadNotionLogsBtn')) {
    return; // Button already exists
  }

  // Create download button
  const downloadButton = document.createElement('button');
  downloadButton.id = 'downloadNotionLogsBtn';
  downloadButton.className = 'download-logs-btn';
  downloadButton.innerHTML = '📋 Download Notion Logs';
  downloadButton.style.cssText = `
    margin-top: 10px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.3s ease;
    display: block;
    width: 100%;
  `;

  // Add hover effects
  downloadButton.addEventListener('mouseenter', () => {
    downloadButton.style.transform = 'translateY(-2px)';
    downloadButton.style.boxShadow = '0 4px 12px rgba(255, 107, 107, 0.4)';
  });

  downloadButton.addEventListener('mouseleave', () => {
    downloadButton.style.transform = 'translateY(0)';
    downloadButton.style.boxShadow = 'none';
  });

  // Add click handler
  downloadButton.addEventListener('click', () => {
    try {
      window.notionLogger.downloadLogFile();
      
      // Show success feedback
      const originalText = downloadButton.innerHTML;
      downloadButton.innerHTML = '✅ Logs Downloaded!';
      downloadButton.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
      
      setTimeout(() => {
        downloadButton.innerHTML = originalText;
        downloadButton.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)';
      }, 2000);
    } catch (error) {
      console.error('Error downloading Notion logs:', error);
      
      // Show error feedback
      const originalText = downloadButton.innerHTML;
      downloadButton.innerHTML = '❌ Download Failed';
      downloadButton.style.background = 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';
      
      setTimeout(() => {
        downloadButton.innerHTML = originalText;
        downloadButton.style.background = 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)';
      }, 2000);
    }
  });

  // Add button to container
  container.appendChild(downloadButton);
}

// Make the function globally available
window.addUploadReportDownloadButton = addUploadReportDownloadButton;

// Make NotionLogger globally available
window.notionLogger = null;