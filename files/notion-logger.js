/**
 * NotionLogger - Comprehensive logging for Notion integration
 * Captures all processing logs, API requests, and responses
 * 
 * Log Levels:
 * - MINIMAL (1): Only errors
 * - SUMMARY (2): Errors + summaries (request counts, sizes)
 * - DETAILED (3): Full requests/responses (for debugging)
 */
class NotionLogger {
  // Log level constants
  static LOG_LEVELS = {
    MINIMAL: 1,    // Only errors
    SUMMARY: 2,    // Errors + summaries (DEFAULT)
    DETAILED: 3    // Full requests/responses (debugging)
  };

  constructor(logLevel = NotionLogger.LOG_LEVELS.SUMMARY) {
    this.logs = [];
    this.startTime = new Date();
    this.sessionId = this.generateSessionId();
    this.logLevel = logLevel;
    
    // Statistics for summary logging
    this.stats = {
      apiCalls: 0,
      totalRequestSize: 0,
      totalResponseSize: 0,
      errors: 0,
      successfulCalls: 0
    };
  }

  /**
   * Generate a unique session ID for this logging session
   */
  generateSessionId() {
    return 'notion_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Log a processing step
   * @param {string} step - The processing step name
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   * @param {string} level - Log level (info, warn, error, debug)
   */
  logProcessing(step, message, data = null, level = 'info') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'PROCESSING',
      level: level,
      step: step,
      message: message,
      data: data ? JSON.parse(JSON.stringify(data)) : null
    };
    
    this.logs.push(logEntry);
    console.log(`[NotionLogger] ${level.toUpperCase()}: ${step} - ${message}`, data || '');
  }

  /**
   * Log a Notion API request
   * @param {string} method - HTTP method
   * @param {string} url - Full URL
   * @param {Object} headers - Request headers
   * @param {Object} body - Request body
   */
  logApiRequest(method, url, headers, body) {
    this.stats.apiCalls++;
    const bodySize = body ? JSON.stringify(body).length : 0;
    this.stats.totalRequestSize += bodySize;
    
    const endpoint = url.replace('https://api.notion.com/v1', '');
    
    // Only log in SUMMARY or DETAILED modes (skip in MINIMAL)
    if (this.logLevel >= NotionLogger.LOG_LEVELS.SUMMARY) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'API_REQUEST',
        method: method,
        url: url,
        endpoint: endpoint,
        bodySize: bodySize
      };
      
      // Only include full payload in DETAILED mode
      if (this.logLevel >= NotionLogger.LOG_LEVELS.DETAILED) {
        logEntry.headers = this.sanitizeHeaders(headers);
        logEntry.body = body ? JSON.parse(JSON.stringify(body)) : null;
      } else {
        // SUMMARY mode: include block count if present
        if (body?.children) {
          logEntry.blockCount = body.children.length;
        }
      }
      
      this.logs.push(logEntry);
    }
    
    // Console logging
    if (this.logLevel >= NotionLogger.LOG_LEVELS.DETAILED) {
      console.log(`[NotionLogger] API REQUEST: ${method} ${url}`, body || '');
    } else if (this.logLevel >= NotionLogger.LOG_LEVELS.SUMMARY) {
      console.log(`[NotionLogger] API REQUEST: ${method} ${endpoint} (${Math.round(bodySize/1024)}KB)`);
    }
  }

  /**
   * Log a Notion API response
   * @param {string} method - HTTP method
   * @param {string} url - Full URL
   * @param {number} status - HTTP status code
   * @param {Object} response - Response data
   * @param {string} error - Error message if any
   */
  logApiResponse(method, url, status, response, error = null) {
    const responseSize = response ? JSON.stringify(response).length : 0;
    this.stats.totalResponseSize += responseSize;
    const isSuccess = !error && status >= 200 && status < 300;
    
    if (isSuccess) {
      this.stats.successfulCalls++;
    } else {
      this.stats.errors++;
    }
    
    const endpoint = url.replace('https://api.notion.com/v1', '');
    
    // Always log errors, otherwise respect log level
    if (error || this.logLevel >= NotionLogger.LOG_LEVELS.SUMMARY) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'API_RESPONSE',
        method: method,
        url: url,
        endpoint: endpoint,
        status: status,
        statusText: this.getStatusText(status),
        responseSize: responseSize,
        success: isSuccess
      };
      
      // Always include error details
      if (error) {
        logEntry.error = error;
        // Include response in errors even in SUMMARY mode (for debugging)
        logEntry.response = response ? JSON.parse(JSON.stringify(response)) : null;
      } else if (this.logLevel >= NotionLogger.LOG_LEVELS.DETAILED) {
        // Only include full response payload in DETAILED mode for successful calls
        logEntry.response = response ? JSON.parse(JSON.stringify(response)) : null;
      }
      
      this.logs.push(logEntry);
    }
    
    // Console logging
    if (error) {
      console.error(`[NotionLogger] API ERROR: ${method} ${endpoint} - ${status} ${error}`, response || '');
    } else if (this.logLevel >= NotionLogger.LOG_LEVELS.DETAILED) {
      console.log(`[NotionLogger] API SUCCESS: ${method} ${endpoint} - ${status}`, response || '');
    } else if (this.logLevel >= NotionLogger.LOG_LEVELS.SUMMARY) {
      console.log(`[NotionLogger] API SUCCESS: ${method} ${endpoint} - ${status} (${Math.round(responseSize/1024)}KB)`);
    }
  }

  /**
   * Log table processing information
   * @param {string} action - Action being performed
   * @param {Object} tableInfo - Table information
   * @param {Object} result - Processing result
   */
  logTableProcessing(action, tableInfo, result = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'TABLE_PROCESSING',
      action: action,
      tableInfo: {
        rowCount: tableInfo.rowCount || 0,
        columnCount: tableInfo.columnCount || 0,
        hasLargeContent: tableInfo.hasLargeContent || false,
        needsSplitting: tableInfo.needsSplitting || false,
        splitCount: tableInfo.splitCount || 1
      },
      result: result ? JSON.parse(JSON.stringify(result)) : null
    };
    
    this.logs.push(logEntry);
    console.log(`[NotionLogger] TABLE: ${action}`, tableInfo, result || '');
  }

  /**
   * Log content chunking information
   * @param {string} contentType - Type of content being chunked
   * @param {number} originalSize - Original content size
   * @param {number} chunkCount - Number of chunks created
   * @param {Object} chunkInfo - Chunking details
   */
  logContentChunking(contentType, originalSize, chunkCount, chunkInfo = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'CONTENT_CHUNKING',
      contentType: contentType,
      originalSize: originalSize,
      chunkCount: chunkCount,
      chunkInfo: chunkInfo ? JSON.parse(JSON.stringify(chunkInfo)) : null
    };
    
    this.logs.push(logEntry);
    console.log(`[NotionLogger] CHUNKING: ${contentType} - ${originalSize} chars -> ${chunkCount} chunks`, chunkInfo || '');
  }

  /**
   * Log page creation information
   * @param {string} pageTitle - Title of the page being created
   * @param {string} pageId - Notion page ID
   * @param {string} pageUrl - Notion page URL
   * @param {Object} pageData - Page creation data
   */
  logPageCreation(pageTitle, pageId, pageUrl, pageData = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'PAGE_CREATION',
      pageTitle: pageTitle,
      pageId: pageId,
      pageUrl: pageUrl,
      pageData: pageData ? JSON.parse(JSON.stringify(pageData)) : null
    };
    
    this.logs.push(logEntry);
    console.log(`[NotionLogger] PAGE CREATED: ${pageTitle} - ${pageId}`, pageData || '');
  }

  /**
   * Log error with context
   * @param {string} context - Error context
   * @param {Error} error - Error object
   * @param {Object} additionalData - Additional context data
   */
  logError(context, error, additionalData = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'ERROR',
      context: context,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      additionalData: additionalData ? JSON.parse(JSON.stringify(additionalData)) : null
    };
    
    this.logs.push(logEntry);
    console.error(`[NotionLogger] ERROR in ${context}:`, error, additionalData || '');
  }

  /**
   * Log performance metrics
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} metrics - Additional metrics
   */
  logPerformance(operation, duration, metrics = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'PERFORMANCE',
      operation: operation,
      duration: duration,
      metrics: metrics ? JSON.parse(JSON.stringify(metrics)) : null
    };
    
    this.logs.push(logEntry);
    console.log(`[NotionLogger] PERFORMANCE: ${operation} took ${duration}ms`, metrics || '');
  }

  /**
   * Sanitize headers for logging (remove sensitive data)
   * @param {Object} headers - Headers object
   * @returns {Object} Sanitized headers
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    if (sanitized.Authorization) {
      sanitized.Authorization = '[REDACTED]';
    }
    return sanitized;
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
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };
    return statusTexts[status] || 'Unknown';
  }

  /**
   * Generate comprehensive log file content
   * @returns {string} Formatted log content
   */
  generateLogFile() {
    const endTime = new Date();
    const totalDuration = endTime - this.startTime;
    
    let logContent = `# Notion Integration Log\n\n`;
    logContent += `**Session ID:** ${this.sessionId}\n`;
    logContent += `**Start Time:** ${this.startTime.toISOString()}\n`;
    logContent += `**End Time:** ${endTime.toISOString()}\n`;
    logContent += `**Total Duration:** ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)\n`;
    logContent += `**Total Log Entries:** ${this.logs.length}\n\n`;
    
    // Summary statistics
    const stats = this.generateStatistics();
    logContent += `## Summary Statistics\n\n`;
    logContent += `- **API Requests:** ${stats.apiRequests}\n`;
    logContent += `- **API Responses:** ${stats.apiResponses}\n`;
    logContent += `- **Successful API Calls:** ${stats.successfulApiCalls}\n`;
    logContent += `- **Failed API Calls:** ${stats.failedApiCalls}\n`;
    logContent += `- **Processing Steps:** ${stats.processingSteps}\n`;
    logContent += `- **Tables Processed:** ${stats.tablesProcessed}\n`;
    logContent += `- **Pages Created:** ${stats.pagesCreated}\n`;
    logContent += `- **Errors:** ${stats.errors}\n`;
    logContent += `- **Total Data Transferred:** ${stats.totalDataTransferred} characters\n\n`;
    
    // Detailed logs
    logContent += `## Detailed Logs\n\n`;
    
    this.logs.forEach((entry, index) => {
      logContent += `### Entry ${index + 1}: ${entry.type}\n`;
      logContent += `**Timestamp:** ${entry.timestamp}\n`;
      
      if (entry.type === 'PROCESSING') {
        logContent += `**Level:** ${entry.level.toUpperCase()}\n`;
        logContent += `**Step:** ${entry.step}\n`;
        logContent += `**Message:** ${entry.message}\n`;
        if (entry.data) {
          logContent += `**Data:**\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'API_REQUEST') {
        logContent += `**Method:** ${entry.method}\n`;
        logContent += `**Endpoint:** ${entry.endpoint}\n`;
        logContent += `**Full URL:** ${entry.url}\n`;
        logContent += `**Headers:**\n\`\`\`json\n${JSON.stringify(entry.headers, null, 2)}\n\`\`\`\n`;
        if (entry.body) {
          logContent += `**Request Body Size:** ${entry.bodySize} characters\n`;
          logContent += `**Request Body:**\n\`\`\`json\n${JSON.stringify(entry.body, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'API_RESPONSE') {
        logContent += `**Method:** ${entry.method}\n`;
        logContent += `**Endpoint:** ${entry.endpoint}\n`;
        logContent += `**Status:** ${entry.status} ${entry.statusText}\n`;
        logContent += `**Success:** ${entry.success}\n`;
        logContent += `**Response Size:** ${entry.responseSize} characters\n`;
        if (entry.error) {
          logContent += `**Error:** ${entry.error}\n`;
        }
        if (entry.response) {
          logContent += `**Response Body:**\n\`\`\`json\n${JSON.stringify(entry.response, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'TABLE_PROCESSING') {
        logContent += `**Action:** ${entry.action}\n`;
        logContent += `**Table Info:**\n\`\`\`json\n${JSON.stringify(entry.tableInfo, null, 2)}\n\`\`\`\n`;
        if (entry.result) {
          logContent += `**Result:**\n\`\`\`json\n${JSON.stringify(entry.result, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'CONTENT_CHUNKING') {
        logContent += `**Content Type:** ${entry.contentType}\n`;
        logContent += `**Original Size:** ${entry.originalSize} characters\n`;
        logContent += `**Chunk Count:** ${entry.chunkCount}\n`;
        if (entry.chunkInfo) {
          logContent += `**Chunk Info:**\n\`\`\`json\n${JSON.stringify(entry.chunkInfo, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'PAGE_CREATION') {
        logContent += `**Page Title:** ${entry.pageTitle}\n`;
        logContent += `**Page ID:** ${entry.pageId}\n`;
        logContent += `**Page URL:** ${entry.pageUrl}\n`;
        if (entry.pageData) {
          logContent += `**Page Data:**\n\`\`\`json\n${JSON.stringify(entry.pageData, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'ERROR') {
        logContent += `**Context:** ${entry.context}\n`;
        logContent += `**Error Message:** ${entry.error.message}\n`;
        logContent += `**Error Name:** ${entry.error.name}\n`;
        logContent += `**Stack Trace:**\n\`\`\`\n${entry.error.stack}\n\`\`\`\n`;
        if (entry.additionalData) {
          logContent += `**Additional Data:**\n\`\`\`json\n${JSON.stringify(entry.additionalData, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'PERFORMANCE') {
        logContent += `**Operation:** ${entry.operation}\n`;
        logContent += `**Duration:** ${entry.duration}ms\n`;
        if (entry.metrics) {
          logContent += `**Metrics:**\n\`\`\`json\n${JSON.stringify(entry.metrics, null, 2)}\n\`\`\`\n`;
        }
      }
      
      logContent += '\n---\n\n';
    });
    
    return logContent;
  }

  /**
   * Generate summary statistics
   * @returns {Object} Statistics object
   */
  generateStatistics() {
    const stats = {
      apiRequests: 0,
      apiResponses: 0,
      successfulApiCalls: 0,
      failedApiCalls: 0,
      processingSteps: 0,
      tablesProcessed: 0,
      pagesCreated: 0,
      errors: 0,
      totalDataTransferred: 0
    };
    
    this.logs.forEach(entry => {
      switch (entry.type) {
        case 'API_REQUEST':
          stats.apiRequests++;
          stats.totalDataTransferred += entry.bodySize || 0;
          break;
        case 'API_RESPONSE':
          stats.apiResponses++;
          stats.totalDataTransferred += entry.responseSize || 0;
          if (entry.success) {
            stats.successfulApiCalls++;
          } else {
            stats.failedApiCalls++;
          }
          break;
        case 'PROCESSING':
          stats.processingSteps++;
          break;
        case 'TABLE_PROCESSING':
          stats.tablesProcessed++;
          break;
        case 'PAGE_CREATION':
          stats.pagesCreated++;
          break;
        case 'ERROR':
          stats.errors++;
          break;
      }
    });
    
    return stats;
  }

  /**
   * Download the log file
   */
  downloadLogFile() {
    const logContent = this.generateLogFile();
    const blob = new Blob([logContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `notion-integration-log-${this.sessionId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
    this.startTime = new Date();
    this.sessionId = this.generateSessionId();
  }

  /**
   * Get log count
   * @returns {number} Number of log entries
   */
  getLogCount() {
    return this.logs.length;
  }

  /**
   * Get upload statistics summary
   * @returns {Object} Statistics object
   */
  getStatistics() {
    const endTime = new Date();
    const duration = ((endTime - this.startTime) / 1000 / 60).toFixed(2); // minutes
    
    return {
      sessionId: this.sessionId,
      logLevel: Object.keys(NotionLogger.LOG_LEVELS).find(
        key => NotionLogger.LOG_LEVELS[key] === this.logLevel
      ),
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMinutes: parseFloat(duration),
      apiCalls: this.stats.apiCalls,
      successfulCalls: this.stats.successfulCalls,
      errors: this.stats.errors,
      totalRequestSizeMB: (this.stats.totalRequestSize / 1024 / 1024).toFixed(2),
      totalResponseSizeMB: (this.stats.totalResponseSize / 1024 / 1024).toFixed(2),
      totalLogEntries: this.logs.length,
      successRate: this.stats.apiCalls > 0 
        ? ((this.stats.successfulCalls / this.stats.apiCalls) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }

  /**
   * Generate a summary report (for SUMMARY and MINIMAL modes)
   * @returns {string} Markdown summary
   */
  generateSummaryReport() {
    const stats = this.getStatistics();
    
    let report = `# Notion Upload Summary\n\n`;
    report += `**Session ID**: ${stats.sessionId}\n`;
    report += `**Log Level**: ${stats.logLevel}\n`;
    report += `**Duration**: ${stats.durationMinutes} minutes\n\n`;
    
    report += `## API Statistics\n\n`;
    report += `- **Total API Calls**: ${stats.apiCalls}\n`;
    report += `- **Successful**: ${stats.successfulCalls}\n`;
    report += `- **Errors**: ${stats.errors}\n`;
    report += `- **Success Rate**: ${stats.successRate}\n\n`;
    
    report += `## Data Transfer\n\n`;
    report += `- **Request Data**: ${stats.totalRequestSizeMB} MB\n`;
    report += `- **Response Data**: ${stats.totalResponseSizeMB} MB\n`;
    report += `- **Total**: ${(parseFloat(stats.totalRequestSizeMB) + parseFloat(stats.totalResponseSizeMB)).toFixed(2)} MB\n\n`;
    
    report += `## Log Entries\n\n`;
    report += `- **Total Entries**: ${stats.totalLogEntries}\n\n`;
    
    if (stats.errors > 0) {
      report += `## Errors\n\n`;
      const errorLogs = this.logs.filter(log => log.type === 'ERROR' || log.error);
      errorLogs.forEach((log, index) => {
        report += `### Error ${index + 1}\n`;
        report += `- **Time**: ${log.timestamp}\n`;
        report += `- **Context**: ${log.context || log.endpoint || 'Unknown'}\n`;
        report += `- **Message**: ${log.error?.message || log.error || 'Unknown error'}\n\n`;
      });
    }
    
    report += `---\n*Generated by NotionLogger v2.0*\n`;
    
    return report;
  }
}
