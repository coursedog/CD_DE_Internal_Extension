/**
 * Simple Table Builder for Notion API
 * Implements the two-phase chunking workflow for building large data tables
 */

class SimpleTableBuilder {
  constructor(notionClient, notionLogger = null) {
    this.client = notionClient;
    this.notionLogger = notionLogger;
    this.MAX_BLOCKS_PER_BATCH = 25; // Conservative limit (official max is 1000, but we use 25 for safety)
    this.MAX_REQUEST_SIZE_KB = 400; // 400KB limit (official max is 500KB, we use 400KB for safety)
    this.BATCH_DELAY_MS = 500; // Increased delay for rate limiting (3 requests/second = 333ms between requests)
    this.MAX_TEXT_LENGTH = 2000; // Official Notion limit
  }

  /**
   * Create a large table using the two-phase chunking process (DEPRECATED - use createCompleteTableBlock instead)
   * @param {string} pageId - Parent page ID where table will be created
   * @param {Array} headers - Array of column headers
   * @param {Array} dataRows - Array of data rows (each row is an array of cell values)
   * @param {string} tableTitle - Optional title for the table
   * @param {Function} progressCallback - Progress callback function
   * @returns {Promise<Object>} Created table block object
   */
  async createLargeTable(pageId, headers, dataRows, tableTitle = null, progressCallback = null) {
    // This method is deprecated - use createCompleteTableBlock instead
    console.warn('createLargeTable is deprecated - use createCompleteTableBlock instead');
    
    if (progressCallback) {
      progressCallback(`Creating complete table with ${headers.length} columns and ${dataRows.length} rows...`);
    }

    // Create complete table block directly
    const tableBlock = this.createCompleteTableBlock(headers, dataRows);
    
    if (progressCallback) {
      progressCallback(`✓ Table block created with ${dataRows.length} rows`);
    }

    return tableBlock;
  }

  /**
   * Phase 1: Create the Table with Header Row
   * @param {string} pageId - Parent page ID
   * @param {Array} headers - Column headers
   * @param {string} tableTitle - Optional table title
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Object>} Created table with header
   */
  async createTableShell(pageId, headers, tableTitle = null, progressCallback = null) {
    try {
      const blocks = [];

      // Add title if provided
      if (tableTitle) {
        blocks.push(this.client.createHeadingBlock(tableTitle, 3));
        if (progressCallback) {
          progressCallback(`Adding table title: ${tableTitle}`);
        }
      }

      // Create table with header row included (Notion requires at least 1 child)
      const headerRow = {
        object: 'block',
        type: 'table_row',
        table_row: {
          cells: headers.map(header => [{
            type: 'text',
            text: {
              content: this.sanitizeCellContent(String(header || '')),
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
            plain_text: this.sanitizeCellContent(String(header || '')),
            href: null
          }])
        }
      };

      const tableBlock = {
        object: 'block',
        type: 'table',
        table: {
          table_width: headers.length,
          has_column_header: true,
          has_row_header: false,
          children: [headerRow] // Include header row as first child
        }
      };

      // Debug logging
      console.log('Creating table block with header:', JSON.stringify(tableBlock, null, 2));
      blocks.push(tableBlock);

      if (progressCallback) {
        progressCallback('Creating table with header row...');
      }

      // Create the shell by appending to the page
      const response = await this.client.appendBlocksToPage(pageId, blocks);
      
      // Debug logging
      console.log('Table shell creation response:', JSON.stringify(response, null, 2));
      
      // Validate response structure
      if (!response) {
        throw new Error('No response received from Notion API');
      }
      
      // Check if response has the expected structure
      if (typeof response !== 'object') {
        console.error('Response is not an object:', typeof response, response);
        throw new Error('Invalid response type from Notion API');
      }
      
      // Handle different response formats
      if (response.results && Array.isArray(response.results)) {
        // Standard Notion API response format
        console.log('Using standard results format');
      } else if (response.success && response.batches) {
        // Our custom response format from appendBlocksToPage
        console.log('Using custom success format - this indicates the blocks were already processed');
        // This means the table was already created and we can't append more rows
        // We need to throw an error to prevent trying to append to a non-existent table
        throw new Error('Table creation completed via batch processing - cannot append additional rows. The table content was already added to the page.');
      } else {
        console.error('Response missing expected properties:', Object.keys(response));
        throw new Error('Response missing results property from Notion API');
      }
      
      // Find the table block in the response
      const createdTableBlock = response.results.find(block => block && block.type === 'table');
      
      if (!createdTableBlock) {
        console.error('No table block found in response. Available blocks:', response.results.map(b => b?.type));
        throw new Error('Failed to create table shell - table block not found in response');
      }

      if (progressCallback) {
        progressCallback(`✓ Table with header created successfully with ID: ${createdTableBlock.id}`);
      }

      return createdTableBlock;

    } catch (error) {
      console.error('Error creating table shell:', error);
      throw new Error(`Failed to create table shell: ${error.message}`);
    }
  }

  /**
   * Phase 2: Append Rows in Batches
   * @param {string} tableBlockId - Table block ID from Phase 1
   * @param {Array} dataRows - Data rows to append
   * @param {number} tableWidth - Number of columns in the table
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<void>}
   */
  async appendRowsInBatches(tableBlockId, dataRows, tableWidth, progressCallback = null) {
    try {
      // Header row was already added in Phase 1
      // We only need to append data rows

      if (dataRows.length === 0) {
        if (progressCallback) {
          progressCallback('✓ No data rows to append');
        }
        return;
      }

      // Batch the data rows
      const batches = this.chunkArray(dataRows, this.MAX_BLOCKS_PER_BATCH);
      
      if (progressCallback) {
        progressCallback(`Preparing ${batches.length} batches of rows...`);
      }

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        if (progressCallback) {
          progressCallback(`Uploading batch ${batchIndex + 1}/${batches.length} (${batch.length} rows)...`);
        }

        // Convert rows to table_row blocks with proper width validation
        const rowBlocks = batch.map(row => this.createTableRowBlock(row, tableWidth));

        // Validate request size
        const requestSize = this.estimateRequestSize(rowBlocks);
        if (requestSize > this.MAX_REQUEST_SIZE_KB * 1024) {
          console.warn(`Batch ${batchIndex + 1} exceeds size limit (${Math.round(requestSize / 1024)}KB), splitting further...`);
          // Split the batch into smaller chunks
          const smallerBatches = this.splitBatchBySize(rowBlocks, this.MAX_REQUEST_SIZE_KB * 1024);
          for (let subBatchIndex = 0; subBatchIndex < smallerBatches.length; subBatchIndex++) {
            const subBatch = smallerBatches[subBatchIndex];
            await this.appendRowsToTable(tableBlockId, subBatch, `${batchIndex + 1}.${subBatchIndex + 1}`, `${batches.length}.${smallerBatches.length}`, progressCallback);
          }
          continue;
        }

        // Append this batch to the table (not the page!)
        await this.appendRowsToTable(tableBlockId, rowBlocks, batchIndex + 1, batches.length, progressCallback);

        if (progressCallback) {
          progressCallback(`✓ Batch ${batchIndex + 1}/${batches.length} completed`);
        }

        // Rate limiting delay between batches
        if (batchIndex < batches.length - 1) {
          if (progressCallback) {
            progressCallback(`Rate limiting: waiting ${this.BATCH_DELAY_MS}ms...`);
          }
          await this.delay(this.BATCH_DELAY_MS);
        }
      }

      if (progressCallback) {
        progressCallback(`✓ All ${dataRows.length} rows appended successfully`);
      }

    } catch (error) {
      console.error('Error appending rows in batches:', error);
      throw new Error(`Failed to append rows: ${error.message}`);
    }
  }

  /**
   * Append a batch of rows to the table (targeting table block, not page)
   * @param {string} tableBlockId - Table block ID
   * @param {Array} rowBlocks - Array of table_row blocks
   * @param {number} batchNum - Current batch number
   * @param {number} totalBatches - Total number of batches
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Object>} API response
   */
  async appendRowsToTable(tableBlockId, rowBlocks, batchNum, totalBatches, progressCallback = null) {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const url = `${this.client.baseURL}blocks/${tableBlockId}/children`;
        const body = { children: rowBlocks };
        
        // Log the request
        this.client.logRequest('PATCH', url, body, this.client.headers);
        
        if (progressCallback) {
          progressCallback(`Sending batch ${batchNum}/${totalBatches} to table ${tableBlockId}...`);
        }

        const response = await fetch(url, {
          method: 'PATCH',
          headers: this.client.headers,
          body: JSON.stringify(body)
        });

        const responseData = await response.json();

        if (response.ok) {
          // Log success response
          this.client.logResponse('PATCH', url, response.status, responseData);
          
          if (progressCallback) {
            progressCallback(`✓ Batch ${batchNum}/${totalBatches} uploaded successfully`);
          }
          
          return responseData;
        }

        // Handle rate limiting (429) with exponential backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, retryCount) * 1000;
          
          this.client.logResponse('PATCH', url, response.status, responseData, 'Rate limited');
          
          if (progressCallback) {
            progressCallback(`Rate limited. Retrying batch ${batchNum} after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
          }
          
          await this.delay(delay);
          retryCount++;
          continue;
        }

        // Handle other errors
        this.client.logResponse('PATCH', url, response.status, responseData, responseData.message || 'Unknown error');
        throw new Error(`Notion API error: ${response.status} - ${responseData.message || 'Unknown error'}`);
        
      } catch (error) {
        if (retryCount >= maxRetries - 1) {
          console.error(`Error appending batch ${batchNum} to table:`, error);
          throw error;
        }
        
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        
        if (progressCallback) {
          progressCallback(`Request failed. Retrying batch ${batchNum} after ${delay}ms (attempt ${retryCount}/${maxRetries})`);
        }
        
        await this.delay(delay);
      }
    }
  }

  /**
   * Create a table_row block from data
   * @param {Array} rowData - Array of cell values
   * @param {number} tableWidth - Expected number of columns
   * @returns {Object} table_row block
   */
  createTableRowBlock(rowData, tableWidth) {
    // Ensure row has exactly the same number of cells as table width
    const normalizedRow = this.normalizeRowData(rowData, tableWidth);
    
    return {
      object: 'block',
      type: 'table_row',
      table_row: {
        cells: normalizedRow.map(cellValue => [{
          type: 'text',
          text: {
            content: this.sanitizeCellContent(String(cellValue || '')),
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
          plain_text: this.sanitizeCellContent(String(cellValue || '')),
          href: null
        }])
      }
    };
  }

  /**
   * Normalize row data to match table width
   * @param {Array} rowData - Original row data
   * @param {number} tableWidth - Expected number of columns
   * @returns {Array} Normalized row with correct number of cells
   */
  normalizeRowData(rowData, tableWidth) {
    const normalized = [...rowData]; // Copy the array
    
    // If row has fewer cells than table width, pad with empty strings
    while (normalized.length < tableWidth) {
      normalized.push('');
    }
    
    // If row has more cells than table width, truncate
    if (normalized.length > tableWidth) {
      console.warn(`Row has ${normalized.length} cells but table width is ${tableWidth}. Truncating extra cells.`);
      normalized.splice(tableWidth);
    }
    
    return normalized;
  }

  /**
   * Sanitize cell content to meet Notion's requirements
   * @param {string} content - Cell content
   * @returns {string} Sanitized content (never truncated)
   */
  sanitizeCellContent(content) {
    if (!content) return '';
    
    // Clean up content first
    let cleanedContent = String(content)
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .replace(/\t/g, ' ') // Replace tabs with spaces
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
    
    // If content is within limits, return as-is
    if (cleanedContent.length <= this.MAX_TEXT_LENGTH) {
      return cleanedContent;
    }
    
    // For content that exceeds the limit, we need to handle this at a higher level
    // This method should never truncate - that will be handled by splitting the table
    console.warn(`Cell content too long (${cleanedContent.length} chars), will be handled by table splitting`);
    
    // Log warning for user feedback if available
    if (this.client && typeof this.client.logWarning === 'function') {
      this.client.logWarning('large_cell_content', `Table cell content is ${cleanedContent.length} characters (exceeds ${this.MAX_TEXT_LENGTH} limit). Table will be split to preserve all content.`, {
        originalLength: cleanedContent.length,
        maxLength: this.MAX_TEXT_LENGTH,
        action: 'table_will_be_split'
      });
    }
    
    // Return the full content - splitting will be handled at the table level
    return cleanedContent;
  }

  /**
   * Estimate request size in bytes
   * @param {Array} blocks - Array of blocks
   * @returns {number} Estimated size in bytes
   */
  estimateRequestSize(blocks) {
    const jsonString = JSON.stringify({ children: blocks });
    return new Blob([jsonString]).size;
  }

  /**
   * Chunk array into smaller arrays
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
   * Split a batch of blocks by size to respect request limits
   * @param {Array} blocks - Array of blocks to split
   * @param {number} maxSizeBytes - Maximum size in bytes
   * @returns {Array} Array of smaller batches
   */
  splitBatchBySize(blocks, maxSizeBytes) {
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const block of blocks) {
      const blockSize = this.estimateRequestSize([block]);
      
      // If adding this block would exceed the limit, start a new batch
      if (currentSize + blockSize > maxSizeBytes && currentBatch.length > 0) {
        batches.push([...currentBatch]);
        currentBatch = [];
        currentSize = 0;
      }
      
      // If a single block is too large, create a fallback
      if (blockSize > maxSizeBytes) {
        console.warn(`Single block too large (${Math.round(blockSize / 1024)}KB), creating fallback`);
        const fallbackBlock = {
          object: 'block',
          type: 'table_row',
          table_row: {
            cells: [[{
              type: 'text',
              text: { content: '[Content too large - truncated]', link: null },
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
              plain_text: '[Content too large - truncated]',
              href: null
            }]]
          }
        };
        currentBatch.push(fallbackBlock);
        currentSize += this.estimateRequestSize([fallbackBlock]);
      } else {
        currentBatch.push(block);
        currentSize += blockSize;
      }
    }
    
    // Add the last batch if it has content
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    
    return batches;
  }

  /**
   * Add a delay between operations
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Intelligently detect table headers from parsed rows
   * @param {Array} rows - Array of parsed table rows
   * @returns {Object} Object with headers and rawDataRows
   */
  detectTableHeaders(rows) {
    // Fast path: if the markdown table includes a header row immediately followed by a separator line,
    // prefer that header order exactly as authored.
    try {
      const extracted = this.extractHeadersFromTableLinesIfPresent(rows);
      if (extracted) return extracted;
    } catch (_) { /* fall back to heuristic below */ }
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
    
    console.log('SimpleTableBuilder row length analysis:', {
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
      console.warn(`SimpleTableBuilder: Using row ${headerRowIndex + 1} as headers instead of row 1`);
      return {
        headers: rows[headerRowIndex],
        rawDataRows: rows.slice(headerRowIndex + 1)
      };
    }

    // Strategy 3: Create synthetic headers based on the most common length
    console.warn(`SimpleTableBuilder: No suitable header row found. Creating synthetic headers for ${mostCommonLength} columns`);
    const syntheticHeaders = Array.from({ length: mostCommonLength }, (_, i) => `Column ${i + 1}`);
    
    return {
      headers: syntheticHeaders,
      rawDataRows: rows // Use all rows as data since we created synthetic headers
    };
  }

  /**
   * If rows came from raw table lines split on '|', detect a GFM header row pattern:
   * Row 0: header cells
   * Row 1: separator cells comprised of dashes with optional colons for alignment.
   * Returns null if pattern not found.
   * @param {Array<Array<string>>} rows
   * @returns {{headers: Array<string>, rawDataRows: Array<Array<string>>}|null}
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
      // allow at least 3 dashes with optional leading/trailing colons
      return /^:?-{3,}:?$/.test(s);
    };
    if (!sep.every(isSeparatorCell)) return null;

    // Preserve header order exactly
    const headers = header.map(h => String(h || '').trim());
    const rawDataRows = rows.slice(2);
    return { headers, rawDataRows };
  }

  /**
   * Smart table grouping based on Entity Type, Field, or primaryType headers
   * @param {Array} headers - Table headers
   * @param {Array} dataRows - Table data rows
   * @param {number} maxRowsPerGroup - Maximum rows per group
   * @returns {Array} Array of grouped table data
   */
  groupTableBySmartColumn(headers, dataRows, maxRowsPerGroup = 25) {
    if (dataRows.length === 0) {
      return [{ groupName: 'All', headers, dataRows: [] }];
    }

    // Determine the best grouping column
    const groupingColumnIndex = this.findBestGroupingColumn(headers);
    const groupingColumnName = headers[groupingColumnIndex] || 'Unknown';
    
    console.log(`Smart grouping: Using column "${groupingColumnName}" (index ${groupingColumnIndex}) for grouping`);

    const groups = [];
    let currentGroup = null;
    let currentGroupRows = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const groupingValue = row[groupingColumnIndex] || 'Unknown';
      
      // If this is a new group or we've hit the row limit
      if (!currentGroup || 
          currentGroup.groupName !== groupingValue || 
          currentGroupRows.length >= maxRowsPerGroup) {
        
        // Save previous group if it has data
        if (currentGroup && currentGroupRows.length > 0) {
          groups.push({
            groupName: currentGroup.groupName,
            headers: currentGroup.headers,
            dataRows: [...currentGroupRows],
            groupingColumn: groupingColumnName
          });
        }
        
        // Start new group
        currentGroup = {
          groupName: groupingValue,
          headers: headers
        };
        currentGroupRows = [row];
      } else {
        // Add to current group
        currentGroupRows.push(row);
      }
    }
    
    // Add the last group
    if (currentGroup && currentGroupRows.length > 0) {
      groups.push({
        groupName: currentGroup.groupName,
        headers: currentGroup.headers,
        dataRows: currentGroupRows,
        groupingColumn: groupingColumnName
      });
    }
    
    return groups;
  }

  /**
   * Find the best column for grouping based on common patterns
   * @param {Array} headers - Table headers
   * @returns {number} Index of the best grouping column
   */
  findBestGroupingColumn(headers) {
    // Priority order for grouping columns
    const groupingPriorities = [
      'Entity Type',
      'entityType', 
      'entity_type',
      'Field',
      'field',
      'primaryType',
      'primary_type',
      'type',
      'category',
      'group'
    ];

    // Look for exact matches first
    for (const priority of groupingPriorities) {
      const index = headers.findIndex(header => 
        header && header.toLowerCase() === priority.toLowerCase()
      );
      if (index !== -1) {
        console.log(`Found exact match for grouping column: "${headers[index]}" at index ${index}`);
        return index;
      }
    }

    // Look for partial matches
    for (const priority of groupingPriorities) {
      const index = headers.findIndex(header => 
        header && header.toLowerCase().includes(priority.toLowerCase())
      );
      if (index !== -1) {
        console.log(`Found partial match for grouping column: "${headers[index]}" at index ${index}`);
        return index;
      }
    }

    // Fallback to first column
    console.log(`No specific grouping column found, using first column: "${headers[0]}"`);
    return 0;
  }

  /**
   * Convert markdown table to Notion Simple Table blocks (for use within existing flow)
   * @param {string} pageId - Parent page ID
   * @param {Array} tableLines - Array of markdown table lines
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Array>} Array of Notion block objects
   */
  async convertMarkdownTableToNotionTable(pageId, tableLines, progressCallback = null) {
    if (tableLines.length < 2) {
      throw new Error('Invalid table: need at least header and one data row');
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
      throw new Error('No valid table rows found');
    }

    // Intelligent header detection
    const { headers, rawDataRows } = this.detectTableHeaders(rows);
    
    // Debug logging to identify the issue
    console.log('SimpleTableBuilder parsing debug:');
    console.log('- Headers:', headers, 'Length:', headers.length);
    console.log('- First few data rows:', rawDataRows.slice(0, 3));
    console.log('- Original table lines:', tableLines.slice(0, 5));
    console.log('- Total parsed rows:', rows.length);
    
    // Normalize all data rows to match header length
    const dataRows = rawDataRows.map(row => this.normalizeRowData(row, headers.length));
    
    if (progressCallback) {
      progressCallback(`Converting markdown table: ${headers.length} columns, ${dataRows.length} rows`);
    }

    // Group table by smart column if it has many rows
    const MAX_ROWS_FOR_GROUPING = 25; // Reduced for better performance
    const groups = this.groupTableBySmartColumn(headers, dataRows, MAX_ROWS_FOR_GROUPING);
    
    // Convert groups to Notion inline databases instead of creating tables directly
    const blocks = [];
    
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      
      if (progressCallback) {
        progressCallback(`Creating inline database ${i + 1}/${groups.length}: ${group.groupName}`);
      }
      
      // Use the group title purely for the database name; do not add any text blocks
      const groupTitle = `${group.groupingColumn || 'Data'} - ${group.groupName}`;

      // Create inline database and populate rows
      try {
        const inlineDb = await this.client.createDatabaseOrdered(pageId, groupTitle, group.headers);
        const dbId = inlineDb?.database?.id;
        if (dbId) {
          if (group.dataRows.length > 0) {
            await this.client.addRowsToDatabase(dbId, inlineDb.sanitizedHeaders, group.dataRows);
          } else {
            // Emit a small message block after the DB to document emptiness
            blocks.push(this.client.createParagraphBlock('No differences found.'));
          }
        }
      } catch (e) {
        console.error('Failed to create inline database:', e);
      }
    }
    
    // Return no extra blocks; inline databases are created directly under the page
    return blocks;
  }

  /**
   * Create a complete table block with all data included (for use in existing flow)
   * @param {Array} headers - Table headers
   * @param {Array} dataRows - Table data rows
   * @returns {Object} Complete table block object
   */
  createCompleteTableBlock(headers, dataRows) {
    // Log table processing start
    if (this.notionLogger) {
      this.notionLogger.logTableProcessing('CREATE_TABLE_BLOCK', {
        rowCount: dataRows.length,
        columnCount: headers.length,
        hasLargeContent: this.needsTableSplitting(headers, dataRows),
        needsSplitting: this.needsTableSplitting(headers, dataRows)
      });
    }

    // Check if table needs splitting due to large content
    if (this.needsTableSplitting(headers, dataRows)) {
      if (this.notionLogger) {
        this.notionLogger.logTableProcessing('SPLIT_TABLE', {
          rowCount: dataRows.length,
          columnCount: headers.length,
          reason: 'Large content detected'
        });
      }
      return this.splitTableWithLargeContent(headers, dataRows);
    }

    // Create header row
    const headerRow = {
      object: 'block',
      type: 'table_row',
      table_row: {
        cells: headers.map(header => [{
          type: 'text',
          text: {
            content: this.sanitizeCellContent(String(header || '')),
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
          plain_text: this.sanitizeCellContent(String(header || '')),
          href: null
        }])
      }
    };

    // Create data rows
    const dataRowBlocks = dataRows.map(row => this.createTableRowBlock(row, headers.length));

    // Create complete table block
    const tableBlock = {
      object: 'block',
      type: 'table',
      table: {
        table_width: headers.length,
        has_column_header: true,
        has_row_header: false,
        children: [headerRow, ...dataRowBlocks] // Include all rows in the table
      }
    };

    // Log table creation success
    if (this.notionLogger) {
      this.notionLogger.logTableProcessing('TABLE_CREATED', {
        rowCount: dataRows.length,
        columnCount: headers.length,
        hasLargeContent: false,
        needsSplitting: false
      }, {
        tableWidth: tableBlock.table.table_width,
        totalChildren: tableBlock.table.children.length
      });
    }

    return tableBlock;
  }

  /**
   * Create a table from CSV-like data
   * @param {string} pageId - Parent page ID
   * @param {string} csvData - CSV data string
   * @param {string} tableTitle - Table title
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Object>} Created table block
   */
  async createTableFromCSV(pageId, csvData, tableTitle = null, progressCallback = null) {
    const lines = csvData.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('CSV data must have at least header and one data row');
    }

    // Simple CSV parsing (doesn't handle quoted commas)
    const rows = lines.map(line => line.split(',').map(cell => cell.trim()));
    const headers = rows[0];
    const rawDataRows = rows.slice(1);
    
    // Normalize all data rows to match header length
    const dataRows = rawDataRows.map(row => this.normalizeRowData(row, headers.length));

    if (progressCallback) {
      progressCallback(`Parsing CSV: ${headers.length} columns, ${dataRows.length} rows`);
    }

    return await this.createLargeTable(pageId, headers, dataRows, tableTitle, progressCallback);
  }

  /**
   * Create a table from JSON array data
   * @param {string} pageId - Parent page ID
   * @param {Array} jsonArray - Array of objects
   * @param {string} tableTitle - Table title
   * @param {Function} progressCallback - Progress callback
   * @returns {Promise<Object>} Created table block
   */
  async createTableFromJSON(pageId, jsonArray, tableTitle = null, progressCallback = null) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
      throw new Error('JSON data must be a non-empty array');
    }

    // Extract headers from first object
    const firstObject = jsonArray[0];
    const headers = Object.keys(firstObject);
    
    // Convert objects to rows and ensure consistent length
    const rawDataRows = jsonArray.map(obj => 
      headers.map(header => obj[header] !== undefined ? String(obj[header]) : '')
    );
    
    // Normalize all data rows to match header length (should already be correct, but just in case)
    const dataRows = rawDataRows.map(row => this.normalizeRowData(row, headers.length));

    if (progressCallback) {
      progressCallback(`Converting JSON array: ${headers.length} columns, ${dataRows.length} rows`);
    }

    return await this.createLargeTable(pageId, headers, dataRows, tableTitle, progressCallback);
  }

  /**
   * Create a simple table block without splitting logic
   * @param {Array} headers - Table headers
   * @param {Array} dataRows - Table data rows
   * @returns {Object} Table block object
   */
  createSimpleTableBlock(headers, dataRows) {
    // Create header row
    const headerRow = {
      object: 'block',
      type: 'table_row',
      table_row: {
        cells: headers.map(header => [{
          type: 'text',
          text: {
            content: this.sanitizeCellContent(String(header || '')),
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
          plain_text: this.sanitizeCellContent(String(header || '')),
          href: null
        }])
      }
    };

    // Create data rows
    const dataRowBlocks = dataRows.map(row => this.createTableRowBlock(row, headers.length));

    // Create complete table block
    return {
      object: 'block',
      type: 'table',
      table: {
        table_width: headers.length,
        has_column_header: true,
        has_row_header: false,
        children: [headerRow, ...dataRowBlocks]
      }
    };
  }

  /**
   * Convert a markdown table into a Notion Database under the given page.
   * Returns lightweight blocks to reference the created database inside the page.
   * @param {string} pageId
   * @param {Array<string>} tableLines
   * @param {string|null} databaseTitle
   * @param {Function|null} progressCallback
   * @returns {Promise<Array>} Blocks referencing the created database
   */
  async convertMarkdownTableToNotionDatabase(pageId, tableLines, databaseTitle = null, progressCallback = null) {
    if (tableLines.length < 2) {
      throw new Error('Invalid table: need at least header and one data row');
    }

    // Parse table data similarly to the table-block path
    const rows = tableLines
      .filter(line => line.trim() && !line.includes('---'))
      .map(line => {
        let cells = line.split('|').map(cell => cell.trim());
        while (cells.length > 0 && cells[0] === '') cells.shift();
        while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        return cells;
      });

    if (rows.length === 0) {
      throw new Error('No valid table rows found');
    }

    const { headers, rawDataRows } = this.detectTableHeaders(rows);
    const dataRows = rawDataRows.map(row => this.normalizeRowData(row, headers.length));

    const dbTitle = databaseTitle || `Table Data (${headers[0] || 'Data'})`;
    if (progressCallback) {
      progressCallback(`Creating database: ${dbTitle} with ${headers.length} columns, ${dataRows.length} rows...`);
    }

    // Create the database under the page
    const { database, sanitizedHeaders } = await this.client.createDatabaseOrdered(pageId, dbTitle, headers);

    // Insert rows as pages in the database
    if (dataRows.length > 0) {
      await this.client.addRowsToDatabase(database.id, sanitizedHeaders, dataRows, progressCallback);
    } else {
      // Add a message near the DB to indicate no differences
      if (progressCallback) {
        progressCallback('No differences found (0 rows).');
      }
      // Return a note block so callers can append it
      return [this.client.createParagraphBlock('No differences found.')];
    }

    if (progressCallback) {
      progressCallback(`✓ Database created with ${dataRows.length} rows`);
    }

    // For inline databases, do not add any additional summary/label blocks.
    // The inline database itself is now the only content for this section.
    return [];
  }

  /**
   * Check if table needs splitting due to large content
   * @param {Array} headers - Table headers
   * @param {Array} dataRows - Table data rows
   * @returns {boolean} True if table needs splitting
   */
  needsTableSplitting(headers, dataRows) {
    // Check headers for large content
    for (const header of headers) {
      if (String(header || '').length > this.MAX_TEXT_LENGTH) {
        return true;
      }
    }

    // Check data rows for large content
    for (const row of dataRows) {
      for (const cell of row) {
        if (String(cell || '').length > this.MAX_TEXT_LENGTH) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Split table with large content into multiple tables
   * @param {Array} headers - Table headers
   * @param {Array} dataRows - Table data rows
   * @returns {Array} Array of table blocks
   */
  splitTableWithLargeContent(headers, dataRows) {
    const largeContentColumns = [];
    const regularColumns = [];

    // Identify columns with large content
    headers.forEach((header, index) => {
      const headerLength = String(header || '').length;
      const hasLargeData = dataRows.some(row => String(row[index] || '').length > this.MAX_TEXT_LENGTH);
      
      if (headerLength > this.MAX_TEXT_LENGTH || hasLargeData) {
        largeContentColumns.push({ index, header });
      } else {
        regularColumns.push({ index, header });
      }
    });

    const tableBlocks = [];

    // Create main data table with regular columns
    if (regularColumns.length > 0) {
      const mainHeaders = regularColumns.map(col => col.header);
      const mainDataRows = dataRows.map(row => 
        regularColumns.map(col => row[col.index])
      );

      const mainTableBlock = this.createSimpleTableBlock(mainHeaders, mainDataRows);
      tableBlocks.push(this.client.createHeadingBlock('Main Data', 3));
      tableBlocks.push(mainTableBlock);
    }

    // Create separate tables for each large content column
    largeContentColumns.forEach((col, colIndex) => {
      const columnHeaders = ['Row #', col.header];
      const columnDataRows = dataRows.map((row, rowIndex) => [
        rowIndex + 1,
        row[col.index]
      ]);

      const columnTableBlock = this.createSimpleTableBlock(columnHeaders, columnDataRows);
      tableBlocks.push(this.client.createHeadingBlock(`Large Content: ${col.header}`, 3));
      tableBlocks.push(columnTableBlock);
    });

    return tableBlocks;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SimpleTableBuilder;
}
