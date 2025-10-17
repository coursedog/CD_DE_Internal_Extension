/**
 * NotionCompiler
 * Compiles a single Markdown document into a sequence of concrete Notion API calls
 * that respect limits and mapping rules. Produces an object with { plan, batches, notes }.
 */

class NotionCompiler {
  constructor() {
    this.NOTION_BASE = 'https://api.notion.com/v1/';
    this.HEADERS = {
      'Authorization': 'Bearer <omitted>',
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };
    this.PARAGRAPH_CHUNK = 1800; // split paragraphs at 1,800 chars
    this.APPEND_CHILDREN_MAX = 100; // max children per append
  }

  compileMarkdownToPlan(markdown, destinationPageId) {
    const plan = [];
    const batches = [];
    const notes = [];

    // 1) Parse markdown into a linear stream of content items preserving order
    const parsed = this.parseMarkdown(markdown);

    // Determine report title (first H1)
    const title = parsed.firstH1 || 'Imported report';
    const prefaceKV = parsed.prefaceKeyValues;

    // 2) Create root page
    plan.push('Create root page');
    const rootPageReq = this.reqPost('pages', {
      parent: { type: 'page_id', page_id: destinationPageId },
      properties: {
        title: {
          title: [ { text: { content: title } } ]
        }
      },
      children: []
    });
    batches.push(rootPageReq);

    // We will refer to the root page id as {rootId} placeholder in subsequent URLs
    // The executor should replace {rootId} with the response id of the first request.
    const rootIdPlaceholder = '{rootId}';

    // PRIORITY: Move Field existence check tables to the top (before all others)
    const isFieldExistenceHeading = (text) => /field\s+exis(t|st)ence|field\s+exis(t|st)ance/i.test(String(text || ''));
    const consumed = new Set();
    const priorityPairs = [];
    for (let i = 0; i < (parsed.items || []).length; i++) {
      const itm = parsed.items[i];
      if (itm && itm.kind === 'table') {
        const prev = parsed.items[i - 1];
        if (prev && prev.kind === 'heading' && isFieldExistenceHeading(prev.text)) {
          priorityPairs.push({ headingIndex: i - 1, tableIndex: i });
          consumed.add(i - 1);
          consumed.add(i);
        }
      }
    }

    // Emit priority pairs first: heading then the associated table as an inline DB
    for (const pair of priorityPairs) {
      const headingItem = parsed.items[pair.headingIndex];
      const tableItem = parsed.items[pair.tableIndex];
      if (headingItem && headingItem.kind === 'heading') {
        // Append the heading immediately at the top
        const headingBlock = this.blockHeading(headingItem.text, headingItem.level);
        plan.push('Append content (Field existence heading)');
        batches.push(this.reqPatch(`blocks/${rootIdPlaceholder}/children`, { children: [headingBlock] }));
      }
      if (tableItem && tableItem.kind === 'table') {
        const { schema, titlePropName, titleValues, propNamesByHeaderIndex, selectOptionsNotes } = this.inferTableSchema(tableItem.headers, tableItem.rows);
        notes.push(...selectOptionsNotes);

        const dbTitle = tableItem.title || this.deriveTableTitle(tableItem.headers);
        plan.push(`Create DB: ${dbTitle} (Field existence)`);

        // Phase 1: create with only title
        const titleOnly = {}; titleOnly[titlePropName] = { title: {} };
        const dbCreateReq = this.reqPost('databases', {
          parent: { type: 'page_id', page_id: rootIdPlaceholder },
          title: [ { type: 'text', text: { content: dbTitle } } ],
          is_inline: true,
          properties: titleOnly
        });
        batches.push(dbCreateReq);

        // Placeholder for the DB created above
        const dbIdPlaceholder = `{dbId_${batches.length}}`;

        // Phase 2: add remaining properties in reversed order
        const reversedProps = propNamesByHeaderIndex.filter(n => n !== titlePropName).slice().reverse();
        for (const pname of reversedProps) {
          const propDef = {}; propDef[pname] = schema[pname];
          batches.push(this.reqPatch(`databases/${dbIdPlaceholder}`, { properties: propDef }));
        }

        // Rows
        const rowRequests = this.buildRowRequests(
          dbIdPlaceholder,
          tableItem.headers,
          tableItem.rows,
          schema,
          titlePropName,
          titleValues,
          propNamesByHeaderIndex
        );
        if (rowRequests.length > 0) {
          plan.push(`Create DB rows: ${dbTitle} (pages 1-${rowRequests.length})`);
          batches.push(...rowRequests);
        } else {
          // Document empty table
          batches.push(this.reqPatch(`blocks/${rootIdPlaceholder}/children`, { children: [ this.blockParagraph('No differences found.') ] }));
        }
      }
    }

    // 3) Build append children batches and interleave table creation in order
    let currentChildren = [];

    // Add preface key-values (as bulleted list) at top if present
    if (prefaceKV.length > 0) {
      for (const { key, value } of prefaceKV) {
        currentChildren.push(this.blockBulletedList(`${key}: ${value}`));
      }
    }

    const pushCurrentChildren = () => {
      if (currentChildren.length === 0) return;
      const chunks = this.chunkArray(currentChildren, this.APPEND_CHILDREN_MAX);
      chunks.forEach((children, idx) => {
        plan.push(chunks.length > 1 ? `Append content (chunk ${idx + 1}/${chunks.length})` : 'Append content');
        batches.push(this.reqPatch(`blocks/${rootIdPlaceholder}/children`, { children }));
      });
      currentChildren = [];
    };

    // Iterate parsed items preserving order
    parsed.items.forEach((item, index) => {
      if (consumed.has(index)) return; // skip already emitted priority items
      switch (item.kind) {
        case 'heading': {
          currentChildren.push(this.blockHeading(item.text, item.level));
          break;
        }
        case 'divider': {
          currentChildren.push(this.blockDivider());
          break;
        }
        case 'paragraph': {
          const chunks = this.chunkParagraph(item.text, this.PARAGRAPH_CHUNK);
          chunks.forEach((txt) => currentChildren.push(this.blockParagraph(txt)));
          if (chunks.length > 1) notes.push(`Split paragraph at item ${index + 1} into ${chunks.length} blocks`);
          break;
        }
        case 'bulleted_list_item': {
          currentChildren.push(this.blockBulletedList(item.text));
          break;
        }
        case 'numbered_list_item': {
          currentChildren.push(this.blockNumberedList(item.text));
          break;
        }
        case 'to_do': {
          currentChildren.push(this.blockToDo(item.text, item.checked));
          break;
        }
        case 'quote': {
          currentChildren.push(this.blockQuote(item.text));
          break;
        }
        case 'code': {
          currentChildren.push(this.blockCode(item.code, item.language || 'text'));
          break;
        }
        case 'table': {
          // Flush any accumulated children first to preserve order
          pushCurrentChildren();

          // Create inline database for this table
          const { schema, titlePropName, titleValues, propNamesByHeaderIndex, selectOptionsNotes } = this.inferTableSchema(item.headers, item.rows);
          notes.push(...selectOptionsNotes);

          const dbTitle = item.title || this.deriveTableTitle(item.headers);
          plan.push(`Create DB: ${dbTitle}`);
          // Phase 1: create DB with only the title property to lock column order
          const titleOnly = {}; titleOnly[titlePropName] = { title: {} };
          const dbCreateReq = this.reqPost('databases', {
            parent: { type: 'page_id', page_id: rootIdPlaceholder },
            title: [ { type: 'text', text: { content: dbTitle } } ],
            is_inline: true,
            properties: titleOnly
          });
          batches.push(dbCreateReq);

          // Placeholder for the DB created above (must be computed immediately after push)
          const dbIdPlaceholder = `{dbId_${batches.length}}`;

          // Phase 2: add remaining properties in REVERSE order (UI reverses them)
          const reversedProps = propNamesByHeaderIndex.filter(n => n !== titlePropName).slice().reverse();
          for (const pname of reversedProps) {
            const propDef = {}; propDef[pname] = schema[pname];
            batches.push(this.reqPatch(`databases/${dbIdPlaceholder}`, { properties: propDef }));
          }

          // Create row pages for the table (or add empty-note)
          const rowRequests = this.buildRowRequests(
            dbIdPlaceholder,
            item.headers,
            item.rows,
            schema,
            titlePropName,
            titleValues,
            propNamesByHeaderIndex
          );
          if (rowRequests.length > 0) {
            plan.push(`Create DB rows: ${dbTitle} (pages 1-${rowRequests.length})`);
            batches.push(...rowRequests);
          } else {
            // Document empty table
            batches.push(this.reqPatch(`blocks/${rootIdPlaceholder}/children`, { children: [ this.blockParagraph('No differences found.') ] }));
          }
          break;
        }
        default: {
          // Fallback to paragraph
          currentChildren.push(this.blockParagraph(item.text || ''));
          break;
        }
      }
    });

    // Flush trailing children
    pushCurrentChildren();

    return { plan, batches, notes };
  }

  // ---------- Parsing ----------

  parseMarkdown(markdown) {
    const lines = (markdown || '').split('\n');
    const items = [];
    let firstH1 = null;
    let i = 0;
    let inCode = false;
    let codeLang = '';
    let codeBuffer = [];
    let prefaceKeyValues = [];
    let seenFirstHeading = false;

    const isKV = (txt) => /^(\S[^:]{0,200}):\s+(.+)$/.test(txt);

    while (i < lines.length) {
      let raw = lines[i];
      let line = raw;

      // Code block fences
      const codeFenceMatch = line.match(/^```\s*([a-zA-Z0-9+-]*)\s*$/);
      if (codeFenceMatch) {
        if (!inCode) {
          inCode = true;
          codeLang = codeFenceMatch[1] || 'text';
          codeBuffer = [];
        } else {
          // close code
          items.push({ kind: 'code', language: codeLang || 'text', code: codeBuffer.join('\n') });
          inCode = false;
          codeLang = '';
          codeBuffer = [];
        }
        i++; continue;
      }
      if (inCode) {
        codeBuffer.push(raw);
        i++; continue;
      }

      if (!seenFirstHeading && isKV(line.trim())) {
        const m = line.trim().match(/^(\S[^:]{0,200}):\s+(.+)$/);
        if (m) {
          prefaceKeyValues.push({ key: m[1].trim(), value: m[2].trim() });
          i++; continue;
        }
      }

      // Heading
      if (/^#{1,3}\s+/.test(line)) {
        seenFirstHeading = true;
        const level = (line.match(/^#+/)[0] || '#').length;
        const text = line.replace(/^#{1,3}\s+/, '').trim();
        if (level === 1 && !firstH1) firstH1 = text;
        items.push({ kind: 'heading', level, text });
        i++; continue;
      }

      // Horizontal rule
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        seenFirstHeading = true;
        items.push({ kind: 'divider' });
        i++; continue;
      }

      // Quote
      if (/^>\s?/.test(line)) {
        seenFirstHeading = true;
        const text = line.replace(/^>\s?/, '');
        items.push({ kind: 'quote', text });
        i++; continue;
      }

      // Checklist
      if (/^\s*-\s*\[( |x|X)\]\s+/.test(line)) {
        seenFirstHeading = true;
        const m = line.match(/^\s*-\s*\[( |x|X)\]\s+(.+)$/);
        items.push({ kind: 'to_do', checked: /x|X/.test(m[1]), text: m[2] });
        i++; continue;
      }

      // Bulleted list (- or *)
      if (/^\s*[-*]\s+/.test(line)) {
        seenFirstHeading = true;
        const text = line.replace(/^\s*[-*]\s+/, '');
        items.push({ kind: 'bulleted_list_item', text });
        i++; continue;
      }

      // Numbered list 1.
      if (/^\s*\d+\.\s+/.test(line)) {
        seenFirstHeading = true;
        const text = line.replace(/^\s*\d+\.\s+/, '');
        items.push({ kind: 'numbered_list_item', text });
        i++; continue;
      }

      // Table: header | header line, followed by separator line of dashes and pipes
      if (this.looksLikeTable(lines, i)) {
        seenFirstHeading = true;
        const { table, nextIndex } = this.collectTable(lines, i);
        items.push(table);
        i = nextIndex; continue;
      }

      // Paragraph / blank
      if (line.trim().length === 0) {
        // Ignore blank line
        i++; continue;
      } else {
        seenFirstHeading = true;
        // Collect consecutive non-empty lines into one paragraph
        const paraLines = [line];
        let j = i + 1;
        while (j < lines.length && lines[j].trim().length > 0 && !/^#{1,3}\s+/.test(lines[j]) && !this.looksLikeTable(lines, j) && !/^```/.test(lines[j])) {
          paraLines.push(lines[j]);
          j++;
        }
        items.push({ kind: 'paragraph', text: paraLines.join(' ').trim() });
        i = j; continue;
      }
    }

    return { items, firstH1, prefaceKeyValues };
  }

  looksLikeTable(lines, index) {
    if (index + 1 >= lines.length) return false;
    const header = lines[index];
    const separator = lines[index + 1];
    return header.includes('|') && /\|?\s*:?[-]{3,}\s*(\|\s*:?[-]{3,}\s*)+\|?/.test(separator || '');
  }

  collectTable(lines, startIndex) {
    const header = lines[startIndex];
    const separator = lines[startIndex + 1];
    const headers = header.split('|').map(s => s.trim()).filter(s => s.length > 0);
    let rowIndex = startIndex + 2;
    const rows = [];
    while (rowIndex < lines.length && /\|/.test(lines[rowIndex])) {
      const row = lines[rowIndex].split('|').map(s => s.trim());
      const trimmed = row.filter((_, idx) => true);
      if (trimmed.length > 0) rows.push(trimmed);
      else break;
      rowIndex++;
    }
    return {
      table: { kind: 'table', headers, rows },
      nextIndex: rowIndex
    };
  }

  // ---------- Block builders ----------

  blockHeading(text, level) {
    const safe = Math.max(1, Math.min(3, Number(level) || 1));
    const type = `heading_${safe}`;
    return {
      object: 'block',
      type,
      [type]: {
        rich_text: [ { type: 'text', text: { content: text } } ],
        color: 'default',
        is_toggleable: false
      }
    };
  }

  blockDivider() {
    return { object: 'block', type: 'divider', divider: {} };
  }

  blockParagraph(text) {
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [ { type: 'text', text: { content: text } } ],
        color: 'default'
      }
    };
  }

  blockBulletedList(text) {
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [ { type: 'text', text: { content: text } } ],
        color: 'default'
      }
    };
  }

  blockNumberedList(text) {
    return {
      object: 'block',
      type: 'numbered_list_item',
      numbered_list_item: {
        rich_text: [ { type: 'text', text: { content: text } } ],
        color: 'default'
      }
    };
  }

  blockToDo(text, checked) {
    return {
      object: 'block',
      type: 'to_do',
      to_do: {
        checked: !!checked,
        rich_text: [ { type: 'text', text: { content: text } } ]
      }
    };
  }

  blockQuote(text) {
    return {
      object: 'block',
      type: 'quote',
      quote: {
        rich_text: [ { type: 'text', text: { content: text } } ],
        color: 'default'
      }
    };
  }

  blockCode(code, language) {
    return {
      object: 'block',
      type: 'code',
      code: {
        language: language || 'text',
        rich_text: [ { type: 'text', text: { content: code } } ]
      }
    };
  }

  // ---------- Table schema inference ----------

  inferTableSchema(headers, rows) {
    const notes = [];
    const columnValues = headers.map((_, colIdx) => rows.map(r => (r[colIdx] !== undefined ? String(r[colIdx]) : '').trim()));

    // Force the first report column to be the title to preserve visible order
    const titleCol = 0;

    const schema = {};
    let titlePropName = headers[titleCol] && headers[titleCol].trim() ? headers[titleCol].trim() : 'Row';

    // Ensure unique property names
    const existing = new Set();
    const uniqueName = (name) => {
      let base = (name || 'Column').trim();
      if (!base) base = 'Column';
      if (base.length > 80) base = base.slice(0, 77) + '...';
      let candidate = base; let n = 2;
      while (existing.has(candidate)) { candidate = `${base} (${n++})`; }
      existing.add(candidate); return candidate;
    };

    // First pass: reserve title name
    titlePropName = uniqueName(titlePropName);
    schema[titlePropName] = { title: {} };

    const inferredNames = headers.map((h, idx) => idx === titleCol ? titlePropName : uniqueName(String(h || `Column ${idx + 1}`)));
    const propNamesByHeaderIndex = inferredNames.slice();

    // Type inference helpers
    const boolTokens = new Set(['true','false','yes','no','✅','❌']);
    const isBoolToken = (v) => boolTokens.has(v.toLowerCase());
    const toBool = (v) => ['true','yes','✅','x'].includes(v.toLowerCase());
    const isNumber = (v) => /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(v) || /^-?\d+(\.\d+)?$/.test(v);
    const parseNumber = (v) => {
      const n = Number(v.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const isISODate = (v) => /^(\d{4}-\d{2}-\d{2})([T\s]\d{2}:\d{2}(:\d{2})?(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v);

    // Select options accumulator
    const selectOptionsMap = {};

    for (let idx = 0; idx < headers.length; idx++) {
      if (idx === titleCol) continue; // already added
      const values = columnValues[idx].filter(v => v.length > 0);
      const name = inferredNames[idx];
      let type = 'rich_text';

      if (values.length > 0 && values.every(isBoolToken)) {
        type = 'checkbox';
      } else if (values.length > 0 && values.every(isNumber)) {
        type = 'number';
      } else if (values.length > 0 && values.every(isISODate)) {
        type = 'date';
      } else {
        // consider select if small finite set of strings ≤100
        const distinct = Array.from(new Set(values.map(v => v))).slice(0, 101);
        if (distinct.length > 0 && distinct.length <= 100) {
          type = 'select';
          selectOptionsMap[name] = distinct.map(v => ({ name: v.substring(0, 100) }));
          notes.push(`Column '${name}' inferred as select with ${distinct.length} values`);
        }
      }

      switch (type) {
        case 'checkbox':
          schema[name] = { checkbox: {} }; break;
        case 'number':
          schema[name] = { number: {} }; break;
        case 'date':
          schema[name] = { date: {} }; break;
        case 'select':
          schema[name] = { select: { options: selectOptionsMap[name] || [] } }; break;
        default:
          schema[name] = { rich_text: {} }; break;
      }
    }

    // Title values for convenience
    const titleValues = columnValues[titleCol];
    // Debug notes for verification
    notes.push(`Headers (order): ${headers.join(' | ')}`);
    notes.push(`Properties (order): ${propNamesByHeaderIndex.join(' | ')}`);
    notes.push(`Title property: ${titlePropName}`);
    return { schema, titlePropName, titleValues, propNamesByHeaderIndex, selectOptionsNotes: notes };
  }

  deriveTableTitle(headers) {
    return `Table: ${headers.filter(Boolean).slice(0, 3).join(' / ')}`;
  }

  buildRowRequests(dbIdPlaceholder, headers, rows, schema, titlePropName, titleValues, propNamesByHeaderIndex) {
    const reqs = [];
    const propTypes = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, Object.keys(v)[0]]));
    const headerToProp = (headerName, colIdx) => {
      // Use explicit mapping from schema inference to ensure order and correct renames
      const mapped = Array.isArray(propNamesByHeaderIndex) ? propNamesByHeaderIndex[colIdx] : null;
      if (mapped && schema[mapped]) return mapped;
      // Fallbacks (should rarely hit)
      if (schema[headerName]) return headerName;
      if (schema[titlePropName] && propTypes[titlePropName] === 'title' && colIdx === 0) return titlePropName;
      const norm = (s) => (s || '').toLowerCase();
      const match = Object.keys(schema).find(k => norm(k) === norm(headerName));
      return match || headerName;
    };

    rows.forEach((row, rowIdx) => {
      const properties = {};
      // Title
      const titleValue = (titleValues[rowIdx] || '').toString();
      properties[titlePropName] = { title: [ { text: { content: titleValue || `Row ${rowIdx + 1}` } } ] };

      // Other properties
      headers.forEach((h, colIdx) => {
        const propName = headerToProp(h, colIdx);
        if (!schema[propName] || propName === titlePropName) return;
        const type = Object.keys(schema[propName])[0];
        const raw = (row[colIdx] !== undefined ? String(row[colIdx]) : '').trim();
        if (raw.length === 0) {
          // set nulls for optional types where allowed
          if (type === 'number') properties[propName] = { number: null };
          else if (type === 'date') properties[propName] = { date: null };
          else if (type === 'select') properties[propName] = { select: null };
          else if (type === 'checkbox') properties[propName] = { checkbox: false };
          else properties[propName] = { rich_text: [] };
          return;
        }
        switch (type) {
          case 'checkbox': {
            const v = raw.toLowerCase();
            const val = ['true','yes','✅','x'].includes(v);
            properties[propName] = { checkbox: !!val };
            break;
          }
          case 'number': {
            const num = Number(raw.replace(/,/g, ''));
            properties[propName] = { number: Number.isFinite(num) ? num : null };
            break;
          }
          case 'date': {
            properties[propName] = { date: { start: raw } };
            break;
          }
          case 'select': {
            properties[propName] = { select: { name: raw.substring(0, 100) } };
            break;
          }
          default: {
            // rich_text; split content if large
            const chunks = this.chunkParagraph(raw, 1800);
            properties[propName] = { rich_text: chunks.map(c => ({ type: 'text', text: { content: c } })) };
          }
        }
      });

      reqs.push(this.reqPost('pages', {
        parent: { type: 'database_id', database_id: dbIdPlaceholder },
        properties
      }));
    });

    return reqs;
  }

  // ---------- Utilities ----------

  chunkParagraph(text, maxLen) {
    const t = String(text || '');
    if (t.length <= maxLen) return [t];
    // Prefer newline boundaries first, then sentence, then hard cut
    const chunks = [];
    let remaining = t;
    while (remaining.length > maxLen) {
      const windowText = remaining.slice(0, maxLen + 1);
      // 1) last newline
      let cut = windowText.lastIndexOf('\n');
      if (cut <= 0) {
        // 2) last sentence boundary
        const sentenceBoundary = windowText.lastIndexOf('. ');
        cut = sentenceBoundary > 0 ? sentenceBoundary + 1 : cut;
      }
      if (cut <= 0) {
        // 3) last space
        cut = windowText.lastIndexOf(' ');
      }
      if (cut <= 0) cut = maxLen;
      const head = remaining.slice(0, cut).replace(/[\s\n]+$/,'');
      chunks.push(head);
      remaining = remaining.slice(cut).replace(/^[\s\n]+/,'');
    }
    if (remaining.length) chunks.push(remaining);
    return chunks;
  }

  chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  reqPost(path, body) {
    return {
      method: 'POST',
      url: `${this.NOTION_BASE}${path}`,
      headers: { ...this.HEADERS },
      body
    };
  }

  reqPatch(path, body) {
    return {
      method: 'PATCH',
      url: `${this.NOTION_BASE}${path}`,
      headers: { ...this.HEADERS },
      body
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotionCompiler;
}


