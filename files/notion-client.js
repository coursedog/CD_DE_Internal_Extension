/**
 * Notion API Client for Coursedog Extension
 * Handles all Notion API interactions including page creation and file uploads
 */

class NotionClient {
  constructor(secret, notionLogger = null) {
    this.secret = secret;
    this.baseURL = 'https://api.notion.com/v1/';
    this.headers = {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    };
    this.logs = []; // Store all API request/response logs
    this.notionLogger = notionLogger; // Reference to NotionLogger instance
    this._abortControllers = new Set();
    this._cancelled = false;
    
    // Initialize upload report safely
    try {
      this.uploadReport = {
        startTime: new Date().toISOString(),
        endTime: null,
        summary: {
          totalBlocks: 0,
          validBlocks: 0,
          repairedBlocks: 0,
          skippedBlocks: 0,
          batches: 0,
          apiCalls: 0,
          errors: 0
        },
        blockValidation: [],
        batchProcessing: [],
        apiRequests: [],
        errors: [],
        warnings: []
      };
    } catch (error) {
      console.warn('Failed to initialize upload report:', error);
      this.uploadReport = null;
    }

    // ✅ Test Comments column functionality
    this.testCommentsColumnFunctionality();
  }

  /**
   * Test Comments column functionality
   */
  testCommentsColumnFunctionality() {
    try {
      // Test 1: Basic headers
      const test1 = this.testCommentsColumn(['Name', 'Type', 'Status']);
      console.log('✅ Test 1 - Basic headers:', test1);

      // Test 2: Headers that already include Comments
      const test2 = this.testCommentsColumn(['Name', 'Type', 'Comments']);
      console.log('✅ Test 2 - Headers with Comments:', test2);

      // Test 3: Empty headers
      const test3 = this.testCommentsColumn([]);
      console.log('✅ Test 3 - Empty headers:', test3);

      // Test 4: Single header
      const test4 = this.testCommentsColumn(['Title']);
      console.log('✅ Test 4 - Single header:', test4);

      console.log('🎉 Comments column functionality verified!');
    } catch (error) {
      console.error('❌ Comments column test failed:', error);
    }
  }

  // Cancellation classifier used across client/uploader
  static isCancellationError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    const msg = String(err && (err.message || err)) || '';
    if (/cancelled|canceled/i.test(msg)) return true;
    if (err.code === 'ERR_CANCELED') return true;
    return false;
  }

  /**
   * Retrieve a page by ID from Notion API
   * @param {string} pageId - Dashed UUID page ID
   * @returns {Promise<{ok: boolean, status: number, data?: any, error?: string}>}
   */
  async retrievePage(pageId) {
    const id = String(pageId || '').trim();
    if (!id) return { ok: false, status: 400, error: 'Missing pageId' };
    const url = `${this.baseURL}pages/${id}`;
    this.logRequest('GET', url, null, this.headers);
    try {
      const response = await this._fetch(url, { method: 'GET', headers: this.headers });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : null;
      this.logResponse('GET', url, response.status, data);
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      this.logResponse('GET', url, 0, null, error?.message || String(error));
      return { ok: false, status: 0, error: error?.message || String(error) };
    }
  }

  // ----- Cancellation helpers -----
  cancel() {
    try {
      this._cancelled = true;
      this._abortControllers.forEach(c => { try { c.abort(); } catch (_) {} });
      this._abortControllers.clear();
    } catch (_) {}
  }

  _ensureNotCancelled() {
    if (this._cancelled) {
      throw new Error('Upload cancelled by user');
    }
  }

  async _fetch(url, init = {}) {
    this._ensureNotCancelled();
    const controller = new AbortController();
    this._abortControllers.add(controller);
    const initWithSignal = { ...init, signal: controller.signal };
    try {
      const resp = await fetch(url, initWithSignal);
      this._ensureNotCancelled();
      return resp;
    } finally {
      this._abortControllers.delete(controller);
    }
  }

  /**
   * Log a Notion API request
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @param {Object} body - Request body
   * @param {Object} headers - Request headers
   */
  logRequest(method, url, body, headers) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'request',
      method: method,
      url: url,
      headers: this.sanitizeHeaders(headers),
      body: body ? JSON.parse(JSON.stringify(body)) : null
    };
    this.logs.push(logEntry);
    
    // Also log to NotionLogger if available
    if (this.notionLogger) {
      this.notionLogger.logApiRequest(method, url, headers, body);
    }
  }

  /**
   * Log a Notion API response
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @param {number} status - Response status
   * @param {Object} response - Response data
   * @param {string} error - Error message if any
   */
  logResponse(method, url, status, response, error = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'response',
      method: method,
      url: url,
      status: status,
      response: response ? JSON.parse(JSON.stringify(response)) : null,
      error: error
    };
    this.logs.push(logEntry);
    
    // Also log to NotionLogger if available
    if (this.notionLogger) {
      this.notionLogger.logApiResponse(method, url, status, response, error);
    }
  }

  /**
   * Get status text for HTTP status code
   * @param {number} status - HTTP status code
   * @returns {string} Status text
   */
  getStatusText(status) {
    const statusTexts = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };
    return statusTexts[status] || 'Unknown';
  }

  /**
   * Sanitize headers to remove sensitive information
   * @param {Object} headers - Headers to sanitize
   * @returns {Object} Sanitized headers
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    if (sanitized.Authorization) {
      sanitized.Authorization = 'Bearer [REDACTED]';
    }
    return sanitized;
  }

  /**
   * Get all logs
   * @returns {Array} Array of log entries
   */
  getLogs() {
    return this.logs;
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
    this.uploadReport = {
      startTime: new Date().toISOString(),
      endTime: null,
      summary: {
        totalBlocks: 0,
        validBlocks: 0,
        repairedBlocks: 0,
        skippedBlocks: 0,
        batches: 0,
        apiCalls: 0,
        errors: 0
      },
      blockValidation: [],
      batchProcessing: [],
      apiRequests: [],
      errors: [],
      warnings: []
    };
  }

  /**
   * Log block validation event
   * @param {string} type - Event type (validated, repaired, skipped, error)
   * @param {Object} block - Block being processed
   * @param {string} message - Log message
   */
  logBlockValidation(type, block, message) {
    if (!this.uploadReport) return;
    
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: type,
        blockType: block?.type || 'unknown',
        blockId: block?.id || null,
        message: message,
        blockStructure: block ? Object.keys(block) : []
      };
      
      this.uploadReport.blockValidation.push(logEntry);
      
      // Update summary counters
      switch (type) {
        case 'validated':
          this.uploadReport.summary.validBlocks++;
          break;
        case 'repaired':
          this.uploadReport.summary.repairedBlocks++;
          break;
        case 'skipped':
          this.uploadReport.summary.skippedBlocks++;
          break;
        case 'error':
          this.uploadReport.summary.errors++;
          break;
      }
      this.uploadReport.summary.totalBlocks++;
    } catch (error) {
      console.warn('Failed to log block validation:', error);
    }
  }

  /**
   * Log batch processing event
   * @param {string} type - Event type (created, processed, failed)
   * @param {number} batchIndex - Batch index
   * @param {number} blockCount - Number of blocks in batch
   * @param {string} message - Log message
   */
  logBatchProcessing(type, batchIndex, blockCount, message) {
    if (!this.uploadReport) return;
    
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: type,
        batchIndex: batchIndex,
        blockCount: blockCount,
        message: message
      };
      
      this.uploadReport.batchProcessing.push(logEntry);
      
      if (type === 'created') {
        this.uploadReport.summary.batches++;
      }
    } catch (error) {
      console.warn('Failed to log batch processing:', error);
    }
  }

  /**
   * Log API request/response
   * @param {string} method - HTTP method
   * @param {string} url - Request URL
   * @param {number} status - Response status
   * @param {Object} response - Response data
   * @param {string} error - Error message if any
   */
  logAPIRequest(method, url, status, response, error = null) {
    if (!this.uploadReport) return;
    
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        method: method,
        url: url,
        status: status,
        success: status >= 200 && status < 300,
        error: error,
        responseSize: JSON.stringify(response || {}).length
      };
      
      this.uploadReport.apiRequests.push(logEntry);
      this.uploadReport.summary.apiCalls++;
      
      if (error) {
        this.uploadReport.errors.push({
          timestamp: new Date().toISOString(),
          type: 'api_error',
          method: method,
          url: url,
          status: status,
          error: error,
          response: response
        });
        this.uploadReport.summary.errors++;
      }
    } catch (error) {
      console.warn('Failed to log API request:', error);
    }
  }

  /**
   * Log warning message
   * @param {string} type - Warning type
   * @param {string} message - Warning message
   * @param {Object} context - Additional context
   */
  logWarning(type, message, context = {}) {
    if (!this.uploadReport) return;
    
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: type,
        message: message,
        context: context
      };
      
      this.uploadReport.warnings.push(logEntry);
    } catch (error) {
      console.warn('Failed to log warning:', error);
    }
  }

  /**
   * Generate downloadable Notion Upload Report
   * @returns {Object} Report data and download info
   */
  generateUploadReport() {
    if (!this.uploadReport) {
      console.warn('No upload report available');
      return null;
    }
    
    try {
      this.uploadReport.endTime = new Date().toISOString();
      
      const duration = new Date(this.uploadReport.endTime) - new Date(this.uploadReport.startTime);
      const durationMinutes = Math.round(duration / 60000 * 100) / 100;
      
      const report = {
        ...this.uploadReport,
        summary: {
          ...this.uploadReport.summary,
          duration: `${durationMinutes} minutes`,
          successRate: this.uploadReport.summary.totalBlocks > 0 
            ? Math.round((this.uploadReport.summary.validBlocks + this.uploadReport.summary.repairedBlocks) / this.uploadReport.summary.totalBlocks * 100)
            : 0
        }
      };
      
      // Create downloadable content
      const reportContent = this.formatReportForDownload(report);
      
      return {
        report: report,
        downloadContent: reportContent,
        filename: `notion-upload-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      };
    } catch (error) {
      console.error('Failed to generate upload report:', error);
      return null;
    }
  }

  /**
   * Format report for download
   * @param {Object} report - Report data
   * @returns {string} Formatted report content
   */
  formatReportForDownload(report) {
    const humanReadable = {
      "📊 NOTION UPLOAD REPORT": "Generated by SIS compare tool + Env capture Extension",
      "⏰ Upload Session": {
        "Start Time": report.startTime,
        "End Time": report.endTime,
        "Duration": report.summary.duration
      },
      "📈 Summary Statistics": {
        "Total Blocks Processed": report.summary.totalBlocks,
        "Valid Blocks": report.summary.validBlocks,
        "Repaired Blocks": report.summary.repairedBlocks,
        "Skipped Blocks": report.summary.skippedBlocks,
        "Total Batches": report.summary.batches,
        "API Calls Made": report.summary.apiCalls,
        "Errors Encountered": report.summary.errors,
        "Success Rate": `${report.summary.successRate}%`
      },
      "🔍 Block Validation Details": report.blockValidation,
      "📦 Batch Processing Log": report.batchProcessing,
      "🌐 API Request Log": report.apiRequests,
      "❌ Errors": report.errors,
      "⚠️ Warnings": report.warnings,
      "🔧 Raw Logs": this.logs
    };
    
    return JSON.stringify(humanReadable, null, 2);
  }

  /**
   * Create a new page in Notion
   * @param {string} title - Page title
   * @param {string} parentId - Parent page/database ID
   * @param {Array} content - Page content blocks
   * @returns {Promise<Object>} Created page object
   */
  async createPage(title, parentId, content = []) {
    const url = `${this.baseURL}pages`;
    const body = {
      parent: {
        page_id: parentId
      },
      properties: {
        title: {
          title: [
            {
              text: {
                content: title
              }
            }
          ]
        }
      },
      children: content
    };

    // Log request
    this.logRequest('POST', url, body, this.headers);

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      const responseData = await response.json();

      if (!response.ok) {
        // Log error response
        this.logResponse('POST', url, response.status, responseData, responseData.message || 'Unknown error');
        throw new Error(`Notion API error: ${response.status} - ${responseData.message || 'Unknown error'}`);
      }

      // Log success response
      this.logResponse('POST', url, response.status, responseData);
      return responseData;
    } catch (error) {
      console.error('Error creating page:', error);
      throw error;
    }
  }

  /**
   * Archive (delete) a Notion page
   * @param {string} pageId - Page ID to archive
   * @returns {Promise<Object>} Archived page object
   */
  async archivePage(pageId) {
    const url = `${this.baseURL}pages/${pageId}`;
    const body = {
      archived: true
    };

    // Log request
    this.logRequest('PATCH', url, body, this.headers);

    try {
      const response = await this._fetch(url, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      const responseData = await response.json();

      if (!response.ok) {
        // Log error response
        this.logResponse('PATCH', url, response.status, responseData, responseData.message || 'Unknown error');
        throw new Error(`Notion API error: ${response.status} - ${responseData.message || 'Unknown error'}`);
      }

      // Log success response
      this.logResponse('PATCH', url, response.status, responseData);
      return responseData;
    } catch (error) {
      if (NotionClient.isCancellationError(error)) {
        console.log('archivePage cancelled by user');
        return Promise.reject(error);
      }
      console.error('Error archiving Notion page:', error);
      throw error;
    }
  }

  /**
   * Create a sub-page under a parent page following Notion's official guidelines
   * @param {string} title - Sub-page title
   * @param {string} parentPageId - Parent page ID
   * @param {string} content - Page content (markdown or text)
   * @param {string} contentType - Type of content ('markdown', 'json', 'text')
   * @param {Function} progressCallback - Progress callback function
   * @returns {Promise<Object>} Created sub-page object
   */
  async createSubPage(title, parentPageId, content, contentType = 'text', progressCallback = null) {
    try {
      // Step 1: Create the initial page (empty, just title and properties)
      if (progressCallback) {
        progressCallback(`Creating ${title}...`);
      }
      
      const url = `${this.baseURL}pages`;
      const body = {
        parent: {
          page_id: parentPageId
        },
        properties: {
          title: {
            title: [
              {
                text: {
                  content: title
                }
              }
            ]
          }
        }
        // No children in initial creation - following Notion's guidelines
      };

      // Log request
      this.logRequest('POST', url, body, this.headers);
      
      const pageResponse = await this._fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      const pageResponseData = await pageResponse.json();

      if (!pageResponse.ok) {
        // Log error response
        this.logResponse('POST', url, pageResponse.status, pageResponseData, pageResponseData.message || 'Unknown error');
        throw new Error(`Notion API error: ${pageResponse.status} - ${pageResponseData.message || 'Unknown error'}`);
      }

      // Log success response
      this.logResponse('POST', url, pageResponse.status, pageResponseData);
      const page = pageResponseData;
      
      // Step 2: Convert content to blocks and add them using append block children
      if (progressCallback) {
        progressCallback(`Converting content to Notion blocks...`);
      }
      const blocksResult = this.convertContentToBlocks(content, contentType, page.id, progressCallback);
      
      // Handle both sync and async block conversion
      let allBlocks;
      try {
        allBlocks = await Promise.resolve(blocksResult);
        
        // Validate that we have an array of blocks
        if (!Array.isArray(allBlocks)) {
          console.error('Block conversion did not return an array:', allBlocks);
          allBlocks = [this.createParagraphBlock('Error processing content')];
        }
      } catch (error) {
        if (NotionClient.isCancellationError(error)) {
          console.log('Block conversion cancelled by user');
          throw error;
        }
        console.error('Error in block conversion:', error);
        allBlocks = [this.createParagraphBlock(`Error processing content: ${error.message}`)];
      }
      const MAX_BLOCKS_PER_BATCH = 100;
      
      if (allBlocks.length === 0) {
        if (progressCallback) {
          progressCallback(`✓ Completed ${title} (no content)`);
        }
        return page;
      }
      
      if (progressCallback) {
        progressCallback(`Generated ${allBlocks.length} blocks, preparing batches...`);
      }
      
      // Step 3: Add blocks in batches using append block children endpoint
      const batches = this.createValidatedBatches(allBlocks, MAX_BLOCKS_PER_BATCH);
      
      for (let i = 0; i < batches.length; i++) {
        if (progressCallback) {
          progressCallback(`Uploading batch ${i + 1}/${batches.length} (${batches[i].length} blocks)...`);
        }
        
        try {
          await this.appendBlocksToPage(page.id, batches[i]);
          
          if (progressCallback) {
            progressCallback(`✓ Batch ${i + 1}/${batches.length} uploaded successfully`);
          }
        } catch (error) {
          if (NotionClient.isCancellationError(error)) {
            console.log('Batch append cancelled by user');
            throw error;
          }
          console.error(`Error uploading batch ${i + 1}:`, error);
          if (progressCallback) {
            progressCallback(`✗ Error uploading batch ${i + 1}: ${error.message}`);
          }
          // Continue with other batches
          continue;
        }
        
        // Rate limiting: 3 requests per second (333ms delay)
        if (i < batches.length - 1) {
          if (progressCallback) {
            progressCallback(`Rate limiting: waiting 350ms before next batch...`);
          }
          await this.delay(350);
        }
      }
      
      if (progressCallback) {
        progressCallback(`✓ Completed ${title} (${allBlocks.length} blocks in ${batches.length} batches)`);
      }
      
      return page;
    } catch (error) {
      if (NotionClient.isCancellationError(error)) {
        console.log('createSubPage cancelled by user');
        throw error;
      }
      console.error('Error creating sub-page:', error);
      throw error;
    }
  }

  /**
   * Chunk an array into smaller arrays
   * @param {Array} array - Array to chunk
   * @param {number} chunkSize - Size of each chunk
   * @returns {Array} Array of chunks
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Create validated batches that respect both block count and request size limits
   * @param {Array} blocks - Array of blocks to batch
   * @param {number} maxBlocksPerBatch - Maximum blocks per batch
   * @returns {Array} Array of validated batches
   */
  createValidatedBatches(blocks, maxBlocksPerBatch) {
    const MAX_REQUEST_SIZE = 200 * 1024; // 200KB to stay well under 1MB limit
    const MAX_BLOCK_SIZE = 50 * 1024; // 50KB max per individual block
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;
    let skippedBlocks = 0;
    let repairedBlocks = 0;

    console.log(`🔄 BATCHING: Processing ${blocks.length} blocks into batches...`);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      // Comprehensive validation with detailed logging
      console.log(`🔍 Processing block ${i + 1}/${blocks.length}: type="${block?.type || 'UNKNOWN'}"`);
      
      const validatedBlock = this.validateBlockStructure(block);
      if (!validatedBlock) {
        console.error(`❌ SKIPPED: Block ${i + 1} failed validation and could not be repaired`);
        skippedBlocks++;
        continue;
      }
      
      // Check if the block was repaired (different object reference or structure)
      if (validatedBlock !== block) {
        repairedBlocks++;
      }

      // Estimate block size
      const blockSize = this.estimateBlockSize(validatedBlock);
      
      // Check if individual block is too large
      if (blockSize > MAX_BLOCK_SIZE) {
        console.warn(`⚠️ LARGE BLOCK: Block ${i + 1} is ${Math.round(blockSize/1024)}KB, chunking...`);
        
        // Log warning for user feedback
        if (typeof this.logWarning === 'function') {
          this.logWarning('large_block', `Block ${i + 1} is ${Math.round(blockSize/1024)}KB and will be chunked`, {
            blockType: validatedBlock.type,
            originalSize: blockSize,
            maxSize: MAX_BLOCK_SIZE
          });
        }
        
        const chunkedBlocks = this.chunkLargeBlock(validatedBlock, MAX_BLOCK_SIZE);
        
        if (chunkedBlocks.length === 0) {
          console.error(`❌ CHUNKING FAILED: Block ${i + 1} could not be chunked, creating fallback`);
          
          // Log error for user feedback
          if (typeof this.logWarning === 'function') {
            this.logWarning('chunking_failed', `Block ${i + 1} could not be chunked and was replaced with fallback`, {
              blockType: validatedBlock.type,
              originalSize: blockSize,
              maxSize: MAX_BLOCK_SIZE
            });
          }
          
          const fallbackBlock = this.createParagraphBlock(`[Content too large - ${Math.round(blockSize/1024)}KB - could not be processed. Original content was ${Math.round(blockSize/1024)}KB but Notion's limit is ${Math.round(MAX_BLOCK_SIZE/1024)}KB per block.]`);
          currentBatch.push(fallbackBlock);
          currentSize += this.estimateBlockSize(fallbackBlock);
          continue;
        }
        
        // Log success for user feedback
        if (typeof this.logWarning === 'function') {
          this.logWarning('block_chunked', `Block ${i + 1} was successfully chunked into ${chunkedBlocks.length} parts`, {
            blockType: validatedBlock.type,
            originalSize: blockSize,
            chunkCount: chunkedBlocks.length
          });
        }
        
        for (const chunkedBlock of chunkedBlocks) {
          const chunkSize = this.estimateBlockSize(chunkedBlock);
          
          // If chunk is still too large, create fallback
          if (chunkSize > MAX_BLOCK_SIZE) {
            console.error(`❌ CHUNK TOO LARGE: Chunk is ${Math.round(chunkSize/1024)}KB, creating fallback`);
            const fallbackBlock = this.createParagraphBlock(`[Content too large - ${Math.round(chunkSize/1024)}KB - truncated]`);
            currentBatch.push(fallbackBlock);
            currentSize += this.estimateBlockSize(fallbackBlock);
            continue;
          }
          
          // Check if adding this chunk would exceed limits
          if (currentBatch.length >= maxBlocksPerBatch || 
              (currentSize + chunkSize > MAX_REQUEST_SIZE && currentBatch.length > 0)) {
            
            // Finalize current batch
            if (currentBatch.length > 0) {
              console.log(`📦 BATCH CREATED: ${currentBatch.length} blocks, ~${Math.round(currentSize/1024)}KB`);
              if (typeof this.logBatchProcessing === 'function') {
                this.logBatchProcessing('created', batches.length, currentBatch.length, `Batch created with ${currentBatch.length} blocks (~${Math.round(currentSize/1024)}KB)`);
              }
              batches.push(currentBatch);
              currentBatch = [];
              currentSize = 0;
            }
          }
          
          // Add chunked block to current batch
          currentBatch.push(chunkedBlock);
          currentSize += chunkSize;
        }
        continue;
      }
      
      // Check if adding this block would exceed limits
      if (currentBatch.length >= maxBlocksPerBatch || 
          (currentSize + blockSize > MAX_REQUEST_SIZE && currentBatch.length > 0)) {
        
        // Finalize current batch
        if (currentBatch.length > 0) {
          console.log(`📦 BATCH CREATED: ${currentBatch.length} blocks, ~${Math.round(currentSize/1024)}KB`);
          if (typeof this.logBatchProcessing === 'function') {
            this.logBatchProcessing('created', batches.length, currentBatch.length, `Batch created with ${currentBatch.length} blocks (~${Math.round(currentSize/1024)}KB)`);
          }
          batches.push(currentBatch);
          currentBatch = [];
          currentSize = 0;
        }
      }
      
      // Add validated block to current batch
      currentBatch.push(validatedBlock);
      currentSize += blockSize;
      
      // Double-check that we haven't exceeded the limit after adding the block
      if (currentBatch.length > maxBlocksPerBatch) {
        console.error(`❌ CRITICAL: Batch exceeded limit! ${currentBatch.length} blocks (max: ${maxBlocksPerBatch})`);
        // Remove the last block and create a new batch
        const lastBlock = currentBatch.pop();
        currentSize -= this.estimateBlockSize(lastBlock);
        
        // Finalize current batch
        if (currentBatch.length > 0) {
          console.log(`📦 EMERGENCY BATCH: ${currentBatch.length} blocks, ~${Math.round(currentSize/1024)}KB`);
          batches.push(currentBatch);
          currentBatch = [];
          currentSize = 0;
        }
        
        // Add the last block to a new batch
        currentBatch.push(lastBlock);
        currentSize += this.estimateBlockSize(lastBlock);
      }
    }
    
    // Add final batch if not empty
    if (currentBatch.length > 0) {
      // Final validation - ensure no batch exceeds the limit
      if (currentBatch.length > maxBlocksPerBatch) {
        console.error(`❌ CRITICAL: Final batch exceeded limit! ${currentBatch.length} blocks (max: ${maxBlocksPerBatch})`);
        // Split the final batch into smaller chunks
        const chunks = this.chunkArray(currentBatch, maxBlocksPerBatch);
        chunks.forEach((chunk, index) => {
          console.log(`📦 FINAL BATCH CHUNK ${index + 1}: ${chunk.length} blocks`);
          if (typeof this.logBatchProcessing === 'function') {
            this.logBatchProcessing('created', batches.length, chunk.length, `Final batch chunk ${index + 1} created with ${chunk.length} blocks`);
          }
          batches.push(chunk);
        });
      } else {
        console.log(`📦 FINAL BATCH: ${currentBatch.length} blocks, ~${Math.round(currentSize/1024)}KB`);
        if (typeof this.logBatchProcessing === 'function') {
          this.logBatchProcessing('created', batches.length, currentBatch.length, `Final batch created with ${currentBatch.length} blocks (~${Math.round(currentSize/1024)}KB)`);
        }
        batches.push(currentBatch);
      }
    }
    
    console.log(`✅ BATCHING COMPLETE: ${batches.length} batches created, ${repairedBlocks} blocks repaired, ${skippedBlocks} blocks skipped`);
    
    return batches;
  }

  /**
   * Validate and fix block structure to ensure Notion API compliance
   * @param {Object} block - Block to validate
   * @returns {Object|null} Valid block or null if unfixable
   */
  validateBlockStructure(block) {
    if (!block || typeof block !== 'object') {
      console.error('❌ CRITICAL: Block is not an object:', JSON.stringify(block, null, 2));
      return null;
    }

    if (!block.type) {
      console.error('❌ CRITICAL: Block missing type property:', JSON.stringify(block, null, 2));
      return null;
    }

    // Log all blocks for debugging
    console.log(`🔍 VALIDATING BLOCK: type="${block.type}", hasTypeProperty=${!!block[block.type]}`);
    
    // Ensure block has the required type-specific property
    const requiredProperty = block.type;
    if (!block[requiredProperty]) {
      console.error(`❌ CRITICAL: Block of type '${block.type}' missing required property '${requiredProperty}':`);
      console.error('Full block structure:', JSON.stringify(block, null, 2));
      console.error('Available properties:', Object.keys(block));
      
      // Safe logging (check if method exists)
      if (typeof this.logBlockValidation === 'function') {
        this.logBlockValidation('error', block, `Missing required property '${requiredProperty}'`);
      }
      
      // Try to fix common issues with comprehensive auto-repair
      const fixedBlock = this.autoRepairBlock(block);
      if (fixedBlock) {
        console.log(`✅ AUTO-REPAIRED: Block of type '${block.type}' was fixed`);
        if (typeof this.logBlockValidation === 'function') {
          this.logBlockValidation('repaired', fixedBlock, `Auto-repaired missing '${requiredProperty}' property`);
        }
        return fixedBlock;
      } else {
        console.error(`❌ UNFIXABLE: Cannot repair block of type '${block.type}' - creating fallback paragraph`);
        const fallbackBlock = this.createParagraphBlock(`[ERROR: Malformed ${block.type} block - content lost]`);
        if (typeof this.logBlockValidation === 'function') {
          this.logBlockValidation('skipped', block, `Unfixable block replaced with fallback paragraph`);
        }
        return fallbackBlock;
      }
    }

    // Validate rich_text content and fix URL length issues
    this.validateAndFixRichText(block);

    // Ensure block has object property
    if (!block.object) {
      block.object = 'block';
    }

    // Special debugging for table blocks
    if (block.type === 'table') {
      console.log(`🔍 TABLE VALIDATION: Table block structure:`, JSON.stringify(block, null, 2));
      if (block.table && block.table.children === undefined) {
        console.error(`❌ TABLE ERROR: children property is undefined!`);
        block.table.children = [];
      }
    }

    console.log(`✅ VALIDATED: Block of type '${block.type}' is valid`);
    if (typeof this.logBlockValidation === 'function') {
      this.logBlockValidation('validated', block, `Block structure is valid`);
    }
    return block;
  }

  /**
   * Auto-repair malformed blocks with comprehensive type support
   * @param {Object} block - Block to repair
   * @returns {Object|null} Repaired block or null if unfixable
   */
  autoRepairBlock(block) {
    const blockType = block.type;
    const fallbackContent = `Error: Missing ${blockType} content`;
    
    try {
      switch (blockType) {
        case 'paragraph':
          block.paragraph = {
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'heading_1':
        case 'heading_2': 
        case 'heading_3':
          block[blockType] = {
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'code':
          block.code = {
            language: 'text',
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'bulleted_list_item':
          block.bulleted_list_item = {
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'numbered_list_item':
          block.numbered_list_item = {
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'quote':
          block.quote = {
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'callout':
          block.callout = {
            icon: { emoji: '⚠️' },
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'toggle':
          block.toggle = {
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'to_do':
          block.to_do = {
            checked: false,
            rich_text: [{ type: 'text', text: { content: fallbackContent } }]
          };
          return block;
          
        case 'divider':
          block.divider = {};
          return block;
          
        case 'table_row':
          // For table rows, we need to ensure cells exist
          if (!block.table_row) {
            block.table_row = {
              cells: [[{ type: 'text', text: { content: fallbackContent } }]]
            };
          }
          return block;
          
        case 'table':
          // For tables, ensure basic structure
          if (!block.table) {
            block.table = {
              table_width: 1,
              has_column_header: false,
              has_row_header: false,
              children: []
            };
          }
          return block;
          
        default:
          console.error(`❌ UNKNOWN BLOCK TYPE: '${blockType}' - cannot auto-repair`);
          return null;
      }
    } catch (error) {
      console.error(`❌ ERROR during auto-repair of '${blockType}':`, error);
      return null;
    }
  }

  /**
   * Validate and fix rich_text content, including URL length limits
   * @param {Object} block - Block to validate rich_text for
   */
  validateAndFixRichText(block) {
    const richTextPaths = [
      ['paragraph', 'rich_text'],
      ['heading_1', 'rich_text'],
      ['heading_2', 'rich_text'],
      ['heading_3', 'rich_text'],
      ['code', 'rich_text'],
      ['bulleted_list_item', 'rich_text'],
      ['numbered_list_item', 'rich_text']
    ];

    for (const [blockType, richTextKey] of richTextPaths) {
      if (block.type === blockType && block[blockType] && block[blockType][richTextKey]) {
        const richTextArray = block[blockType][richTextKey];
        
        for (let i = 0; i < richTextArray.length; i++) {
          const richTextItem = richTextArray[i];
          
          // Check for URL length violations
          if (richTextItem.text && richTextItem.text.link && richTextItem.text.link.url) {
            const url = richTextItem.text.link.url;
            
            if (url.length > 2000) {
              console.warn(`URL too long (${url.length} chars), removing link: ${url.substring(0, 100)}...`);
              
              // Remove the link but keep the text
              delete richTextItem.text.link;
              
              // Add a note about the removed link
              if (richTextItem.text.content) {
                richTextItem.text.content += ' [Link removed - too long for Notion]';
              }
            }
          }
          
          // Ensure text content exists and is not too long
          if (richTextItem.text && richTextItem.text.content) {
            if (richTextItem.text.content.length > 2000) {
              console.warn(`Text content too long (${richTextItem.text.content.length} chars), will be split into multiple blocks`);
              // Don't truncate - this will be handled by chunking at a higher level
              // Just log the warning for now
            }
          }
        }
      }
    }
    
    // Validate table cell content
    if (block.type === 'table' && block.table && block.table.children && Array.isArray(block.table.children)) {
      for (const tableRow of block.table.children) {
        if (tableRow && tableRow.type === 'table_row' && tableRow.table_row && tableRow.table_row.cells) {
          for (const cell of tableRow.table_row.cells) {
            if (Array.isArray(cell)) {
              for (const cellContent of cell) {
                if (cellContent && cellContent.text && cellContent.text.content) {
                  if (cellContent.text.content.length > 2000) {
                    console.warn(`Table cell content too long (${cellContent.text.content.length} chars), will be handled by table splitting`);
                    // Don't truncate - this will be handled by table splitting at a higher level
                    // Just log the warning for now
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Estimate the size of a block in bytes
   * @param {Object} block - Block to estimate
   * @returns {number} Estimated size in bytes
   */
  estimateBlockSize(block) {
    try {
      const jsonString = JSON.stringify(block);
      return new Blob([jsonString]).size;
    } catch (error) {
      console.error('Error estimating block size:', error);
      return 1000; // Default estimate
    }
  }

  /**
   * Chunk a large block into smaller blocks
   * @param {Object} block - Block to chunk
   * @param {number} maxSize - Maximum size per chunk
   * @returns {Array} Array of chunked blocks
   */
  chunkLargeBlock(block, maxSize) {
    const chunks = [];
    
    // Only chunk text-based blocks
    if (block.type === 'paragraph' && block.paragraph && block.paragraph.rich_text) {
      const textContent = block.paragraph.rich_text[0]?.text?.content || '';
      if (textContent.length > 1800) { // Increased threshold to avoid unnecessary chunking
        const textChunks = this.chunkTextIntelligently(textContent, 1800);
        textChunks.forEach((chunk, index) => {
          // Add continuation indicator for multi-part content
          const chunkContent = textChunks.length > 1 ? 
            (index === 0 ? `[Part ${index + 1}/${textChunks.length}] ${chunk}` :
             index === textChunks.length - 1 ? `[Part ${index + 1}/${textChunks.length}] ${chunk}` :
             `[Part ${index + 1}/${textChunks.length}] ${chunk}`) : chunk;
          
          chunks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: {
                  content: chunkContent,
                  link: null
                },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default'
                },
                plain_text: chunkContent,
                href: null
              }],
              color: 'default'
            }
          });
        });
      } else {
        chunks.push(block);
      }
    } else if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
      const headingType = block.type;
      const textContent = block[headingType]?.rich_text[0]?.text?.content || '';
      if (textContent.length > 1800) { // Increased threshold to avoid unnecessary chunking
        const textChunks = this.chunkTextIntelligently(textContent, 1800);
        textChunks.forEach((chunk, index) => {
          // Add continuation indicator for multi-part headings
          const chunkContent = textChunks.length > 1 ? 
            `[Part ${index + 1}/${textChunks.length}] ${chunk}` : chunk;
          
          chunks.push({
            object: 'block',
            type: headingType,
            [headingType]: {
              rich_text: [{
                type: 'text',
                text: {
                  content: chunkContent,
                  link: null
                },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default'
                },
                plain_text: chunkContent,
                href: null
              }],
              color: 'default',
              is_toggleable: false
            }
          });
        });
      } else {
        chunks.push(block);
      }
    } else {
      // For non-text blocks, just return as-is
      chunks.push(block);
    }
    
    return chunks;
  }

  /**
   * Add a delay between API calls
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Append content blocks to an existing page using Notion's official append block children endpoint
   * Automatically handles table conversion to two-phase chunking
   * @param {string} pageId - Page ID
   * @param {Array} blocks - Content blocks to add
   * @param {Function} progressCallback - Optional progress callback
   * @returns {Promise<Object>} Response object
   */
  async appendBlocksToPage(pageId, blocks, progressCallback = null) {
    console.log(`🚀 APPEND REQUEST: Starting append for ${blocks.length} blocks to page ${pageId}`);
    
    // Pre-process blocks to handle tables with two-phase chunking
    const processedBlocks = await this.preprocessBlocksForTables(pageId, blocks, progressCallback);
    
    console.log(`📋 PROCESSED BLOCKS: ${processedBlocks.length} blocks after preprocessing`);
    
    // Enforce text length limits (≤2000 chars per rich_text item) before final validation
    const lengthValidatedBlocks = this.validateBlocks(processedBlocks, 2000);
    
    // Final validation before sending to API
    const finalValidatedBlocks = [];
    for (let i = 0; i < lengthValidatedBlocks.length; i++) {
      const block = lengthValidatedBlocks[i];
      console.log(`🔍 FINAL CHECK: Block ${i}: type="${block?.type}", hasTypeProperty=${!!(block && block[block?.type])}`);
      
      if (!block || !block.type || !block[block.type]) {
        console.error(`❌ FINAL VALIDATION FAILED: Block ${i} is malformed:`, JSON.stringify(block, null, 2));
        // Create emergency fallback
        const fallbackBlock = this.createParagraphBlock(`[ERROR: Block ${i} was malformed and replaced]`);
        finalValidatedBlocks.push(fallbackBlock);
        console.log(`🆘 EMERGENCY FALLBACK: Created fallback paragraph for block ${i}`);
      } else {
        finalValidatedBlocks.push(block);
      }
    }
    
    // Use Notion's maximum batch size of 100 blocks per request
    // This dramatically reduces API calls (was 25, now 100 = 4x fewer requests)
    const MAX_BLOCKS_PER_BATCH = 100;
    const batches = this.createValidatedBatches(finalValidatedBlocks, MAX_BLOCKS_PER_BATCH);
    
    console.log(`📦 BATCHING: Created ${batches.length} batches for ${finalValidatedBlocks.length} blocks`);
    
    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`📤 SENDING BATCH ${i + 1}/${batches.length}: ${batch.length} blocks`);
      
      if (progressCallback) {
        progressCallback(`Uploading batch ${i + 1}/${batches.length} (${batch.length} blocks)...`);
      }
      
      const maxRetries = 3;
      let retryCount = 0;
      const url = `${this.baseURL}blocks/${pageId}/children`;
      const body = { children: batch };
      
      while (retryCount < maxRetries) {
        try {
          // Log request
          this.logRequest('PATCH', url, body, this.headers);
          
          const response = await this._fetch(url, {
            method: 'PATCH',
            headers: this.headers,
            body: JSON.stringify(body)
          });

          const responseData = await response.json();

          if (response.ok) {
            // Log success response
            this.logResponse('PATCH', url, response.status, responseData);
            if (typeof this.logAPIRequest === 'function') {
              this.logAPIRequest('PATCH', url, response.status, responseData);
            }
            console.log(`✅ BATCH ${i + 1} SUCCESS: ${batch.length} blocks appended successfully`);
            break; // Success, exit retry loop
          }

          // Handle rate limiting (429) with exponential backoff
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, retryCount) * 1000;
            
            // Log rate limit response
            this.logResponse('PATCH', url, response.status, responseData, 'Rate limited');
            
            console.log(`Rate limited. Retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            await this.delay(delay);
            retryCount++;
            continue;
          }

          // Handle validation errors with detailed logging
          if (response.status === 400) {
            console.error(`❌ VALIDATION ERROR: Notion API rejected the request:`);
            console.error('Response:', JSON.stringify(responseData, null, 2));
            console.error('Request body structure:');
            batch.forEach((block, blockIndex) => {
              console.error(`  Block ${blockIndex}: type="${block.type}", properties=[${Object.keys(block).join(', ')}]`);
            });
          }

          // Handle other errors
          this.logResponse('PATCH', url, response.status, responseData, responseData.message || 'Unknown error');
          if (typeof this.logAPIRequest === 'function') {
            this.logAPIRequest('PATCH', url, response.status, responseData, responseData.message || 'Unknown error');
          }
          throw new Error(`Notion API error: ${response.status} - ${responseData.message || 'Unknown error'}`);
          
        } catch (error) {
          if (NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
            console.log('Append batch cancelled by user');
            throw error;
          }
          if (retryCount >= maxRetries - 1) {
            console.error(`❌ BATCH ${i + 1} FAILED: Error appending blocks to Notion page:`, error);
            throw error;
          }
          
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000;
          console.log(`Batch ${i + 1} failed. Retrying after ${delay}ms (attempt ${retryCount}/${maxRetries})`);
          await this.delay(delay);
        }
      }
      
      // Rate limiting between batches
      if (i < batches.length - 1) {
        if (progressCallback) {
          progressCallback(`Rate limiting: waiting 350ms before next batch...`);
        }
        await this.delay(350);
      }
    }
    
    console.log(`✅ ALL BATCHES COMPLETE: ${finalValidatedBlocks.length} blocks uploaded in ${batches.length} batches`);
    return { success: true, batches: batches.length, totalBlocks: finalValidatedBlocks.length };
  }

  /**
   * Preprocess blocks to handle table conversion to two-phase chunking
   * @param {string} pageId - Page ID
   * @param {Array} blocks - Original blocks
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Array>} Processed blocks
   */
  async preprocessBlocksForTables(pageId, blocks, progressCallback = null) {
    const processedBlocks = [];
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      // Check if this is a table block that needs two-phase processing
      if (block.type === 'table' && block.table._originalHeaders && block.table._originalDataRows) {
        if (progressCallback) {
          progressCallback(`Converting table to two-phase format...`);
        }
        
        // Initialize SimpleTableBuilder if needed
        if (!this.simpleTableBuilder) {
          this.simpleTableBuilder = new SimpleTableBuilder(this);
        }
        
        // Create the table using two-phase approach
        // This will create the table directly and return a reference block
        try {
          const tableResult = await this.simpleTableBuilder.createLargeTable(
            pageId,
            block.table._originalHeaders,
            block.table._originalDataRows,
            null, // No title, it should be in a separate heading block
            progressCallback
          );
          
          // Skip adding this block since the table was created directly
          // The table is already in the page, so we don't need to add it to processedBlocks
          continue;
          
        } catch (error) {
          if (NotionClient.isCancellationError(error)) {
            console.log('Table creation cancelled by user');
            throw error;
          }
          console.error('Error creating table with two-phase approach:', error);
          if (progressCallback) {
            progressCallback(`Error creating table: ${error.message}`);
          }
          // Fall back to text format (only on genuine failures)
          const textBlocks = this.convertLargeTableToText(
            block.table._originalHeaders,
            block.table._originalDataRows
          );
          if (Array.isArray(textBlocks)) {
            processedBlocks.push(...textBlocks);
          } else {
            console.error('convertLargeTableToText did not return an array:', textBlocks);
            processedBlocks.push(this.createParagraphBlock('Error processing table data'));
          }
        }
      } else {
        // Regular block, add as-is
        processedBlocks.push(block);
      }
    }
    
    return processedBlocks;
  }

  /**
   * Add content blocks to an existing page (legacy method for compatibility)
   * @param {string} pageId - Page ID
   * @param {Array} blocks - Content blocks to add
   * @returns {Promise<Object>} Response object
   */
  async addBlocksToPage(pageId, blocks) {
    return this.appendBlocksToPage(pageId, blocks);
  }

  /**
   * Create a file block for uploading files
   * @param {string} fileName - Name of the file
   * @param {string} fileUrl - URL of the uploaded file
   * @returns {Object} File block object
   */
  createFileBlock(fileName, fileUrl) {
    return {
      object: 'block',
      type: 'file',
      file: {
        type: 'external',
        name: fileName,
        external: {
          url: fileUrl
        }
      }
    };
  }

  /**
   * Create a heading block
   * @param {string} text - Heading text
   * @param {number} level - Heading level (1-3)
   * @returns {Object} Heading block object
   */
  createHeadingBlock(text, level = 2) {
    // Clamp heading level to Notion-supported range 1..3
    const safeLevel = Math.max(1, Math.min(3, Number(level) || 2));
    const blockType = `heading_${safeLevel}`;
    const content = String(text || '');
    const block = {
      object: 'block',
      type: blockType,
      [blockType]: {
        rich_text: this.createRichTextArrayFromString(content),
        color: 'default',
        is_toggleable: false
      }
    };
    
    console.log(`🏗️ CREATED HEADING${safeLevel}: "${content.substring(0, 50)}..."`);
    return block;
  }

  /**
   * Create a paragraph block
   * @param {string} text - Paragraph text
   * @returns {Object} Paragraph block object
   */
  createParagraphBlock(text) {
    const content = String(text || '');
    const block = {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: this.createRichTextArrayFromString(content),
        color: 'default'
      }
    };
    
    console.log(`🏗️ CREATED PARAGRAPH: "${content.substring(0, 50)}..."`);
    return block;
  }

  /**
   * Create a divider block
   * @returns {Object} Divider block object
   */
  createDividerBlock() {
    return {
      object: 'block',
      type: 'divider',
      divider: {}
    };
  }

  /**
   * Convert content to Notion blocks based on content type with chunking
   * Enhanced with intelligent JSON processing
   * @param {string} content - Content to convert
   * @param {string} contentType - Type of content ('markdown', 'json', 'text')
   * @param {string} pageId - Optional page ID for file attachments
   * @param {Function} progressCallback - Optional progress callback
   * @returns {Promise<Array>|Array} Array of Notion blocks (chunked to respect limits)
   */
  convertContentToBlocks(content, contentType, pageId = null, progressCallback = null) {
    // Initialize JSON processor if needed
    this.jsonProcessor = new ContentProcessor(this);

    // Check if content contains JSON that should be processed specially
    if (this.shouldUseJSONProcessor(content, contentType)) {
      // Return promise for async JSON processing
      return this.jsonProcessor.handleJSONContent(content, pageId, progressCallback);
    }

    // Standard synchronous processing for non-JSON content
    return this.convertContentToBlocksSync(content, contentType);
  }

  /**
   * Determine if content should use JSON processor
   * @param {string} content - Content to analyze
   * @param {string} contentType - Content type
   * @returns {boolean} True if should use JSON processor
   */
  shouldUseJSONProcessor(content, contentType) {
    if (contentType === 'json') {
      return true;
    }

    // Check for JSON patterns in markdown/text content
    const hasJSONCodeBlocks = /```json[\s\S]*?```/i.test(content);
    
    // Check for potentially large JSON objects/arrays by looking for multi-line structures
    const hasMultiLineJSONObjects = /\{[\s\S]*?\n[\s\S]*?\}/.test(content);
    const hasMultiLineJSONArrays = /\[[\s\S]*?\n[\s\S]*?\]/.test(content);

    return hasJSONCodeBlocks || hasMultiLineJSONObjects || hasMultiLineJSONArrays;
  }

  /**
   * Synchronous version of content conversion (legacy behavior)
   * @param {string} content - Content to convert
   * @param {string} contentType - Type of content ('markdown', 'json', 'text')
   * @returns {Array} Array of Notion blocks (chunked to respect limits)
   */
  convertContentToBlocksSync(content, contentType) {
    const blocks = [];
    const MAX_TEXT_LENGTH = 2000;
    
    if (contentType === 'json') {
      // For JSON content, convert to readable text format instead of code blocks
      try {
        const jsonObj = JSON.parse(content);
        const readableText = this.convertJsonToReadableText(jsonObj);
        const chunks = this.chunkText(readableText, MAX_TEXT_LENGTH);
        chunks.forEach(chunk => {
          blocks.push(this.createParagraphBlock(chunk));
        });
      } catch (error) {
        // If JSON parsing fails, treat as plain text
        const chunks = this.chunkText(content, MAX_TEXT_LENGTH);
        chunks.forEach(chunk => {
          blocks.push(this.createParagraphBlock(chunk));
        });
      }
    } else if (contentType === 'markdown') {
      // For markdown content, parse and convert to blocks with chunking
      const improvedContent = this.improveContentFormatting(content);
      const lines = improvedContent.split('\n');
      let currentParagraph = '';
      let inTable = false;
      let tableLines = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if we're starting a table
        if (this.isTableLine(line)) {
          if (!inTable) {
            // Finish current paragraph
            if (currentParagraph.trim()) {
              const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
              chunks.forEach(chunk => {
                blocks.push(this.createParagraphBlock(chunk));
              });
              currentParagraph = '';
            }
            inTable = true;
            tableLines = [line];
          } else {
            tableLines.push(line);
          }
          continue;
        }
        
        // Check if we're ending a table
        if (inTable && !this.isTableLine(line)) {
          // Convert table to Notion database
          const tableBlocks = this.convertTableToNotionDatabase(tableLines);
          blocks.push(...tableBlocks);
          inTable = false;
          tableLines = [];
        }
        
        if (inTable) {
          continue;
        }
        
        // Regular markdown processing
        if (line.trim() === '') {
          if (currentParagraph.trim()) {
            const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createParagraphBlock(chunk));
            });
            currentParagraph = '';
          }
        } else if (line.startsWith('# ')) {
          if (currentParagraph.trim()) {
            const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createParagraphBlock(chunk));
            });
            currentParagraph = '';
          }
          const headingText = line.substring(2);
          if (headingText.length > MAX_TEXT_LENGTH) {
            const chunks = this.chunkText(headingText, MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createHeadingBlock(chunk, 1));
            });
          } else {
            blocks.push(this.createHeadingBlock(headingText, 1));
          }
        } else if (line.startsWith('## ')) {
          if (currentParagraph.trim()) {
            const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createParagraphBlock(chunk));
            });
            currentParagraph = '';
          }
          const headingText = line.substring(3);
          if (headingText.length > MAX_TEXT_LENGTH) {
            const chunks = this.chunkText(headingText, MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createHeadingBlock(chunk, 2));
            });
          } else {
            blocks.push(this.createHeadingBlock(headingText, 2));
          }
        } else if (line.startsWith('### ')) {
          if (currentParagraph.trim()) {
            const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createParagraphBlock(chunk));
            });
            currentParagraph = '';
          }
          const headingText = line.substring(4);
          if (headingText.length > MAX_TEXT_LENGTH) {
            const chunks = this.chunkText(headingText, MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createHeadingBlock(chunk, 3));
            });
          } else {
            blocks.push(this.createHeadingBlock(headingText, 3));
          }
        } else if (line.startsWith('- ')) {
          if (currentParagraph.trim()) {
            const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
            chunks.forEach(chunk => {
              blocks.push(this.createParagraphBlock(chunk));
            });
            currentParagraph = '';
          }
          const listContent = line.substring(2);
          const chunks = this.chunkText(listContent, MAX_TEXT_LENGTH);
          chunks.forEach(chunk => {
            blocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{
                  type: 'text',
                  text: {
                    content: chunk,
                    link: null
                  },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: 'default'
                  },
                  plain_text: chunk,
                  href: null
                }],
                color: 'default'
              }
            });
          });
        } else {
          currentParagraph += (currentParagraph ? '\n' : '') + line;
        }
      }
      
      // Handle any remaining table
      if (inTable && tableLines.length > 0) {
        const tableBlocks = this.convertTableToNotionDatabase(tableLines);
        blocks.push(...tableBlocks);
      }
      
      // Handle any remaining paragraph
      if (currentParagraph.trim()) {
        const chunks = this.chunkText(currentParagraph.trim(), MAX_TEXT_LENGTH);
        chunks.forEach(chunk => {
          blocks.push(this.createParagraphBlock(chunk));
        });
      }
    } else {
      // For plain text, create paragraph blocks with chunking
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const chunks = this.chunkText(line, MAX_TEXT_LENGTH);
          chunks.forEach(chunk => {
            blocks.push(this.createParagraphBlock(chunk));
          });
        }
      }
    }
    
    // Final validation - ensure no block exceeds the limit
    return this.validateBlocks(blocks, MAX_TEXT_LENGTH);
  }

  /**
   * Chunk text into smaller pieces following Notion's guidelines
   * Chunks at natural breaks (paragraphs, sentences) to maintain readability
   * @param {string} text - Text to chunk
   * @param {number} maxLength - Maximum length per chunk (default 2000)
   * @returns {Array} Array of text chunks
   */
  chunkText(text, maxLength = 2000) {
    if (text.length <= maxLength) {
      return [text];
    }
    
    const chunks = [];
    const paragraphs = text.split('\n\n'); // Split by double newlines (paragraphs)
    
    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxLength) {
        chunks.push(paragraph.trim());
      } else {
        // If paragraph is too long, split by sentences
        const sentences = this.splitIntoSentences(paragraph);
        let currentChunk = '';
        
        for (const sentence of sentences) {
          // If a single sentence is too long, force chunk it
          if (sentence.length > maxLength) {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
            const forceChunks = this.forceChunkText(sentence, maxLength);
            chunks.push(...forceChunks);
          } else if (currentChunk.length + sentence.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
          } else {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
          }
        }
        
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
      }
    }
    
    // Final validation - ensure no chunk exceeds maxLength
    const validatedChunks = [];
    for (const chunk of chunks) {
      if (chunk.length <= maxLength) {
        validatedChunks.push(chunk);
      } else {
        // Prefer newline boundaries before the limit
        const safeChunks = this.splitTextPreferNewlines(chunk, maxLength);
        validatedChunks.push(...safeChunks);
      }
    }
    
    return validatedChunks.filter(chunk => chunk.trim().length > 0);
  }

  /**
   * Intelligently chunk text with better preservation of content structure
   * @param {string} text - Text to chunk
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array} Array of text chunks
   */
  chunkTextIntelligently(text, maxLength = 1800) {
    if (text.length <= maxLength) {
      return [text];
    }
    
    const chunks = [];
    
    // First, try to split by major structural elements
    const majorSplits = text.split(/\n\n+|\n\s*[-=*]{3,}\s*\n/);
    
    for (const section of majorSplits) {
      if (section.trim().length === 0) continue;
      
      if (section.length <= maxLength) {
        chunks.push(section.trim());
      } else {
        // For large sections, try to split by paragraphs
        const paragraphs = section.split('\n');
        let currentChunk = '';
        
        for (const paragraph of paragraphs) {
          if (paragraph.trim().length === 0) {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
            continue;
          }
          
          // If single paragraph is too long, split it
          if (paragraph.length > maxLength) {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
            const paragraphChunks = this.chunkLongParagraph(paragraph, maxLength);
            chunks.push(...paragraphChunks);
          } else if (currentChunk.length + paragraph.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? '\n' : '') + paragraph;
          } else {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = paragraph;
          }
        }
        
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
      }
    }
    
    // If no major splits worked, fall back to sentence-based chunking
    if (chunks.length === 0) {
      return this.chunkText(text, maxLength);
    }
    
    return chunks.filter(chunk => chunk.trim().length > 0);
  }

  /**
   * Chunk a long paragraph intelligently
   * @param {string} paragraph - Paragraph to chunk
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array} Array of paragraph chunks
   */
  chunkLongParagraph(paragraph, maxLength) {
    const chunks = [];
    const sentences = this.splitIntoSentences(paragraph);
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if (sentence.length > maxLength) {
        // If single sentence is too long, force chunk it
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const forceChunks = this.forceChunkText(sentence, maxLength);
        chunks.push(...forceChunks);
      } else if (currentChunk.length + sentence.length + 1 <= maxLength) {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      } else {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  /**
   * Split text into sentences for better chunking
   * @param {string} text - Text to split
   * @returns {Array} Array of sentences
   */
  splitIntoSentences(text) {
    // Split by sentence endings, but be careful with abbreviations
    const sentences = text.split(/(?<=[.!?])\s+/);
    const filteredSentences = sentences.filter(sentence => sentence.trim().length > 0);
    
    // If no sentences found (no sentence endings), split by line breaks
    if (filteredSentences.length === 0) {
      return text.split('\n').filter(line => line.trim().length > 0);
    }
    
    return filteredSentences;
  }

  /**
   * Split a very long line into smaller chunks
   * @param {string} line - Line to split
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array} Array of line chunks
   */
  splitLongLine(line, maxLength) {
    const chunks = [];
    let start = 0;
    
    while (start < line.length) {
      let end = Math.min(start + maxLength, line.length);
      
      // Try to break at a word boundary
      if (end < line.length) {
        const lastSpace = line.lastIndexOf(' ', end);
        if (lastSpace > start) {
          end = lastSpace;
        }
      }
      
      chunks.push(line.substring(start, end));
      start = end + (end < line.length ? 1 : 0);
    }
    
    return chunks;
  }

  /**
   * Split text preferring newline boundaries before maxLen, then space, then hard cut.
   * Trims trailing/leading whitespace at split points.
   * @param {string} text
   * @param {number} maxLen
   * @returns {Array<string>} chunks
   */
  splitTextPreferNewlines(text, maxLen) {
    const chunks = [];
    let remaining = String(text || '');
    while (remaining.length > maxLen) {
      const windowText = remaining.slice(0, maxLen + 1);
      let cut = windowText.lastIndexOf('\n');
      if (cut <= 0) {
        cut = windowText.lastIndexOf(' ');
      }
      if (cut <= 0) {
        cut = maxLen;
      }
      const head = remaining.slice(0, cut).replace(/[\s\n]+$/,'');
      chunks.push(head);
      remaining = remaining.slice(cut).replace(/^[\s\n]+/,'');
    }
    if (remaining.length) chunks.push(remaining);
    return chunks;
  }

  /**
   * Force chunk text by splitting at exact character limits
   * @param {string} text - Text to chunk
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array} Array of text chunks
   */
  forceChunkText(text, maxLength) {
    // Prefer newline boundaries instead of hard cuts
    return this.splitTextPreferNewlines(text, maxLength);
  }

  /**
   * Smart truncation that preserves important content at beginning and end
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  smartTruncateText(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }
    
    // Leave room for truncation indicator
    const availableLength = maxLength - 50;
    const startLength = Math.floor(availableLength * 0.6); // 60% at the beginning
    const endLength = Math.floor(availableLength * 0.4); // 40% at the end
    
    const startPart = text.substring(0, startLength);
    const endPart = text.substring(text.length - endLength);
    
    // Try to break at word boundaries
    const lastSpace = startPart.lastIndexOf(' ');
    const firstSpace = endPart.indexOf(' ');
    
    let finalStart = startPart;
    let finalEnd = endPart;
    
    if (lastSpace > startLength * 0.8) { // If we can break at a reasonable word boundary
      finalStart = startPart.substring(0, lastSpace);
    }
    
    if (firstSpace < endLength * 0.2 && firstSpace > 0) { // If we can break at a reasonable word boundary
      finalEnd = endPart.substring(firstSpace + 1);
    }
    
    const truncatedLength = text.length - finalStart.length - finalEnd.length;
    return `${finalStart}... [${truncatedLength} chars truncated] ...${finalEnd}`;
  }

  /**
   * Create a code block
   * @param {string} content - Code content
   * @param {string} language - Programming language
   * @returns {Object} Code block object
   */
  createCodeBlock(content, language = 'text') {
    return {
      object: 'block',
      type: 'code',
      code: {
        language: language,
        rich_text: [{
          type: 'text',
          text: {
            content: content
          }
        }]
      }
    };
  }

  /**
   * Validate that all blocks respect the character limit
   * @param {Array} blocks - Array of blocks to validate
   * @param {number} maxLength - Maximum character length
   * @returns {Array} Validated blocks
   */
  validateBlocks(blocks, maxLength) {
    const validatedBlocks = [];
    
    for (const block of blocks) {
      const content = this.extractBlockContent(block);
      
      if (content && content.length > maxLength) {
        console.warn(`Block content too long: ${content.length} characters, splitting...`);
        const chunks = this.forceChunkText(content, maxLength);
        
        chunks.forEach(chunk => {
          const newBlock = this.createBlockFromContent(block, chunk);
          validatedBlocks.push(newBlock);
        });
      } else {
        validatedBlocks.push(block);
      }
    }
    
    return validatedBlocks;
  }

  /**
   * Extract text content from a block
   * @param {Object} block - Block object
   * @returns {string} Text content
   */
  extractBlockContent(block) {
    if (block.type === 'paragraph' && block.paragraph?.rich_text?.[0]?.text?.content) {
      return block.paragraph.rich_text[0].text.content;
    }
    if (block.type === 'code' && block.code?.rich_text?.[0]?.text?.content) {
      return block.code.rich_text[0].text.content;
    }
    if (block.type === 'heading_1' && block.heading_1?.rich_text?.[0]?.text?.content) {
      return block.heading_1.rich_text[0].text.content;
    }
    if (block.type === 'heading_2' && block.heading_2?.rich_text?.[0]?.text?.content) {
      return block.heading_2.rich_text[0].text.content;
    }
    if (block.type === 'heading_3' && block.heading_3?.rich_text?.[0]?.text?.content) {
      return block.heading_3.rich_text[0].text.content;
    }
    if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text?.[0]?.text?.content) {
      return block.bulleted_list_item.rich_text[0].text.content;
    }
    return '';
  }

  /**
   * Create a new block with the given content
   * @param {Object} originalBlock - Original block to copy structure from
   * @param {string} content - New content
   * @returns {Object} New block object
   */
  createBlockFromContent(originalBlock, content) {
    const newBlock = { ...originalBlock };
    
    if (newBlock.type === 'paragraph') {
      newBlock.paragraph.rich_text[0].text.content = content;
    } else if (newBlock.type === 'code') {
      newBlock.code.rich_text[0].text.content = content;
    } else if (newBlock.type === 'heading_1') {
      newBlock.heading_1.rich_text[0].text.content = content;
    } else if (newBlock.type === 'heading_2') {
      newBlock.heading_2.rich_text[0].text.content = content;
    } else if (newBlock.type === 'heading_3') {
      newBlock.heading_3.rich_text[0].text.content = content;
    } else if (newBlock.type === 'bulleted_list_item') {
      newBlock.bulleted_list_item.rich_text[0].text.content = content;
    }
    
    return newBlock;
  }

  /**
   * Check if a line is part of a Markdown table
   * @param {string} line - Line to check
   * @returns {boolean} True if line is part of a table
   */
  isTableLine(line) {
    return line.includes('|') && line.trim().length > 0;
  }

  /**
   * Intelligently detect table headers from parsed rows
   * @param {Array} rows - Array of parsed table rows
   * @returns {Object} Object with headers and rawDataRows
   */
  detectTableHeaders(rows) {
    // Prefer exact Markdown header + separator detection when available to preserve author order
    try {
      const extracted = this.extractHeadersFromTableLinesIfPresent(rows);
      if (extracted) return extracted;
    } catch (_) { /* ignore and continue */ }

    if (rows.length === 0) {
      return { headers: [], rawDataRows: [] };
    }

    // Calculate the most common row length (likely the correct column count)
    const rowLengths = rows.map(row => row.length);
    const lengthCounts = {};
    rowLengths.forEach(length => {
      lengthCounts[length] = (lengthCounts[length] || 0) + 1;
    });
    
    // Find the most common row length
    const mostCommonLength = parseInt(Object.keys(lengthCounts)
      .reduce((a, b) => lengthCounts[a] > lengthCounts[b] ? a : b));
    
    console.log('Row length analysis:', {
      rowLengths,
      lengthCounts,
      mostCommonLength
    });

    // Strategy 1: If first row has the most common length, use it as headers
    if (rows[0].length === mostCommonLength) {
      return {
        headers: rows[0],
        rawDataRows: rows.slice(1)
      };
    }

    // Strategy 2: Find the first row that has the most common length
    const headerRowIndex = rows.findIndex(row => row.length === mostCommonLength);
    if (headerRowIndex !== -1) {
      console.warn(`Using row ${headerRowIndex + 1} as headers instead of row 1`);
      return {
        headers: rows[headerRowIndex],
        rawDataRows: rows.slice(headerRowIndex + 1)
      };
    }

    // Strategy 3: Create synthetic headers based on the most common length
    console.warn(`No suitable header row found. Creating synthetic headers for ${mostCommonLength} columns`);
    const syntheticHeaders = Array.from({ length: mostCommonLength }, (_, i) => `Column ${i + 1}`);
    
    return {
      headers: syntheticHeaders,
      rawDataRows: rows // Use all rows as data since we created synthetic headers
    };
  }

  /**
   * Detect GFM header row followed by separator dashes with optional colons.
   * Returns null if pattern not matched.
   * @param {Array<Array<string>>} rows
   */
  extractHeadersFromTableLinesIfPresent(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const header = rows[0];
    const sep = rows[1];
    if (!Array.isArray(header) || !Array.isArray(sep)) return null;
    if (header.length === 0 || sep.length === 0) return null;
    if (sep.length !== header.length) return null;

    const isSeparatorCell = (cell) => {
      const s = String(cell || '').trim();
      return /^:?-{3,}:?$/.test(s);
    };
    if (!sep.every(isSeparatorCell)) return null;

    const headers = header.map(h => String(h || '').trim());
    const rawDataRows = rows.slice(2);
    return { headers, rawDataRows };
  }

  /**
   * Convert Markdown table to Notion Simple Table using two-phase chunking
   * @param {Array} tableLines - Array of table lines
   * @param {string} pageId - Page ID where table will be created (for direct creation)
   * @param {Function} progressCallback - Progress callback function
   * @returns {Array|Promise} Array of blocks for content conversion, or Promise for direct creation
   */
  convertTableToNotionDatabase(tableLines, pageId = null, progressCallback = null) {
    if (tableLines.length < 2) {
      // If not enough lines for a proper table, return as paragraph
      return tableLines.map(line => this.createParagraphBlock(line));
    }

    // Parse table data
    const rows = tableLines
      .filter(line => line.trim() && !line.includes('---')) // Remove separator lines
      .map(line => {
        // Split by pipe and trim each cell
        let cells = line.split('|').map(cell => cell.trim());
        
        // Remove empty cells only from the beginning and end (not middle)
        // This handles cases like "| col1 | col2 | col3 |" where there are empty cells at start/end
        while (cells.length > 0 && cells[0] === '') {
          cells.shift();
        }
        while (cells.length > 0 && cells[cells.length - 1] === '') {
          cells.pop();
        }
        
        return cells;
      });
    
    if (rows.length === 0) {
      return [];
    }

    // Intelligent header detection
    const { headers, rawDataRows } = this.detectTableHeaders(rows);
    
    // Debug logging to identify the issue
    console.log('Table parsing debug:');
    console.log('- Headers:', headers, 'Length:', headers.length);
    console.log('- First few data rows:', rawDataRows.slice(0, 3));
    console.log('- Original table lines:', tableLines.slice(0, 5));
    console.log('- Total parsed rows:', rows.length);
    
    // Validate and normalize all rows to match header length
    const dataRows = rawDataRows.map((row, rowIndex) => {
      // If row has fewer cells than headers, pad with empty strings
      while (row.length < headers.length) {
        row.push('');
      }
      // If row has more cells than headers, truncate (with warning)
      if (row.length > headers.length) {
        console.warn(`Table row ${rowIndex + 1} has ${row.length} cells but header has ${headers.length}. Truncating extra cells.`);
        // Keep the first N cells that match the header count
        row = row.slice(0, headers.length);
      }
      return row;
    });
    
    // Validate headers are not empty or too long
    const validatedHeaders = headers.map((header, index) => {
      let validHeader = String(header || `Column ${index + 1}`);
      if (validHeader.length > 100) {
        validHeader = validHeader.substring(0, 97) + '...';
      }
      return validHeader;
    });
    
    // If pageId is provided, create a Notion Database instead of a table block
    if (pageId) {
      if (!this.simpleTableBuilder) {
        this.simpleTableBuilder = new SimpleTableBuilder(this);
      }
      // Prefer creating a database for better sorting/filtering UX
      return this.simpleTableBuilder.convertMarkdownTableToNotionDatabase(pageId, tableLines, null, progressCallback);
    }

    // For content conversion (legacy support), check size limits
    if (dataRows.length > 99) {
      // For very large tables, use text format instead
      return this.convertLargeTableToText(validatedHeaders, dataRows);
    }

    // Create blocks for smaller tables (legacy approach)
    const blocks = [];
    const tableTitle = `📊 Table: ${validatedHeaders.slice(0, 3).join(' vs ')}${validatedHeaders.length > 3 ? '...' : ''}`;
    blocks.push(this.createHeadingBlock(tableTitle, 3));

    // Create a simple table block (will be converted to two-phase later)
    if (dataRows.length > 0) {
      // For content conversion, we need to include all rows in the initial block
      // This will be converted to two-phase when actually uploaded
      const tableBlock = {
        object: 'block',
        type: 'table',
        table: {
          table_width: validatedHeaders.length,
          has_column_header: true,
          has_row_header: false,
          children: [],
          // Store original data for two-phase conversion
          _originalHeaders: validatedHeaders,
          _originalDataRows: dataRows
        }
      };

      blocks.push(tableBlock);
      blocks.push(this.createParagraphBlock(''));
    }

    return blocks;
  }

  /**
   * Convert very large tables to readable text format
   * @param {Array} headers - Table headers
   * @param {Array} dataRows - Table data rows
   * @returns {Array} Array of Notion blocks
   */
  convertLargeTableToText(headers, dataRows) {
    const blocks = [];
    
    // Create table title
    const tableTitle = `📊 Large Table: ${headers.join(' vs ')} (${dataRows.length} rows)`;
    blocks.push(this.createHeadingBlock(tableTitle, 3));
    
    // Add note about table size
    blocks.push(this.createParagraphBlock(`⚠️ This table contains ${dataRows.length} rows, which exceeds Notion's 100-row limit. Displaying as formatted text.`));
    
    // Create header row
    const headerText = headers.join(' | ');
    blocks.push(this.createParagraphBlock(`**${headerText}**`));
    
    // Add separator
    blocks.push(this.createParagraphBlock('─'.repeat(headerText.length)));
    
    // Add data rows in chunks to avoid block limits
    const maxRowsPerChunk = 50; // Reasonable chunk size for text
    const chunks = this.chunkArray(dataRows, maxRowsPerChunk);
    
    chunks.forEach((chunk, chunkIndex) => {
      if (chunks.length > 1) {
        blocks.push(this.createParagraphBlock(`\n**Part ${chunkIndex + 1} of ${chunks.length}:**`));
      }
      
      chunk.forEach(row => {
        const rowText = row.join(' | ');
        blocks.push(this.createParagraphBlock(rowText));
      });
    });
    
    // Add spacing
    blocks.push(this.createParagraphBlock(''));
    
    return blocks;
  }

  /**
   * Clean Markdown formatting from text
   * @param {string} text - Text to clean
   * @returns {string} Cleaned text
   */
  cleanMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove code
      .replace(/~~(.*?)~~/g, '$1') // Remove strikethrough
      .trim();
  }

  /**
   * Convert JSON object to readable text format
   * @param {Object} jsonObj - JSON object to convert
   * @param {number} depth - Current nesting depth
   * @returns {string} Readable text representation
   */
  convertJsonToReadableText(jsonObj, depth = 0) {
    const indent = '  '.repeat(depth);
    
    if (jsonObj === null) {
      return 'null';
    }
    
    if (typeof jsonObj === 'string') {
      return jsonObj; // Remove quotes for better readability
    }
    
    if (typeof jsonObj === 'number' || typeof jsonObj === 'boolean') {
      return String(jsonObj);
    }
    
    if (Array.isArray(jsonObj)) {
      if (jsonObj.length === 0) {
        return 'Empty array';
      }
      
      // For small arrays, show inline
      if (jsonObj.length <= 3 && jsonObj.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
        return jsonObj.join(', ');
      }
      
      const items = jsonObj.map((item, index) => 
        `${indent}${index + 1}. ${this.convertJsonToReadableText(item, depth + 1)}`
      ).join('\n');
      
      return `\n${items}`;
    }
    
    if (typeof jsonObj === 'object') {
      const entries = Object.entries(jsonObj);
      if (entries.length === 0) {
        return 'Empty object';
      }
      
      // For small objects, show inline
      if (entries.length <= 3 && entries.every(([key, value]) => 
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
      }
      
      const properties = entries.map(([key, value]) => 
        `${indent}• **${key}**: ${this.convertJsonToReadableText(value, depth + 1)}`
      ).join('\n');
      
      return `\n${properties}`;
    }
    
    return String(jsonObj);
  }

  /**
   * Improve overall content formatting for better Notion readability
   * @param {string} content - Content to format
   * @returns {string} Formatted content
   */
  improveContentFormatting(content) {
    // Add better spacing around sections
    let formatted = content
      .replace(/\n(#{1,3}\s)/g, '\n\n$1') // Add space before headings
      .replace(/(#{1,3}\s[^\n]+)\n/g, '$1\n\n') // Add space after headings
      .replace(/\n\n\n+/g, '\n\n') // Remove excessive spacing
      .replace(/\n(📊|⚠️|✅|❌|🔍|📝|📸|🎓|📚|🔄)/g, '\n\n$1') // Add space before emoji sections
      .trim();

    return formatted;
  }

  /**
   * Upload a file to a temporary hosting service
   * Note: Notion doesn't support direct file uploads, so we need to use a file hosting service
   * For now, we'll use a data URL approach for small files, with size limits
   * @param {Blob} fileBlob - File to upload
   * @param {string} fileName - Name of the file
   * @returns {Promise<string>} URL of the uploaded file
   */
  async uploadFile(fileBlob, fileName) {
    try {
      // Check file size - data URLs have practical limits
      const maxSize = 2 * 1024 * 1024; // 2MB limit for data URLs
      
      if (fileBlob.size > maxSize) {
        // For large files, create a placeholder with file info
        const fileInfo = {
          name: fileName,
          size: fileBlob.size,
          type: fileBlob.type,
          message: 'File too large for direct upload. Please download individually.'
        };
        
        // Create a simple text representation
        const textContent = `File: ${fileName}\nSize: ${(fileBlob.size / 1024 / 1024).toFixed(2)} MB\nType: ${fileBlob.type}\n\nThis file is too large to upload directly to Notion. Please download it individually from the extension.`;
        
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(reader.result);
          };
          reader.readAsDataURL(new Blob([textContent], { type: 'text/plain' }));
        });
      }
      
      // For small files, use data URL
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(reader.result);
        };
        reader.readAsDataURL(fileBlob);
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Upload a Blob to Notion storage (single-part) and return the file_upload id
   * Uses the official /file_uploads create + send flow for files ≤ 20MB
   * @param {Blob} blob
   * @param {string} fileName
   * @param {string} contentType
   * @param {Function|null} progressCallback
   * @returns {Promise<string>} file_upload id
   */
  async uploadBlobToNotion(blob, fileName, contentType = 'application/octet-stream', progressCallback = null) {
    if (!(blob instanceof Blob)) {
      throw new Error('uploadBlobToNotion: blob must be a Blob');
    }
    const size = blob.size || 0;
    if (size > 20 * 1024 * 1024) {
      throw new Error('uploadBlobToNotion currently supports ≤ 20MB single-part uploads');
    }

    // Step 1: create file_upload
    const createUrl = `${this.baseURL}file_uploads`;
    const createBody = { filename: fileName, content_type: contentType };
    this.logRequest('POST', createUrl, createBody, this.headers);
    const createResp = await this._fetch(createUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(createBody)
    });
    const createData = await createResp.json();
    if (!createResp.ok) {
      this.logResponse('POST', createUrl, createResp.status, createData, createData.message || 'Unknown error');
      throw new Error(`Notion create file_upload failed: ${createResp.status} - ${createData.message || 'Unknown error'}`);
    }
    this.logResponse('POST', createUrl, createResp.status, createData);
    const fileUploadId = createData?.id;
    if (!fileUploadId) throw new Error('Notion create file_upload: missing id');

    if (progressCallback) progressCallback(`Uploading ${fileName} to Notion...`);

    // Step 2: send file content (multipart)
    const sendUrl = `${this.baseURL}file_uploads/${fileUploadId}/send`;
    const form = new FormData();
    form.append('file', blob, fileName);

    // Use a copy of headers without Content-Type to let browser set multipart boundary
    const sendHeaders = { ...this.headers };
    delete sendHeaders['Content-Type'];

    this.logRequest('POST', sendUrl, '[multipart/form-data]', sendHeaders);
    const sendResp = await this._fetch(sendUrl, { method: 'POST', headers: sendHeaders, body: form });
    const sendData = await sendResp.json();
    if (!sendResp.ok) {
      this.logResponse('POST', sendUrl, sendResp.status, sendData, sendData.message || 'Unknown error');
      throw new Error(`Notion send file_upload failed: ${sendResp.status} - ${sendData.message || 'Unknown error'}`);
    }
    this.logResponse('POST', sendUrl, sendResp.status, sendData);

    if (progressCallback) progressCallback(`✓ Uploaded ${fileName} to Notion storage`);
    return fileUploadId;
  }

  /**
   * Create a Notion file block referencing a file_upload id (hosted by Notion)
   * @param {string} fileName
   * @param {string} fileUploadId
   * @returns {Object}
   */
  createFileUploadBlock(fileName, fileUploadId) {
    return {
      object: 'block',
      type: 'file',
      file: {
        type: 'file_upload',
        file_upload: { id: fileUploadId },
        name: fileName
      }
    };
  }

  /**
   * Create a comprehensive report page structure
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @param {Array} files - Array of file objects with name and content
   * @returns {Array} Array of content blocks for the page
   */
  createReportPageStructure(mainSchool, baselineSchool, files) {
    const blocks = [
      this.createHeadingBlock(`Pod Lead Review: ${mainSchool} vs ${baselineSchool}`, 1),
      this.createParagraphBlock(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`),
      this.createDividerBlock(),
      this.createHeadingBlock('📊 Report Files', 2),
      this.createParagraphBlock('All generated reports and data files are attached below:'),
      this.createDividerBlock()
    ];

    // Separate large files from regular files
    const largeFiles = files.filter(file => file.size > 2 * 1024 * 1024);
    const regularFiles = files.filter(file => file.size <= 2 * 1024 * 1024);

    // Add regular file blocks
    regularFiles.forEach(file => {
      blocks.push(this.createFileBlock(file.name, file.url));
    });

    // Add note about large files if any
    if (largeFiles.length > 0) {
      blocks.push(this.createDividerBlock());
      blocks.push(this.createHeadingBlock('📁 Large Files', 3));
      blocks.push(this.createParagraphBlock(`The following ${largeFiles.length} files are too large to upload directly to Notion. Please download them individually from the extension:`));
      
      largeFiles.forEach(file => {
        blocks.push(this.createParagraphBlock(`• ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`));
      });
    }

    return blocks;
  }

  // Reverted: no invisible prefixes; use plain sanitized header names in report order

  /**
   * Create a Notion database under a page using provided headers as properties
   * @param {string} parentPageId - Parent page ID
   * @param {string} databaseTitle - Database title
   * @param {Array<string>} headers - Column headers (first header becomes title property)
   * @returns {Promise<{database: Object, sanitizedHeaders: Array<string>, titlePropName: string}>}
   */
  async createDatabase(parentPageId, databaseTitle, headers) {
    // Create a database via official POST /databases API
    const url = `${this.baseURL}databases`;
    const { sanitizedHeaders, titlePropName, properties } = this.createDatabasePropertiesFromHeaders(headers);

    const body = {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: databaseTitle || 'Data' } }],
      is_inline: true,
      properties
    };

    this.logRequest('POST', url, body, this.headers);
    const response = await this._fetch(url, { method: 'POST', headers: this.headers, body: JSON.stringify(body) });
    const responseData = await response.json();
    if (!response.ok) {
      this.logResponse('POST', url, response.status, responseData, responseData.message || 'Unknown error');
      throw new Error(`Notion API error: ${response.status} - ${responseData.message || 'Unknown error'}`);
    }
    this.logResponse('POST', url, response.status, responseData);

    return { database: { id: responseData.id }, sanitizedHeaders, titlePropName };
  }

  /**
   * Create a Notion database with properties added in strict header order.
   * This uses a two-phase approach to preserve column order in the UI:
   * 1) POST database with only the title property (headers[0])
   * 2) PATCH database to add remaining properties one-by-one in order
   * @param {string} parentPageId
   * @param {string} databaseTitle
   * @param {Array<string>} headers
   * @returns {Promise<{database: Object, sanitizedHeaders: Array<string>, titlePropName: string}>}
   */
  async createDatabaseOrdered(parentPageId, databaseTitle, headers) {
    if (!Array.isArray(headers) || headers.length === 0) {
      // Fallback to minimal single-column database
      headers = ['Name'];
    }

    const { sanitizedHeaders, titlePropName } = this.createDatabasePropertiesFromHeaders(headers);

    // Phase 1: create DB with only title property
    const postUrl = `${this.baseURL}databases`;
    const minimalProps = {};
    minimalProps[titlePropName] = { title: {} };

    const postBody = {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: databaseTitle || 'Data' } }],
      is_inline: true,
      properties: minimalProps
    };

    this.logRequest('POST', postUrl, postBody, this.headers);
    const postResp = await this._fetch(postUrl, { method: 'POST', headers: this.headers, body: JSON.stringify(postBody) });
    const postData = await postResp.json();
    if (!postResp.ok) {
      this.logResponse('POST', postUrl, postResp.status, postData, postData.message || 'Unknown error');
      throw new Error(`Notion API error: ${postResp.status} - ${postData.message || 'Unknown error'}`);
    }
    this.logResponse('POST', postUrl, postResp.status, postData);

    const databaseId = postData?.id;
    if (!databaseId) {
      throw new Error('Failed to create database: missing id');
    }

    // Phase 2: add remaining properties one-by-one (preserve creation order or reversed per prior logic)
    const patchUrl = `${this.baseURL}databases/${databaseId}`;
    const otherProps = sanitizedHeaders.filter(n => n !== titlePropName).slice().reverse();
    for (const propName of otherProps) {
      const patchBody = { properties: {} };
      patchBody.properties[propName] = { rich_text: {} };
      this.logRequest('PATCH', patchUrl, patchBody, this.headers);
      const patchResp = await this._fetch(patchUrl, { method: 'PATCH', headers: this.headers, body: JSON.stringify(patchBody) });
      const patchData = await patchResp.json();
      if (!patchResp.ok) {
        this.logResponse('PATCH', patchUrl, patchResp.status, patchData, patchData.message || 'Unknown error');
        throw new Error(`Notion API error: ${patchResp.status} - ${patchData.message || 'Unknown error'}`);
      }
      this.logResponse('PATCH', patchUrl, patchResp.status, patchData);
      // Gentle delay to respect rate limits
      await this.delay(200);
    }

    return { database: { id: databaseId }, sanitizedHeaders, titlePropName };
  }

  /**
   * Build database properties from headers, ensuring one title property and unique names
   * @param {Array<string>} headers
   * @returns {{sanitizedHeaders: Array<string>, titlePropName: string, properties: Object}}
   */
  createDatabasePropertiesFromHeaders(headers) {
    const existing = new Set();
    const rawHeaders = Array.isArray(headers) ? headers : [];

    const sanitizedHeaders = rawHeaders.map((h, idx) => this.sanitizePropertyName(String(h || `Column ${idx + 1}`), existing));
    const titlePropName = sanitizedHeaders[0] || 'Name';

    // ✅ Add "Comments" to sanitized headers if not already present
    if (!sanitizedHeaders.includes('Comments')) {
      sanitizedHeaders.push('Comments');
    }

    const properties = {};
    // Title property
    properties[titlePropName] = { title: {} };
    // Other properties as rich_text
    for (let i = 1; i < sanitizedHeaders.length; i++) {
      properties[sanitizedHeaders[i]] = { rich_text: {} };
    }

    return { sanitizedHeaders, titlePropName, properties };
  }

  /**
   * Test function to verify Comments column is added correctly
   * @param {Array<string>} headers
   * @returns {Object} Test result with sanitized headers and properties
   */
  testCommentsColumn(headers) {
    const result = this.createDatabasePropertiesFromHeaders(headers);
    const hasComments = result.sanitizedHeaders.includes('Comments');
    const commentsProperty = result.properties['Comments'];
    
    return {
      success: hasComments && commentsProperty && commentsProperty.rich_text !== undefined,
      sanitizedHeaders: result.sanitizedHeaders,
      hasComments,
      commentsProperty,
      message: hasComments ? 'Comments column added successfully' : 'Comments column missing'
    };
  }

  /**
   * Sanitize a property name and ensure uniqueness within a set
   * @param {string} name
   * @param {Set<string>} existing
   * @returns {string}
   */
  sanitizePropertyName(name, existing) {
    let base = name.trim();
    if (!base) base = 'Column';
    if (base.length > 80) base = base.slice(0, 77) + '...';
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) {
      candidate = `${base} (${suffix})`;
      suffix++;
    }
    existing.add(candidate);
    return candidate;
  }

  /**
   * Convert a long string into a Notion rich_text array within length limits
   * @param {string} text
   * @param {number} maxLen
   * @returns {Array<Object>}
   */
  createRichTextArrayFromString(text, maxLen = 2000) {
    const content = String(text || '');
    if (content.length <= maxLen) {
      return [{ type: 'text', text: { content } }];
    }
    const parts = [];
    for (let i = 0; i < content.length; i += 1800) {
      parts.push(content.slice(i, i + 1800));
    }
    return parts.map(p => ({ type: 'text', text: { content: p } }));
  }

  /**
   * Insert multiple rows into a database as pages
   * @param {string} databaseId
   * @param {Array<string>} headers
   * @param {Array<Array<string>>} dataRows
   * @param {Function|null} progressCallback
   * @returns {Promise<void>}
   */
  async addRowsToDatabase(databaseId, headers, dataRows, progressCallback = null) {
    if (!databaseId) throw new Error('Missing databaseId');
    if (!Array.isArray(headers) || headers.length === 0) return;

    // Use the same sanitization to match property names used during creation
    const { sanitizedHeaders, titlePropName } = this.createDatabasePropertiesFromHeaders(headers);

    for (let i = 0; i < dataRows.length; i++) {
      const row = Array.isArray(dataRows[i]) ? dataRows[i] : [];

      const properties = {};
      for (let c = 0; c < sanitizedHeaders.length; c++) {
        const propName = sanitizedHeaders[c];
        const cell = row[c] !== undefined ? String(row[c]) : '';
        
        // ✅ Handle Comments column specially - always empty
        if (propName === 'Comments') {
          properties[propName] = { rich_text: [] }; // Empty rich_text array
        } else if (propName === titlePropName) {
          properties[propName] = { title: this.createRichTextArrayFromString(cell) };
        } else {
          properties[propName] = { rich_text: this.createRichTextArrayFromString(cell) };
        }
      }

      await this.createPageInDatabase(databaseId, properties);
      if (progressCallback) {
        progressCallback(`Adding row ${i + 1}/${dataRows.length} to database...`);
      }
      await this.delay(350);
    }
  }

  /**
   * Create a page in a database with given properties
   * @param {string} databaseId
   * @param {Object} properties
   * @returns {Promise<Object>}
   */
  async createPageInDatabase(databaseId, properties) {
    const url = `${this.baseURL}pages`;
    const body = { parent: { database_id: databaseId }, properties };

    this.logRequest('POST', url, body, this.headers);
    const response = await this._fetch(url, { method: 'POST', headers: this.headers, body: JSON.stringify(body) });
    const responseData = await response.json();
    if (!response.ok) {
      this.logResponse('POST', url, response.status, responseData, responseData.message || 'Unknown error');
      throw new Error(`Notion API error: ${response.status} - ${responseData.message || 'Unknown error'}`);
    }
    this.logResponse('POST', url, response.status, responseData);
    return responseData;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotionClient;
}
