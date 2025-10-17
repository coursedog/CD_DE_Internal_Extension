/**
 * Content Processor for Notion
 * Intelligently handles various content types, including JSON and Markdown, for optimal Notion import.
 */

class ContentProcessor {
  constructor(notionClient) {
    this.client = notionClient;
    this.MAX_CODE_BLOCK_LENGTH = 2000; // Notion's text limit per block
    this.JSON_FILE_THRESHOLD = 5000; // Switch to file attachment above this size
    this.MAX_JSON_LINES_FOR_CODE_BLOCKS = 100; // 100+ lines = file attachment
    this.tableBuilder = new SimpleTableBuilder(this.client);
    this.useNotionDatabasesForTables = true; // toggle to create databases instead of table blocks
  }

  async processContent(content, contentType, pageId = null, progressCallback = null) {
    if (contentType === 'json' || this.shouldUseJSONProcessor(content)) {
      return await this.handleJSONContent(content, pageId, progressCallback);
    } else if (contentType === 'markdown') {
      return await this.processMarkdownForNotion(content, pageId, progressCallback);
    } else {
      return this.client.convertContentToBlocksSync(content, contentType);
    }
  }

  shouldUseJSONProcessor(content) {
    const hasJSONCodeBlocks = /```json[\s\S]*?```/i.test(content);
    const hasMultiLineJSONObjects = /\{[\s\S]*?\n[\s\S]*?\}/.test(content);
    const hasMultiLineJSONArrays = /\\[[\s\S]*?\n[\s\S]*?\\]/.test(content);
    return hasJSONCodeBlocks || hasMultiLineJSONObjects || hasMultiLineJSONArrays;
  }

  async handleJSONContent(jsonContent, pageId = null, progressCallback = null) {
    try {
      if (jsonContent.length > 10 * 1024 * 1024) { // 10MB limit
        if (progressCallback) progressCallback('JSON content too large, creating file attachment...');
        return await this.createJSONFileAttachment(jsonContent, 'large_data.json', pageId, progressCallback);
      }
      const parsedJSON = JSON.parse(jsonContent);
      const prettyJSON = JSON.stringify(parsedJSON, null, 2);
      const lineCount = prettyJSON.split('\n').length;
      
      if (progressCallback) progressCallback(`Processing JSON content (${prettyJSON.length} characters, ${lineCount} lines)...`);

      if ((lineCount > this.MAX_JSON_LINES_FOR_CODE_BLOCKS || prettyJSON.length > this.JSON_FILE_THRESHOLD) && pageId) {
        if (progressCallback) progressCallback(`JSON has ${lineCount} lines (>${this.MAX_JSON_LINES_FOR_CODE_BLOCKS}) or is too large, creating file attachment...`);
        return await this.createJSONFileAttachment(prettyJSON, 'data.json', pageId, progressCallback);
      }

      if (progressCallback) progressCallback('Creating JSON code blocks...');
      return this.createJSONCodeBlocks(prettyJSON, 'JSON Data');

    } catch (error) {
      console.error('Error parsing JSON content:', error);
      if (progressCallback) progressCallback('Invalid JSON, treating as plain text...');
      const fallbackContent = jsonContent.length > 2000 ? jsonContent.substring(0, 2000) + '...[truncated]' : jsonContent;
      return [this.client.createParagraphBlock('Invalid JSON content:'), this.client.createCodeBlock(fallbackContent, 'text')];
    }
  }

  createJSONCodeBlocks(prettyJSON, title) {
    const blocks = [this.client.createHeadingBlock(title, 3)];
    if (prettyJSON.length <= this.MAX_CODE_BLOCK_LENGTH) {
      blocks.push(this.client.createCodeBlock(prettyJSON, 'json'));
    } else {
      const chunks = this.chunkJSON(prettyJSON, this.MAX_CODE_BLOCK_LENGTH);
      blocks.push(this.client.createParagraphBlock(`⚠️ Large JSON split into ${chunks.length} code blocks:`));
      chunks.forEach((chunk, index) => {
        blocks.push(this.client.createHeadingBlock(`Part ${index + 1} of ${chunks.length}`, 3));
        blocks.push(this.client.createCodeBlock(chunk, 'json'));
      });
    }
    return blocks;
  }

  async createJSONFileAttachment(jsonContent, fileName, pageId, progressCallback = null) {
    try {
        if (progressCallback) progressCallback(`Creating JSON file attachment: ${fileName}...`);

        const jsonBlob = new Blob([jsonContent], { type: 'application/json' });
        let dataUrl = null;

        if (jsonBlob.size < 1024 * 1024) { // 1MB limit for data URLs
            try {
                dataUrl = await this.createDataURL(jsonBlob);
                if (dataUrl && dataUrl.length > 2000) {
                    console.warn(`Data URL too long (${dataUrl.length} chars), skipping link creation`);
                    dataUrl = null;
                }
            } catch (error) {
                console.error('Error creating data URL:', error);
                dataUrl = null;
            }
        }

        const lineCount = jsonContent.split('\n').length;
        const reason = lineCount > this.MAX_JSON_LINES_FOR_CODE_BLOCKS ? `${lineCount} lines (>${this.MAX_JSON_LINES_FOR_CODE_BLOCKS} line limit)` : `${this.formatFileSize(jsonBlob.size)} size`;

        const blocks = [
            this.client.createHeadingBlock(`📄 ${fileName}`, 3),
            this.client.createParagraphBlock(`JSON file (${reason}) - too large for inline display.`)
        ];

        if (dataUrl && dataUrl.length <= 2000) {
            blocks.push({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: [{
                        type: 'text',
                        text: {
                            content: '📥 Download JSON file',
                            link: { url: dataUrl }
                        }
                    }]
                }
            });
        } else {
            const reasonMsg = dataUrl && dataUrl.length > 2000 ? 'URL too long for Notion' : 'file too large';
            blocks.push(this.client.createParagraphBlock(`⚠️ JSON file ${reasonMsg}. Please use the extension to download the file.`));
        }

        const parsed = JSON.parse(jsonContent);
        const preview = this.createJSONPreview(parsed);
        blocks.push(this.client.createHeadingBlock('📋 JSON Structure Preview', 3));
        blocks.push(this.client.createParagraphBlock(preview.substring(0, 2000)));

        if (progressCallback) progressCallback(`✓ JSON file attachment created: ${fileName}`);
        return blocks;

    } catch (error) {
      if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
        console.log('JSON file attachment creation cancelled by user');
        return [];
      }
      console.error('Error creating JSON file attachment:', error);
        if (progressCallback) progressCallback(`✗ Error creating file attachment: ${error.message}`);
        return this.createJSONCodeBlocks(jsonContent, `${fileName} (Fallback)`);
    }
  }

  createDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
  }

  createJSONPreview(jsonObj) {
    if (Array.isArray(jsonObj)) {
        const firstItem = jsonObj[0];
        const itemType = typeof firstItem;
        const keys = (itemType === 'object' && firstItem !== null) ? Object.keys(firstItem).slice(0, 5).join(', ') + (Object.keys(firstItem).length > 5 ? '...' : '') : '';
        return `Array of ${jsonObj.length} ${itemType}s${keys ? ` with keys: ${keys}`: ''}`;
    } else if (typeof jsonObj === 'object' && jsonObj !== null) {
        const keys = Object.keys(jsonObj);
        return `Object with ${keys.length} properties: ${keys.slice(0, 10).join(', ') + (keys.length > 10 ? '...' : '')}`;
    }
    return `${typeof jsonObj} value: ${String(jsonObj).substring(0, 100)}`;
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / (1024 * 1024)) + ' MB';
  }

  chunkJSON(jsonString, maxLength) {
    const chunks = [];
    let currentChunk = '';
    for (const line of jsonString.split('\n')) {
        if (currentChunk.length + line.length + 1 > maxLength && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

	async processMarkdownForNotion(markdownContent, pageId, options = {}) {
		const blocks = [];
		const lines = markdownContent.split('\n');
		
		let currentSection = '';
		let pendingSectionHeading = null; // heading block to emit if section has no table
		let sectionHasTable = false;
		let currentTable = [];
		let currentParagraph = '';
		let inTable = false;
		let afterEmptyTableExpectOneLine = false;
		
		// Code block state
		let inCodeBlock = false;
		let codeLanguage = 'text';
		let codeBuffer = [];
		
		const flushParagraph = () => {
			// Intentionally skip emitting non-table paragraph text on pages with inline databases
			currentParagraph = '';
		};
		
		const flushTable = async () => {
			if (inTable && currentTable.length > 0) {
				// Detect if table has data rows
				const parsedRows = currentTable
					.filter(line => line.trim() && !line.includes('---'))
					.map(line => {
						let cells = line.split('|').map(cell => cell.trim());
						while (cells.length > 0 && cells[0] === '') cells.shift();
						while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
						return cells;
					});
				let isEmptyTable = false;
				try {
					const headerInfo = this.tableBuilder.detectTableHeaders(parsedRows);
					isEmptyTable = (headerInfo.rawDataRows || []).length === 0;
				} catch (_) {
					isEmptyTable = parsedRows.length <= 1;
				}

				const tableBlocks = await this.createTableBlocks(currentSection, currentTable, pageId);
				blocks.push(...tableBlocks);
				currentTable = [];
				inTable = false;

				// If table was empty, capture the next line of text under the table
				if (isEmptyTable) {
					afterEmptyTableExpectOneLine = true;
				}
			}
		};
		
		const chunkByLines = (text, maxLen) => {
			const pieces = [];
			let chunk = '';
			for (const ln of text.split('\n')) {
				if ((chunk.length + ln.length + 1) > maxLen && chunk.length > 0) {
					pieces.push(chunk);
					chunk = ln;
				} else {
					chunk += (chunk ? '\n' : '') + ln;
				}
			}
			if (chunk) pieces.push(chunk);
			return pieces;
		};
		
		const flushCodeBlock = () => {
			if (!inCodeBlock) return;
			let codeText = codeBuffer.join('\n');
			if (codeLanguage && codeLanguage.toLowerCase() === 'json') {
				try {
					codeText = JSON.stringify(JSON.parse(codeText), null, 2);
				} catch (_) { /* keep original if invalid JSON */ }
			}
			// If requested, add an H3 title before this code block group (e.g., CAC Report)
			if (options && options.titleEachCodeBlock && currentSection && currentSection.trim()) {
				blocks.push(this.client.createHeadingBlock(currentSection.trim(), 3));
			}
			if (codeText.length <= this.MAX_CODE_BLOCK_LENGTH) {
				blocks.push(this.client.createCodeBlock(codeText, (codeLanguage || 'text').toLowerCase()));
			} else {
				const chunks = codeLanguage && codeLanguage.toLowerCase() === 'json'
					? this.chunkJSON(codeText, this.MAX_CODE_BLOCK_LENGTH)
					: chunkByLines(codeText, this.MAX_CODE_BLOCK_LENGTH);
				chunks.forEach(chunk => {
					blocks.push(this.client.createCodeBlock(chunk, (codeLanguage || 'text').toLowerCase()));
				});
			}
			// reset
			inCodeBlock = false;
			codeLanguage = 'text';
			codeBuffer = [];
		};
		
		for (let i = 0; i < lines.length; i++) {
			const rawLine = lines[i];
			const line = rawLine.trim();
			
			// Handle start/end of fenced code blocks
			if (line.startsWith('```')) {
				if (!inCodeBlock) {
					// starting a code block
					await flushTable();
					flushParagraph();
					const match = line.match(/^```\s*([a-zA-Z0-9_-]+)?/);
					codeLanguage = match && match[1] ? match[1] : 'text';
					inCodeBlock = true;
					codeBuffer = [];
				} else {
					// closing a code block
					flushCodeBlock();
				}
				continue;
			}
			
			if (inCodeBlock) {
				// Keep raw line including indentation inside code blocks
				codeBuffer.push(rawLine);
				continue;
			}
			
			// Headings (record section for DB title; optionally emit heading text)
			if (line.startsWith('##') || line.startsWith('###')) {
				await flushTable();
				flushParagraph();
				currentSection = line.replace(/^#+\s*/, '').trim();
				// Defer heading emission: only emit immediately if explicitly allowed
				if (options.allowHeadings) {
					blocks.push(this.client.createHeadingBlock(currentSection, line.startsWith('##') ? 2 : 3));
					pendingSectionHeading = null;
					sectionHasTable = false;
				} else {
					pendingSectionHeading = this.client.createHeadingBlock(currentSection, line.startsWith('##') ? 2 : 3);
					sectionHasTable = false;
				}
				continue;
			}
			
			// Table detection (skip while in code)
			if (line.includes('|') && line.length > 0) {
				flushParagraph();
				if (!inTable) inTable = true;
				sectionHasTable = true;
				currentTable.push(line);
				continue;
			}
			
			if (inTable && !line.includes('|')) {
				await flushTable();
			}
			
			// Regular paragraph lines are ignored on inline-database pages,
			// except we include the single line immediately following an empty table
			if (!inTable) {
				if (line.length === 0) {
					flushParagraph();
				} else if (afterEmptyTableExpectOneLine) {
					// For sections where an empty table was detected, include the first line after it
					if (pendingSectionHeading) {
						blocks.push(pendingSectionHeading);
						pendingSectionHeading = null;
					}
					blocks.push(this.client.createParagraphBlock(line));
					afterEmptyTableExpectOneLine = false;
				} else if (pendingSectionHeading && sectionHasTable === false) {
					// Section had no table at all: include the deferred heading and this one explanatory line
					blocks.push(pendingSectionHeading);
					pendingSectionHeading = null;
					blocks.push(this.client.createParagraphBlock(line));
					// Do not include subsequent non-table lines for this section
					sectionHasTable = null; // sentinel to avoid re-adding
				} else {
					// ignore non-table content
				}
			}
		}
		
		// Flush any remaining constructs
		if (inCodeBlock) flushCodeBlock();
		await flushTable();
		flushParagraph();
		// If a section ended with no table and we never saw a line to attach, emit the heading alone
		if (pendingSectionHeading && sectionHasTable === false) {
			blocks.push(pendingSectionHeading);
			pendingSectionHeading = null;
		}
		
		return blocks;
  }

  async createTableBlocks(sectionTitle, tableLines, pageId) {
    const blocks = [];
    if (tableLines.length === 0) return blocks;
		try {
		if (this.useNotionDatabasesForTables && pageId) {
				// Use the last heading text as the database title (no visible text blocks)
				const dbTitle = sectionTitle ? `${sectionTitle}` : 'Table Data';
				// Do not append a title block; inline database already shows its title
				const maybeBlocks = await this.tableBuilder.convertMarkdownTableToNotionDatabase(pageId, tableLines, dbTitle);
				if (Array.isArray(maybeBlocks) && maybeBlocks.length > 0) {
					blocks.push(...maybeBlocks);
				}
			} else {
        const tableBlocks = await this.tableBuilder.convertMarkdownTableToNotionTable(pageId, tableLines);
        if (Array.isArray(tableBlocks)) {
          blocks.push(...tableBlocks);
        } else if (tableBlocks) {
          blocks.push(tableBlocks);
        }
      }
    } catch (error) {
      if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
        console.log('Table creation cancelled by user');
        return blocks; // do not log as error or create fallbacks
      }
      console.error('Error creating table content:', error);
      blocks.push(...this.createFallbackTableBlocks(tableLines));
    }
    return blocks;
  }

  createFallbackTableBlocks(tableLines) {
    const rows = tableLines.filter(line => line.trim() && !line.includes('---')).map(line => {
        let cells = line.split('|').map(cell => cell.trim());
        while (cells.length > 0 && cells[0] === '') cells.shift();
        while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        return cells;
    });

    if (rows.length === 0) return [this.client.createParagraphBlock('No table data available')];

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const headerText = headers.join(' | ');

    const blocks = [
        this.client.createParagraphBlock(`**${headerText}**`),
        this.client.createParagraphBlock('─'.repeat(headerText.length))
    ];

    dataRows.forEach(row => {
        blocks.push(this.client.createParagraphBlock(row.join(' | ')));
    });

    return blocks;
  }

  async processReportForNotion(reportContent, reportTitle, pageId, options = {}) {
    try {
        const blocks = [];
        if (!options.suppressTopHeading && this.client && typeof this.client.createHeadingBlock === 'function') {
            blocks.push(this.client.createHeadingBlock(reportTitle, 2));
        }
        if (reportContent && typeof reportContent === 'string') {
            const tableBlocks = await this.processMarkdownForNotion(reportContent, pageId, options);
            if (Array.isArray(tableBlocks)) {
                blocks.push(...tableBlocks);
            }
        }
        return blocks;
    } catch (error) {
        if (typeof NotionClient !== 'undefined' && NotionClient.isCancellationError && NotionClient.isCancellationError(error)) {
          console.log('processReportForNotion cancelled by user');
          return [];
        }
        console.error('Error in processReportForNotion:', error);
        return [];
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentProcessor;
}
