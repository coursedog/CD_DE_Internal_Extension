/**
 * Notion Uploader for Coursedog Extension
 * Handles file preparation and upload to Notion
 */

class NotionUploader {
  constructor(notionClient, notionLogger = null) {
    this.client = notionClient;
    this.notionLogger = notionLogger;
    this.workspaceId = 'coursedog1'; // Extract from Notion URL
    this.lastUploadReport = null; // Store the last upload report
    this.simpleProcessor = null; // Simple content processor
    
    // Notion API rate limits
    this.RATE_LIMIT = {
      REQUESTS_PER_SECOND: 3,
      MIN_DELAY_BETWEEN_BATCHES: 350, // ms
      MAX_BLOCKS_PER_BATCH: 25 // Align with actual append batching in Notion client
    };
  }

  /**
   * Initialize the simple processor
   */
  initializeSimpleProcessor() {
    if (!this.simpleProcessor) {
      this.simpleProcessor = new ContentProcessor(this.client);
    }
  }

  /**
   * Calculate estimated upload time based on content analysis
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {Object} Time estimate with details
   */
  calculateUploadTimeEstimate(tempData, mainSchool, baselineSchool) {
    const estimate = {
      totalApiCalls: 0,
      totalBatches: 0,
      totalBlocks: 0,
      estimatedTimeMs: 0,
      estimatedTimeFormatted: '',
      details: []
    };

    // 1. Main page creation (1 API call)
    estimate.totalApiCalls += 1;
    estimate.details.push('Main page creation: 1 API call');

    // 2. Calculate sub-pages and their content
    const reportConfigs = this.getReportConfigs(tempData, mainSchool, baselineSchool);
    
    for (const config of reportConfigs) {
      const content = config.generateContent();
      if (content && content !== 'Report not available') {
        // Each sub-page requires 1 API call to create + batches to add content
        estimate.totalApiCalls += 1;
        
        // Calculate blocks needed for this content
        const blocks = this.estimateBlocksForContent(content, config.type);
        estimate.totalBlocks += blocks;
        
        // Calculate batches needed (100 blocks per batch)
        const batches = Math.ceil(blocks / this.RATE_LIMIT.MAX_BLOCKS_PER_BATCH);
        estimate.totalBatches += batches;
        estimate.totalApiCalls += batches; // Each batch is 1 API call
        
        estimate.details.push(`${config.title}: ${blocks} blocks, ${batches} batches`);
      }
    }

		// 3. Skip Notion API debug log page creation per requirements

    // 4. Calculate total time with more conservative, real-world estimates
    // Base time: API calls at 3 requests/second (but with network latency)
    const baseTimeMs = (estimate.totalApiCalls / this.RATE_LIMIT.REQUESTS_PER_SECOND) * 1000;
    
    // Additional time: delays between batches (350ms each)
    const batchDelayMs = estimate.totalBatches * this.RATE_LIMIT.MIN_DELAY_BETWEEN_BATCHES;
    
    // Heavier local processing due to validation, table handling, chunking
    const contentProcessingMs = estimate.totalBlocks * 200; // 200ms per block for processing
    const validationOverheadMs = estimate.totalBlocks * 100; // additional per-block validation/repair
    const tableTwoPhaseOverheadMs = estimate.totalBatches * 500; // conservative table/two-phase overhead per batch
    
    // Network latency and overhead (more conservative: 200ms per API call)
    const networkOverheadMs = estimate.totalApiCalls * 200;
    
    // Rate limiting buffer (increase to 100% for real-world retries/backoff)
    const rateLimitBufferMs = (baseTimeMs + batchDelayMs) * 1.0;
    
    // Content conversion time (based on total content size)
    const contentSize = this.estimateTotalContentSize(tempData, mainSchool, baselineSchool);
    const conversionTimeMs = contentSize * 0.1; // 0.1ms per character for conversion
    
    // File upload overhead (e.g., snapshot JSON to Notion storage)
    const fileUploadOverheadMs = 45000; // ~45s baseline
    
    // Aggregate a base estimate then widen to a conservative range
    const baseEstimateMs = 
      baseTimeMs +
      batchDelayMs +
      contentProcessingMs +
      validationOverheadMs +
      tableTwoPhaseOverheadMs +
      networkOverheadMs +
      rateLimitBufferMs +
      conversionTimeMs +
      fileUploadOverheadMs;
    
    const minEstimateMs = Math.max(Math.ceil(baseEstimateMs * 1.2), 20 * 60 * 1000); // ≥ 20 min
    const maxEstimateMs = Math.max(Math.ceil(baseEstimateMs * 1.6), 30 * 60 * 1000); // ≥ 30 min
    
    estimate.estimatedMinTimeMs = minEstimateMs;
    estimate.estimatedMaxTimeMs = maxEstimateMs;
    estimate.estimatedTimeMs = maxEstimateMs; // Use upper bound for time remaining calculations
    estimate.estimatedTimeFormatted = this.formatTimeRange(minEstimateMs, maxEstimateMs);

    // Add detailed time breakdown
    estimate.details.push(`Time breakdown:`);
    estimate.details.push(`  • API calls: ${this.formatTime(baseTimeMs)}`);
    estimate.details.push(`  • Batch delays: ${this.formatTime(batchDelayMs)}`);
    estimate.details.push(`  • Content processing: ${this.formatTime(contentProcessingMs)}`);
    estimate.details.push(`  • Network overhead: ${this.formatTime(networkOverheadMs)}`);
    estimate.details.push(`  • Rate limit buffer: ${this.formatTime(rateLimitBufferMs)}`);
    estimate.details.push(`  • Content conversion: ${this.formatTime(conversionTimeMs)}`);
    estimate.details.push(`  • Range (conservative): ${estimate.estimatedTimeFormatted}`);
    estimate.details.push(`  • Upper bound used for time remaining: ${this.formatTime(estimate.estimatedTimeMs)}`);

    return estimate;
  }

  /**
   * Get report configurations for time estimation
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {Array} Report configurations
   */
  getReportConfigs(tempData, mainSchool, baselineSchool) {
    const reportConfigs = [
      {
        key: 'CAC_Report',
        title: '📋 CAC Report',
        type: 'markdown',
        generateContent: () => tempData['CAC_Report'] || 'CAC Report not available'
      },
      {
        key: 'stepsToExecute_Comparison_Report',
        title: '🔄 Steps to Execute Comparison',
        type: 'markdown',
        generateContent: () => tempData['stepsToExecute_Comparison_Report'] || 'Steps to Execute report not available'
      },
      {
        key: 'fieldExceptions_Comparison_Report',
        title: '⚠️ Field Exceptions Comparison',
        type: 'markdown',
        generateContent: () => tempData['fieldExceptions_Comparison_Report'] || 'Field Exceptions report not available'
      },
      {
        key: 'courseTemplate_Comparison_Report',
        title: '📚 Course Template Comparison',
        type: 'markdown',
        generateContent: () => tempData['courseTemplate_Comparison_Report'] || 'Course Template report not available'
      },
      {
        key: 'programTemplate_Comparison_Report',
        title: '🎓 Program Template Comparison',
        type: 'markdown',
        generateContent: () => tempData['programTemplate_Comparison_Report'] || 'Program Template report not available'
      },
      {
        key: 'sectionTemplate_Comparison_Report',
        title: '📅 Section Template Comparison',
        type: 'markdown',
        generateContent: () => tempData['sectionTemplate_Comparison_Report'] || 'Section Template report not available'
      },
      {
        key: 'AttributeMapping_Comparison_Report',
        title: '🗺️ Attribute Mapping Comparison',
        type: 'markdown',
        generateContent: () => tempData['AttributeMapping_Comparison_Report'] || 'Attribute Mapping report not available'
      },
      {
        key: 'IntegrationFilters_Comparison_Report',
        title: '🔍 Integration Filters Comparison',
        type: 'markdown',
        generateContent: () => tempData['IntegrationFilters_Comparison_Report'] || 'Integration Filters report not available'
      }
    ];

		// Skip adding Snapshot (JSON/Markdown) as sub-pages; JSON snapshots will be attached as a ZIP file

		// Skip API Debug Log per requirements

    return reportConfigs;
  }

  /**
   * Estimate number of blocks needed for content
   * @param {string} content - Content to analyze
   * @param {string} contentType - Type of content ('markdown', 'json', 'text')
   * @returns {number} Estimated number of blocks
   */
  estimateBlocksForContent(content, contentType) {
    if (!content || content === 'Report not available') {
      return 0;
    }

    // Use the same chunking logic as the actual upload
    const MAX_TEXT_LENGTH = 2000;
    let estimatedBlocks = 0;

    if (contentType === 'json') {
      // For JSON content, estimate based on content length
      const chunks = Math.ceil(content.length / MAX_TEXT_LENGTH);
      estimatedBlocks = Math.max(1, chunks);
    } else if (contentType === 'markdown') {
      // For markdown, estimate based on lines and content length
      const lines = content.split('\n');
      let currentLength = 0;
      
      for (const line of lines) {
        if (line.trim() === '') {
          if (currentLength > 0) {
            estimatedBlocks += Math.ceil(currentLength / MAX_TEXT_LENGTH);
            currentLength = 0;
          }
        } else if (line.startsWith('# ')) {
          if (currentLength > 0) {
            estimatedBlocks += Math.ceil(currentLength / MAX_TEXT_LENGTH);
            currentLength = 0;
          }
          estimatedBlocks += 1; // Heading block
        } else {
          currentLength += line.length + 1; // +1 for newline
        }
      }
      
      if (currentLength > 0) {
        estimatedBlocks += Math.ceil(currentLength / MAX_TEXT_LENGTH);
      }
    } else {
      // For plain text, simple estimation
      estimatedBlocks = Math.ceil(content.length / MAX_TEXT_LENGTH);
    }

    return Math.max(1, estimatedBlocks);
  }

  /**
   * Estimate total content size for time calculation
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {number} Total content size in characters
   */
  estimateTotalContentSize(tempData, mainSchool, baselineSchool) {
    let totalSize = 0;
    const reportConfigs = this.getReportConfigs(tempData, mainSchool, baselineSchool);
    
    for (const config of reportConfigs) {
      const content = config.generateContent();
      if (content && content !== 'Report not available') {
        totalSize += content.length;
      }
    }
    
    return totalSize;
  }

  /**
   * Format time in milliseconds to human-readable format
   * @param {number} ms - Time in milliseconds
   * @returns {string} Formatted time string
   */
  formatTime(ms) {
    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format a time range in milliseconds into a human-readable range string
   * @param {number} minMs - Minimum time in ms
   * @param {number} maxMs - Maximum time in ms
   * @returns {string} Formatted range string (e.g., "20–30m")
   */
  formatTimeRange(minMs, maxMs) {
    const toMinutes = (ms) => Math.ceil(ms / 60000);
    const minM = toMinutes(minMs);
    const maxM = toMinutes(maxMs);
    return `${minM}–${maxM}m`;
  }

  /**
   * Upload all report files to Notion using sub-pages
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {Function} progressCallback - Progress callback function
   * @returns {Promise<string>} Notion page URL
   */
  async uploadReportFiles(tempData, mainSchool, baselineSchool, progressCallback, topLevelParentId = null, mainEnv = 'staging', baselineEnv = 'staging') {
    // Use simplified approach to avoid validation errors
    return this.uploadReportFilesSimplified(tempData, mainSchool, baselineSchool, progressCallback, topLevelParentId, mainEnv, baselineEnv);
  }

  /**
   * Create metadata table for CAC configuration
   * @param {Object} config - Configuration object with configType, data, and jsonStr
   * @param {string} mainSchool - Main school ID
   * @returns {Object} Notion table block
   */
  createCACMetadataTable(config, mainSchool) {
    // Extract endpoint from config.data
    const endpoint = config.data?.endpoint || 'N/A';
    
    // Extract entity from configType (e.g., "fieldMappings_courses" -> "courses")
    let entity = 'N/A';
    if (config.configType.includes('_')) {
      const parts = config.configType.split('_');
      // Get the last part (usually the entity type)
      entity = parts[parts.length - 1];
    } else {
      entity = config.configType;
    }
    
    // Create a Notion table with 2 columns
    return {
      object: 'block',
      type: 'table',
      table: {
        table_width: 2,
        has_column_header: false,
        has_row_header: false,
        children: [
          // Row 1: Date Added
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: 'Date Added:' }, annotations: { bold: true } }],
                [{ type: 'text', text: { content: '' } }] // Empty for user input
              ]
            }
          },
          // Row 2: Endpoint
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: 'Endpoint:' }, annotations: { bold: true } }],
                [{ type: 'text', text: { content: endpoint } }]
              ]
            }
          },
          // Row 3: Entity
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: 'Entity:' }, annotations: { bold: true } }],
                [{ type: 'text', text: { content: entity } }]
              ]
            }
          },
          // Row 4: Reason for change
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: 'Reason for change:' }, annotations: { bold: true } }],
                [{ type: 'text', text: { content: '' } }] // Empty for user input
              ]
            }
          },
          // Row 5: Person who made the change
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: 'Person who made the change:' }, annotations: { bold: true } }],
                [{ type: 'text', text: { content: '' } }] // Empty for user input
              ]
            }
          },
          // Row 6: Support Ticket URL
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: 'Support Ticket URL (if applicable):' }, annotations: { bold: true } }],
                [{ type: 'text', text: { content: '' } }] // Empty for user input
              ]
            }
          }
        ]
      }
    };
  }

  /**
   * Generate Notion blocks for CAC Report (JSON code blocks only)
   * ONLY uploads Main School successful responses with valid JSON (>3 chars)
   * @param {Object} tempData - Report data containing integration responses
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID (unused - kept for compatibility)
   * @returns {Array} Array of Notion block objects
   */
  generateCACNotionBlocks(tempData, mainSchool, baselineSchool) {
    const blocks = [];
    
    // Add intro paragraph
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: `This report contains all successful integration configuration responses for ${mainSchool}.` }
        }]
      }
    });
    
    // Helper to extract config type from key
    const parseConfigKey = (key) => {
      // Format: MainSchool_integrationSettings or MainSchool_fieldMappings_courses
      const parts = key.split('_');
      const configType = parts.slice(1).join('_'); // integrationSettings, fieldMappings_courses, etc.
      return configType;
    };
    
    // Collect ONLY MainSchool integration keys with valid data
    const mainSchoolKeys = Object.keys(tempData).filter(key => 
      key.startsWith('MainSchool_') &&
      !key.includes('mergeSettings') &&
      !key.includes('template') &&
      !key.includes('_Comparison')
    );
    
    // Build list of valid configurations (successful + JSON length > 3)
    const validConfigs = [];
    mainSchoolKeys.forEach(key => {
      const data = tempData[key];
      
      // Check: successful response + has data
      if (data && data.status === 'success' && data.data) {
        const jsonStr = JSON.stringify(data.data, null, 2);
        
        // Validate JSON length > 3 characters (more than just "{}" or "[]")
        if (jsonStr.length > 3) {
          const configType = parseConfigKey(key);
          validConfigs.push({ configType, data, jsonStr });
        }
      }
    });
    
    // Sort by config type name
    validConfigs.sort((a, b) => a.configType.localeCompare(b.configType));
    
    // Generate blocks ONLY for valid configurations
    validConfigs.forEach(config => {
      // Create a heading for this config type
      const readableTitle = config.configType
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: { content: readableTitle }
          }]
        }
      });
      
      // Add Main School subheading
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: { content: `Main School: ${mainSchool}` }
          }]
        }
      });
      
      // Add metadata table before code block
      const metadataTable = this.createCACMetadataTable(config, mainSchool);
      blocks.push(metadataTable);
      
      // Add JSON code block
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{
            type: 'text',
            text: { content: config.jsonStr }
          }],
          language: 'json'
        }
      });
      
      // Add divider between config types
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
    });
    
    // If no valid configs found, add a message
    if (validConfigs.length === 0) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: 'No valid integration configurations found for this school.' }
          }]
        }
      });
    }
    
    return blocks;
  }

  /**
   * Simplified upload method focusing only on tables and section titles
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {Function} progressCallback - Progress callback function
   * @param {string} topLevelParentId - Top-level parent page ID
   * @param {string} mainEnv - Main school environment ('staging' or 'production')
   * @param {string} baselineEnv - Baseline school environment ('staging' or 'production')
   * @returns {Promise<string>} Notion page URL
   */
  async uploadReportFilesSimplified(tempData, mainSchool, baselineSchool, progressCallback, topLevelParentId = null, mainEnv = 'staging', baselineEnv = 'staging') {
    try {
      // Initialize simple processor
      this.initializeSimpleProcessor();
      
      progressCallback('10% - Initializing simplified Notion upload...');
      progressCallback('15% - Creating main Notion page...');

      // Create main page first
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const timeStr = now.toTimeString().slice(0, 5); // HH:MM
      const pageTitle = `${mainSchool} Pod Lead Review ${dateStr} ${timeStr}`;
      const parentId = topLevelParentId || '265f804589d180518502d2db7c9f8ce6';
      if (!topLevelParentId) {
        try { this.client.logWarning && this.client.logWarning('deprecation', 'Using hardcoded Notion parentId; please set Top-level Notion page URL'); } catch (_) {}
      }
      
      const mainPage = await this.client.createPage(pageTitle, parentId);

      progressCallback('20% - Generating simplified main page content...');
      
      // Create simplified main page content
      const mainPageBlocks = this.createSimplifiedMainPageContent(mainSchool, baselineSchool, mainEnv, baselineEnv);
      await this.client.appendBlocksToPage(mainPage.id, mainPageBlocks);

      progressCallback('25% - Main page created successfully!');
			progressCallback('26% - Attaching main snapshot (JSON)...');
			await this.attachMainSnapshotJsonToPage(mainPage.id, tempData, mainSchool, progressCallback);
      progressCallback('30% - Starting simplified sub-page creation...');

			// (ZIP attachment removed; using hosted JSON upload instead)

			// Create simplified sub-pages
      const subPages = await this.createSimplifiedSubPages(tempData, mainSchool, baselineSchool, progressCallback, mainPage.id);

      progressCallback('95% - Finalizing upload...');
      progressCallback('100% - All simplified pages created successfully!');

      // Generate downloadable upload report
      let uploadReport = null;
      try {
        uploadReport = this.client.generateUploadReport();
        this.lastUploadReport = uploadReport;
        if (uploadReport) {
          progressCallback('100% - ✓ Upload complete! Notion Upload Report ready for download.');
        } else {
          progressCallback('100% - ✓ Upload complete!');
        }
      } catch (error) {
        console.warn('Failed to generate upload report:', error);
        progressCallback('100% - ✓ Upload complete!');
      }

      return {
        url: mainPage.url || `https://www.notion.so/${this.workspaceId}/${mainPage.id.replace(/-/g, '')}`,
        uploadReport: uploadReport
      };

      } catch (error) {
        if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
          progressCallback('Upload cancelled by user.');
          throw error;
        }
        console.error('Error uploading to Notion:', error);
        progressCallback(`Error: ${error.message}`);
      
      // Generate error report even on failure
      try {
        const uploadReport = this.client.generateUploadReport();
        this.lastUploadReport = uploadReport;
      } catch (reportError) {
        console.warn('Failed to generate error report:', reportError);
        this.lastUploadReport = null;
      }
      
      throw error;
    }
  }

  /**
   * Original complex upload method (kept for fallback)
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {Function} progressCallback - Progress callback function
   * @param {string} topLevelParentId - Top-level parent page ID
   * @param {string} mainEnv - Main school environment ('staging' or 'production')
   * @param {string} baselineEnv - Baseline school environment ('staging' or 'production')
   * @returns {Promise<string>} Notion page URL
   */
  async uploadReportFilesOriginal(tempData, mainSchool, baselineSchool, progressCallback, topLevelParentId = null, mainEnv = 'staging', baselineEnv = 'staging') {
    try {
      progressCallback('10% - Initializing Notion upload...');
      progressCallback('15% - Creating main Notion page...');

      // Create main page first
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const timeStr = now.toTimeString().slice(0, 5); // HH:MM
      const pageTitle = `${mainSchool} Pod Lead Review ${dateStr} ${timeStr}`;
      const parentId = topLevelParentId || '265f804589d180518502d2db7c9f8ce6';
      if (!topLevelParentId) {
        try { this.client.logWarning && this.client.logWarning('deprecation', 'Using hardcoded Notion parentId; please set Top-level Notion page URL'); } catch (_) {}
      }
      
      // Create main page with overview content
      const mainPageContent = this.createMainPageContent(mainSchool, baselineSchool, mainEnv, baselineEnv);
      progressCallback('20% - Generating main page content...');
      const mainPage = await this.client.createPage(pageTitle, parentId, mainPageContent);
      
      progressCallback('25% - Main page created successfully!');
      progressCallback('30% - Starting sub-page creation...');

      // Create sub-pages for each report
      const subPages = await this.createSubPages(mainPage.id, tempData, mainSchool, baselineSchool, progressCallback);
      
			// Skip creating Notion API Debug Log page per requirements
      
      progressCallback('95% - Finalizing upload...');
      progressCallback('100% - All pages created successfully!');

      // Generate downloadable upload report
      let uploadReport = null;
      try {
        uploadReport = this.client.generateUploadReport();
        this.lastUploadReport = uploadReport;
        if (uploadReport) {
          progressCallback('100% - ✓ Upload complete! Notion Upload Report ready for download.');
        } else {
          progressCallback('100% - ✓ Upload complete!');
        }
      } catch (error) {
        console.warn('Failed to generate upload report:', error);
        progressCallback('100% - ✓ Upload complete!');
      }

      return {
        url: mainPage.url || `https://www.notion.so/${this.workspaceId}/${mainPage.id.replace(/-/g, '')}`,
        uploadReport: uploadReport
      };

    } catch (error) {
      if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
        progressCallback('Upload cancelled by user.');
        throw error;
      }
      console.error('Error uploading to Notion:', error);
      progressCallback(`Error: ${error.message}`);
      
      // Generate error report even on failure
      try {
        const uploadReport = this.client.generateUploadReport();
        this.lastUploadReport = uploadReport;
      } catch (reportError) {
        console.warn('Failed to generate error report:', reportError);
        this.lastUploadReport = null;
      }
      
      throw error;
    }
  }

  /**
   * Create ZIP file from all generated data
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {Promise<Blob>} ZIP file blob
   */
  async createZipFile(tempData, mainSchool, baselineSchool) {
    if (!window.JSZip) {
      throw new Error('JSZip library not available');
    }

    const zip = new JSZip();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');

    // Add individual JSON files (exclude integration files since they're in CAC_Report.md)
    Object.keys(tempData).forEach(key => {
      // Skip integration-related files since they're consolidated in CAC_Report.md
      if (this.isIntegrationFile(key)) {
        return;
      }
      
      // Handle snapshot files with proper naming
      let filename = `${key}.json`;
      let mimeType = 'application/json';
      
      if (key.includes('snapshot_') && key.includes('_json')) {
        // Use snapshot_<schoolId>.json naming
        filename = key.replace('_json', '.json');
      } else if (key.includes('snapshot_') && key.includes('_markdown')) {
        // Skip markdown snapshot files - we don't need them
        return;
      }
      
      const content = mimeType === 'text/markdown' ? tempData[key] : JSON.stringify(tempData[key], null, 2);
      zip.file(filename, content);
    });

    // Removed Configuration_Comparison_Report from ZIP

    // Add CAC Report if available
    if (tempData['CAC_Report']) {
      zip.file('CAC_Report.md', tempData['CAC_Report']);
    }

    // Add new comparison reports
    this.comparisonReportKeys.forEach(reportKey => {
      if (tempData[reportKey]) {
        zip.file(`${reportKey}.md`, tempData[reportKey]);
      }
    });

    // Add debug log file
    const debugLog = this.generateDebugLogFile(tempData);
    zip.file('API_Debug_Log.md', debugLog);

    return await zip.generateAsync({ type: 'blob' });
  }

  /**
   * Upload the main school's snapshot JSON and attach it to the page (hosted by Notion)
   * @param {string} pageId
   * @param {Object} tempData
   * @param {string} mainSchool
   * @param {Function|null} progressCallback
   */
  async attachMainSnapshotJsonToPage(pageId, tempData, mainSchool, progressCallback = null) {
    const key = `snapshot_${mainSchool}_json`;
    const jsonContent = tempData[key];
    if (!jsonContent) {
      if (progressCallback) progressCallback(`No snapshot found for ${mainSchool}`);
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const fileName = `snapshot_${mainSchool}.json`;

    try {
      if (progressCallback) progressCallback('Uploading main snapshot (JSON) to Notion...');
      const jsonBlob = new Blob([jsonContent], { type: 'application/json' });
      const fileUploadId = await this.client.uploadBlobToNotion(jsonBlob, fileName, 'application/json', progressCallback);
      const fileBlock = this.client.createFileUploadBlock(fileName, fileUploadId);
      await this.client.appendBlocksToPage(pageId, [fileBlock]);
      if (progressCallback) progressCallback(`Attached ${fileName} to the Notion page.`);
    } catch (e) {
      console.error('Failed to upload/attach main Snapshot JSON to Notion storage:', e);
      const note = [
        this.client.createHeadingBlock('📄 Snapshot (JSON)', 3),
        this.client.createParagraphBlock('Could not attach Snapshot JSON to Notion. Please download it from the extension downloads.')
      ];
      try { await this.client.appendBlocksToPage(pageId, note); } catch (_) {}
    }
  }

  /**
   * Prepare individual files for upload
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {Promise<Array>} Array of file objects
   */
  async prepareFiles(tempData, mainSchool, baselineSchool) {
    const files = [];

    // Add ZIP file
    const zipBlob = await this.createZipFile(tempData, mainSchool, baselineSchool);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    files.push({
      name: `Coursedog_Report_${mainSchool}_vs_${baselineSchool}_${timestamp}.zip`,
      blob: zipBlob
    });

    // Add individual files
    Object.keys(tempData).forEach(key => {
      if (this.isIntegrationFile(key)) {
        return;
      }
      
      let filename = `${key}.json`;
      let content = JSON.stringify(tempData[key], null, 2);
      
      if (key.includes('snapshot_') && key.includes('_json')) {
        // Use snapshot_<schoolId>.json naming
        filename = key.replace('_json', '.json');
      } else if (key.includes('snapshot_') && key.includes('_markdown')) {
        // Skip markdown snapshot files - we don't need them
        return;
      }
      
      files.push({
        name: filename,
        blob: new Blob([content], { type: 'application/json' })
      });
    });

    // Removed Configuration_Comparison_Report from individual files

    // Add CAC Report if available
    if (tempData['CAC_Report']) {
      files.push({
        name: 'CAC_Report.md',
        blob: new Blob([tempData['CAC_Report']], { type: 'text/markdown' })
      });
    }

    // Add new comparison reports
    this.comparisonReportKeys.forEach(reportKey => {
      if (tempData[reportKey]) {
        files.push({
          name: `${reportKey}.md`,
          blob: new Blob([tempData[reportKey]], { type: 'text/markdown' })
        });
      }
    });

    // Add debug log file
    const debugLog = this.generateDebugLogFile(tempData);
    files.push({
      name: 'API_Debug_Log.md',
      blob: new Blob([debugLog], { type: 'text/markdown' })
    });

    return files;
  }

  /**
   * Check if file is integration-related
   * @param {string} key - File key
   * @returns {boolean} True if integration file
   */
  isIntegrationFile(key) {
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

  /**
   * Generate comparison report (simplified version)
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {string} Comparison report content
   */
  generateComparisonReport(tempData, mainSchool, baselineSchool) {
    // Deprecated: Configuration_Comparison_Report is no longer used
    return '';
  }

  /**
   * Generate debug log file (simplified version)
   * @param {Object} tempData - All generated data
   * @returns {string} Debug log content
   */
  generateDebugLogFile(tempData) {
    return `# Coursedog API Debug Log\n\nGenerated: ${new Date().toISOString()}\n\nThis log contains detailed information about all API calls made during report generation.`;
  }

  /**
   * Create main page content with overview and links to sub-pages
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {string} mainEnv - Main school environment ('staging' or 'production')
   * @param {string} baselineEnv - Baseline school environment ('staging' or 'production')
   * @returns {Array} Array of content blocks for the main page
   */
  createMainPageContent(mainSchool, baselineSchool, mainEnv = 'staging', baselineEnv = 'staging') {
    const mainEnvLabel = mainEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    const baselineEnvLabel = baselineEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    
    return [
      this.client.createHeadingBlock(`Pod Lead Review: ${mainSchool} vs ${baselineSchool}`, 1),
      this.client.createParagraphBlock(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`),
      this.client.createDividerBlock(),
      this.client.createHeadingBlock('📊 Report Overview', 2),
      this.client.createParagraphBlock('This page contains a comprehensive comparison between the two selected schools. Each report type is available as a separate sub-page for detailed analysis.'),
      this.client.createDividerBlock(),
      this.client.createHeadingBlock('📋 Available Reports', 2),
      this.client.createParagraphBlock('Click on any of the following sub-pages to view detailed reports:'),
      this.client.createDividerBlock(),
      this.client.createHeadingBlock('🔧 Technical Details', 3),
      this.client.createParagraphBlock(`• Main School: ${mainSchool} (${mainEnvLabel})`),
      this.client.createParagraphBlock(`• Baseline School: ${baselineSchool} (${baselineEnvLabel})`),
      this.client.createParagraphBlock(`• Generated by: SIS compare tool + Env capture Extension`)
    ];
  }

  /**
   * Create sub-pages for each report
   * @param {string} mainPageId - Main page ID
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {Function} progressCallback - Progress callback function
   * @returns {Promise<Array>} Array of created sub-pages
   */
  async createSubPages(mainPageId, tempData, mainSchool, baselineSchool, progressCallback) {
    const subPages = [];
    
    // Use the shared report configurations
    const reportConfigs = this.getReportConfigs(tempData, mainSchool, baselineSchool);

    // Create each sub-page
    for (let i = 0; i < reportConfigs.length; i++) {
      const config = reportConfigs[i];
      const progressPercent = Math.round(30 + (i / reportConfigs.length) * 55); // 30% to 85%
      
      try {
        progressCallback(`${progressPercent}% - Creating ${config.title}...`);
        
        const content = config.generateContent();
        if (content && content !== 'Report not available') {
          const subPage = await this.client.createSubPage(
            config.title,
            mainPageId,
            content,
            config.type,
            (message) => {
              // Forward detailed progress from createSubPage without duplicating the percentage
              if (!message.includes('%')) {
                // Only log the detailed message, don't update progress bar
                console.log(`Sub-page progress: ${message}`);
              } else {
                // If the message contains a percentage, forward it as-is
                progressCallback(message);
              }
            }
          );
          
          subPages.push({
            title: config.title,
            id: subPage.id,
            url: subPage.url
          });
          
          progressCallback(`${progressPercent}% - ✓ Created ${config.title}`);
        } else {
          progressCallback(`${progressPercent}% - ⚠ Skipped ${config.title} (no content)`);
        }
      } catch (error) {
        if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
          // Propagate cancellation without logging as an error
          throw error;
        }
        console.error(`Error creating ${config.title}:`, error);
        progressCallback(`${progressPercent}% - ✗ Failed to create ${config.title}: ${error.message}`);
      }
    }

    return subPages;
  }

  /**
   * Get the last upload report for download
   * @returns {Object|null} Upload report data or null if no report available
   */
  getUploadReport() {
    return this.lastUploadReport;
  }

  /**
   * Download the Notion Upload Report
   * @returns {boolean} True if download was initiated, false if no report available
   */
  downloadUploadReport() {
    if (!this.lastUploadReport) {
      console.warn('No upload report available for download');
      return false;
    }

    try {
      // Create blob with the report content
      const blob = new Blob([this.lastUploadReport.downloadContent], {
        type: 'application/json'
      });

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.lastUploadReport.filename;
      a.style.display = 'none';
      
      // Trigger download
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up
      URL.revokeObjectURL(url);
      
      console.log(`✅ Upload report downloaded: ${this.lastUploadReport.filename}`);
      return true;
    } catch (error) {
      console.error('Error downloading upload report:', error);
      return false;
    }
  }

  // Comparison report keys (simplified)
  get comparisonReportKeys() {
    return [
      'stepsToExecute_Comparison_Report',
      'fieldExceptions_Comparison_Report',
      'courseTemplate_Comparison_Report',
      'programTemplate_Comparison_Report',
      'sectionTemplate_Comparison_Report',
      'AttributeMapping_Comparison_Report',
      'IntegrationFilters_Comparison_Report'
    ];
  }

  /**
   * Generate Notion Debug Log using the report generator
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {string} Markdown report
   */
  generateNotionDebugLog(mainSchool, baselineSchool) {
    const notionLogs = this.client.getLogs();
    
    // Create a simple debug log if ReportGenerator is not available
    if (typeof CoursedogReportGenerator === 'undefined') {
      return this.generateSimpleNotionDebugLog(notionLogs, mainSchool, baselineSchool);
    }
    
    const reportGenerator = new CoursedogReportGenerator(
      mainSchool || 'Unknown',
      baselineSchool || 'Unknown',
      {},
      []
    );
    return reportGenerator.generateNotionDebugLog(notionLogs, mainSchool, baselineSchool);
  }

  /**
   * Generate a simple Notion debug log when ReportGenerator is not available
   * @param {Array} notionLogs - Array of Notion API logs
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {string} Simple debug log content
   */
  generateSimpleNotionDebugLog(notionLogs, mainSchool, baselineSchool) {
    if (!notionLogs || notionLogs.length === 0) {
      return `# Notion API Debug Log

## Summary
No Notion API calls were made during this session.

## Details
The Notion upload feature was not used for this report generation.

---
*Generated on ${new Date().toISOString()}*`;
    }

    const totalRequests = notionLogs.filter(log => log.type === 'request').length;
    const totalResponses = notionLogs.filter(log => log.type === 'response').length;
    const successfulRequests = notionLogs.filter(log => log.type === 'response' && log.status >= 200 && log.status < 300).length;
    const failedRequests = notionLogs.filter(log => log.type === 'response' && (log.status < 200 || log.status >= 300)).length;

    let report = `# Notion API Debug Log

## Summary
- **Main School**: ${mainSchool || 'Unknown'}
- **Baseline School**: ${baselineSchool || 'Unknown'}
- **Total Requests**: ${totalRequests}
- **Total Responses**: ${totalResponses}
- **Successful Requests**: ${successfulRequests}
- **Failed Requests**: ${failedRequests}
- **Success Rate**: ${totalResponses > 0 ? ((successfulRequests / totalResponses) * 100).toFixed(1) : 0}%

## Request/Response Details

`;

    // Add basic request/response details
    notionLogs.forEach((log, index) => {
      if (log.type === 'request') {
        report += `### Request ${Math.floor(index / 2) + 1}: ${log.method} ${log.url.split('/').pop()}\n\n`;
        report += `**Timestamp**: ${log.timestamp}\n\n`;
        report += `**Method**: ${log.method}\n\n`;
        report += `**URL**: ${log.url}\n\n`;
        if (log.body) {
          report += `**Request Body**:\n\`\`\`json\n${JSON.stringify(log.body, null, 2)}\n\`\`\`\n\n`;
        }
      } else if (log.type === 'response') {
        report += `**Response Status**: ${log.status}\n\n`;
        if (log.error) {
          report += `**Error**: ${log.error}\n\n`;
        }
        report += `---\n\n`;
      }
    });

    report += `---
*Generated on ${new Date().toISOString()}*`;

    return report;
  }

  /**
   * Create simplified main page content with just overview
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {Array} Array of Notion blocks
   */
  createSimplifiedMainPageContent(mainSchool, baselineSchool, mainEnv = 'staging', baselineEnv = 'staging') {
    const blocks = [];
    const mainEnvLabel = mainEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    const baselineEnvLabel = baselineEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    
    // Add main title
    blocks.push(this.client.createHeadingBlock(`Pod Lead Review: ${mainSchool} vs ${baselineSchool}`, 1));
    
    // Add overview paragraph
    blocks.push(this.client.createParagraphBlock(
      `This is a simplified view focusing on the key comparison tables between ${mainSchool} (${mainEnvLabel}) and ${baselineSchool} (${baselineEnvLabel}). ` +
      `Each section below contains the essential data in table format for easy comparison.`
    ));
    
    // Add timestamp
    const now = new Date();
    blocks.push(this.client.createParagraphBlock(
      `**Generated:** ${now.toLocaleString()}`
    ));
    
    // Add environment details
    blocks.push(this.client.createDividerBlock());
    blocks.push(this.client.createHeadingBlock('🔧 Technical Details', 3));
    blocks.push(this.client.createParagraphBlock(`• Main School: ${mainSchool} (${mainEnvLabel})`));
    blocks.push(this.client.createParagraphBlock(`• Baseline School: ${baselineSchool} (${baselineEnvLabel})`));
    blocks.push(this.client.createParagraphBlock(`• Generated by: SIS compare tool + Env capture Extension`));
    blocks.push(this.client.createDividerBlock());
    
    return blocks;
  }

  /**
   * Create simplified sub-pages focusing only on tables
   * @param {Object} tempData - All generated data
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {Function} progressCallback - Progress callback function
   * @param {string} mainPageId - Main page ID to use as parent
   * @returns {Promise<Array>} Array of created sub-pages
   */
  async createSimplifiedSubPages(tempData, mainSchool, baselineSchool, progressCallback, mainPageId) {
    const subPages = [];
    
    // Use the same report configurations as the original method
    const reportConfigs = this.getReportConfigs(tempData, mainSchool, baselineSchool);

    let progress = 30;
    const progressStep = 60 / reportConfigs.length;

    for (let i = 0; i < reportConfigs.length; i++) {
      const config = reportConfigs[i];
      const progressPercent = Math.round(30 + (i / reportConfigs.length) * 60); // 30% to 90%
      
      try {
        progressCallback(`${progressPercent}% - Creating ${config.title}...`);
        
        const content = config.generateContent();
        if (content && content !== 'Report not available') {
          let blocks = []; // Declare blocks outside try block to avoid scope issues
          
          // Ensure simpleProcessor is initialized
          if (!this.simpleProcessor) {
            this.initializeSimpleProcessor();
          }
          
          // Special handling for CAC Report - generate blocks first, skip if none
          if (config.key === 'CAC_Report') {
            blocks = this.generateCACNotionBlocks(tempData, mainSchool, baselineSchool);
            
            // Only create sub-page if we have blocks to add
            if (blocks && Array.isArray(blocks) && blocks.length > 1) { // >1 because intro paragraph always exists
              const subPage = await this.client.createPage(config.title, mainPageId);
              await this.client.appendBlocksToPage(subPage.id, blocks);
              
              subPages.push({
                title: config.title,
                id: subPage.id,
                url: subPage.url
              });
              
              progressCallback(`${progressPercent}% - ✓ Created ${config.title}`);
            } else {
              progressCallback(`${progressPercent}% - ⚠ Skipped ${config.title} (no valid data)`);
            }
            continue; // Skip the normal processing below
          }
          
          // Create the sub-page FIRST (needed for table/database creation)
          const subPage = await this.client.createPage(config.title, mainPageId);
          
          // Process report content to blocks with the actual page ID
          // This allows tables to be created as inline databases with the correct parent
          if (this.simpleProcessor && typeof this.simpleProcessor.processReportForNotion === 'function') {
            blocks = await this.simpleProcessor.processReportForNotion(
              content,
              config.title,
              subPage.id, // Pass actual page ID for table/database creation
              { allowHeadings: false, titleEachCodeBlock: false, suppressTopHeading: false }
            );
          } else {
            console.error('SimpleProcessor not properly initialized');
            blocks = []; // Fallback to empty array
          }
          
          // Check if content is significant after processing
          if (!this.hasSignificantContent(blocks)) {
            // Delete the empty page we just created (cleanup)
            try {
              await this.client.archivePage(subPage.id);
            } catch (archiveError) {
              console.warn(`Could not archive empty page ${config.title}:`, archiveError);
            }
            progressCallback(`${progressPercent}% - ⚠ Skipped ${config.title} (insufficient content)`);
            continue; // Skip to next report
          }
          
          // Add blocks to sub-page
          if (blocks && Array.isArray(blocks) && blocks.length > 0) {
            await this.client.appendBlocksToPage(subPage.id, blocks);
          }
          
          subPages.push({
            title: config.title,
            id: subPage.id,
            url: subPage.url
          });
          
          progressCallback(`${progressPercent}% - ✓ Created ${config.title}`);
        } else {
          progressCallback(`${progressPercent}% - ⚠ Skipped ${config.title} (no content)`);
        }
      } catch (error) {
        if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
          // Propagate cancellation without logging as an error
          throw error;
        }
        console.error(`Error creating ${config.title}:`, error);
        progressCallback(`${progressPercent}% - ✗ Error creating ${config.title}: ${error.message}`);
      }
    }

    return subPages;
  }

  /**
   * Get a friendly title for a report key
   * @param {string} reportKey - The report key
   * @returns {string} Friendly title
   */
  getReportTitle(reportKey) {
    const titles = {
      'courseTemplate_Comparison_Report': '📚 Course Template Comparison',
      'programTemplate_Comparison_Report': '🎓 Program Template Comparison',
      'sectionTemplate_Comparison_Report': '📅 Section Template Comparison',
      'attributeMapping_Comparison_Report': '🗺️ Attribute Mapping Comparison',
      'integrationFilters_Comparison_Report': '🔍 Integration Filters Comparison'
    };
    
    return titles[reportKey] || reportKey;
  }

  /**
   * Check if blocks array contains meaningful content
   * Skips pages with only headers, dividers, and minimal text
   * @param {Array} blocks - Array of Notion blocks
   * @returns {boolean} True if content is meaningful, false if empty/trivial
   */
  hasSignificantContent(blocks) {
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return false;
    }

    // Filter out "structural" blocks (headings, dividers)
    const contentBlocks = blocks.filter(block => {
      const type = block?.type;
      return type !== 'heading_1' && 
             type !== 'heading_2' && 
             type !== 'heading_3' && 
             type !== 'divider';
    });

    // If no content blocks, it's empty
    if (contentBlocks.length === 0) {
      return false;
    }

    // Check if content blocks have actual text
    let totalTextLength = 0;
    for (const block of contentBlocks) {
      const type = block.type;
      const content = block[type];
      
      if (content?.rich_text && Array.isArray(content.rich_text)) {
        for (const text of content.rich_text) {
          totalTextLength += (text?.text?.content || '').length;
        }
      }
      
      // Special case for code blocks
      if (type === 'code' && content?.rich_text) {
        totalTextLength += JSON.stringify(content.rich_text).length;
      }
    }

    // Consider content significant if it has more than 50 characters of actual text
    // This filters out pages with just error messages or "No data" statements
    return totalTextLength > 50;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotionUploader;
}
