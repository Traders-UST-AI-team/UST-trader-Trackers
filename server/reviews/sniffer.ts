import type { SnifferDetectionResult } from '../../shared/review-types.ts';

/**
 * Detects the most probable delimiter (, ; or \t) in a CSV/TSV text.
 */
export function detectDelimiter(text: string): string {
  const sampleLines = text.split(/\r?\n/).slice(0, 5).filter((l) => l.trim().length > 0);
  if (sampleLines.length === 0) return ',';

  let commaCount = 0;
  let semiCount = 0;
  let tabCount = 0;

  for (const line of sampleLines) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (c === ',') commaCount++;
        else if (c === ';') semiCount++;
        else if (c === '\t') tabCount++;
      }
    }
  }

  if (tabCount > commaCount && tabCount > semiCount) return '\t';
  if (semiCount > commaCount && semiCount > tabCount) return ';';
  return ',';
}

/**
 * Robust RFC 4180 compliant CSV/TSV parser that handles:
 * - Automatic delimiter detection (comma, semicolon, tab)
 * - Quotes enclosing fields
 * - Commas, semicolons, and newlines inside quotes
 * - Escaped double quotes ("")
 * - Windows CRLF and Unix LF
 * - UTF-8 BOM
 */
export function parseCsv(
  text: string,
  explicitDelimiter?: string
): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) return { headers: [], rows: [] };

  const delimiter = explicitDelimiter || detectDelimiter(clean);

  const parsedMatrix: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        parsedMatrix.push(currentRow);
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        parsedMatrix.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // Push final field/row if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    parsedMatrix.push(currentRow);
  }

  if (parsedMatrix.length === 0) return { headers: [], rows: [] };

  const headers = parsedMatrix[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < parsedMatrix.length; r++) {
    const rowData = parsedMatrix[r];
    // skip completely blank lines
    if (rowData.length === 1 && !rowData[0]) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const headerKey = headers[c] || `col_${c}`;
      obj[headerKey] = rowData[c] ?? '';
    }
    rows.push(obj);
  }

  return { headers, rows };
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

/**
 * Parses Amazon, Best Buy, and scraper date strings to 'YYYY-MM-DD'.
 * Handles:
 * - "Reviewed in the United States on September 22, 2024" -> "2024-09-22"
 * - "Reviewed in the United Kingdom on 15 March 2023" -> "2023-03-15"
 * - "Reviewed in Germany on 22. September 2024" -> "2024-09-22"
 * - "2024-09-22", "2024/09/22"
 * - "25/08/2024" (DD/MM/YYYY) -> "2024-08-25"
 * - "09/22/2024" (MM/DD/YYYY) -> "2024-09-22"
 * - "22.09.2024" (DD.MM.YYYY) -> "2024-09-22"
 * - "22-Sep-2024" -> "2024-09-22"
 */
export function parseReviewDate(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;

  // Extract date part if preceded by "on" (e.g. "Reviewed in the US on September 22, 2024")
  const onMatch = s.match(/(?:on|\bon:?|am)\s+([A-Za-z0-9,.\s/-]+)$/i);
  const target = onMatch ? onMatch[1].trim() : s;

  // 1. Check ISO format YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = target.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2. Check "DD Month YYYY" or "DD. Month YYYY" (UK / European style)
  const dmyTextMatch = target.match(/\b(\d{1,2})\.?(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/i);
  if (dmyTextMatch) {
    const mName = dmyTextMatch[2].toLowerCase();
    const m = MONTH_MAP[mName];
    if (m) {
      const d = parseInt(dmyTextMatch[1], 10);
      const y = dmyTextMatch[3];
      if (d >= 1 && d <= 31) {
        return `${y}-${m}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // 3. Check "Month DD, YYYY" or "Month DD YYYY" (US style)
  const mdyTextMatch = target.match(/\b([A-Za-z]+)\s+(\d{1,2})\.?(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (mdyTextMatch) {
    const mName = mdyTextMatch[1].toLowerCase();
    const m = MONTH_MAP[mName];
    if (m) {
      const d = parseInt(mdyTextMatch[2], 10);
      const y = mdyTextMatch[3];
      if (d >= 1 && d <= 31) {
        return `${y}-${m}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // 4. Check "DD-Mon-YYYY" (e.g. 22-Sep-2024)
  const dMonYMatch = target.match(/\b(\d{1,2})-([A-Za-z]{3,})-(\d{4})\b/i);
  if (dMonYMatch) {
    const m = MONTH_MAP[dMonYMatch[2].toLowerCase()];
    if (m) {
      const d = parseInt(dMonYMatch[1], 10);
      const y = dMonYMatch[3];
      if (d >= 1 && d <= 31) {
        return `${y}-${m}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // 5. Check dot format DD.MM.YYYY
  const dotMatch = target.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (dotMatch) {
    const d = parseInt(dotMatch[1], 10);
    const m = parseInt(dotMatch[2], 10);
    const y = dotMatch[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 6. Check slash or hyphen: MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = target.match(/\b(\d{1,2})[/](\d{1,2})[/](\d{4})\b/);
  if (slashMatch) {
    const n1 = parseInt(slashMatch[1], 10);
    const n2 = parseInt(slashMatch[2], 10);
    const y = slashMatch[3];

    // If first number > 12, it must be DD/MM/YYYY
    if (n1 > 12 && n2 <= 12) {
      return `${y}-${String(n2).padStart(2, '0')}-${String(n1).padStart(2, '0')}`;
    }
    // If second number > 12, it must be MM/DD/YYYY
    if (n2 > 12 && n1 <= 12) {
      return `${y}-${String(n1).padStart(2, '0')}-${String(n2).padStart(2, '0')}`;
    }
    // Default US assumption: MM/DD/YYYY
    if (n1 >= 1 && n1 <= 12 && n2 >= 1 && n2 <= 31) {
      return `${y}-${String(n1).padStart(2, '0')}-${String(n2).padStart(2, '0')}`;
    }
  }

  // 7. Native Date fallback
  const timestamp = Date.parse(target);
  if (!Number.isNaN(timestamp)) {
    const d = new Date(timestamp);
    const y = d.getUTCFullYear();
    if (y >= 2000 && y <= 2100) {
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }

  return null;
}

/**
 * Extracts star rating as a number between 1.0 and 5.0.
 * Handles:
 * - "5.0 out of 5 stars", "4 out of 5" -> 5.0, 4.0
 * - "4.5 / 5.0", "4/5" -> 4.5, 4.0
 * - "a-star-5", "a-star-4-5" -> 5.0, 4.5
 * - "5,0", "4,5" (comma decimal) -> 5.0, 4.5
 * - "10/10" -> 5.0, "8/10" -> 4.0
 * - "5 stars", "Rating: 4.5" -> 5.0, 4.5
 */
export function parseStarRating(ratingStr: string): number | null {
  if (!ratingStr || typeof ratingStr !== 'string') return null;
  const s = ratingStr.trim().replace(',', '.');
  if (!s || /^-\d/.test(s)) return null;

  // Check "a-star-X" (Amazon CSS class scraper artifact)
  const aStarMatch = s.match(/a-star-(\d(?:-\d)?)/i);
  if (aStarMatch) {
    const num = parseFloat(aStarMatch[1].replace('-', '.'));
    return !Number.isNaN(num) && num >= 1 && num <= 5 ? num : null;
  }

  // Check 10-point scale: "X/10" or "X out of 10"
  const tenMatch = s.match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*10(?:\.0)?/i);
  if (tenMatch) {
    const num = parseFloat(tenMatch[1]);
    if (!Number.isNaN(num) && num >= 0 && num <= 10) {
      const scaled = Math.round((num / 2) * 10) / 10;
      return Math.max(1, Math.min(5, scaled));
    }
  }

  // Check "X.X out of 5[.0]" or "X/5[.0]"
  const outOfMatch = s.match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*5(?:\.0)?/i);
  if (outOfMatch) {
    const num = parseFloat(outOfMatch[1]);
    return !Number.isNaN(num) && num >= 1 && num <= 5 ? num : null;
  }

  // Check standalone number between 1.0 and 5.0
  const numMatch = s.match(/^([1-5](?:\.\d+)?)$/);
  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    return !Number.isNaN(num) && num >= 1 && num <= 5 ? num : null;
  }

  // Check number at start or with prefix (e.g. "Rating: 4.5", "5 stars", "4.5 star rating")
  const starMatch = s.match(/(?:rating:?\s*)?([1-5](?:\.\d+)?)\s*(?:stars?|★)?/i);
  if (starMatch) {
    const num = parseFloat(starMatch[1]);
    return !Number.isNaN(num) && num >= 1 && num <= 5 ? num : null;
  }

  return null;
}

/**
 * Universal Column Sniffer:
 * Automatically matches varying column naming schemes from Chrome extensions
 * (Instant Data Scraper, Amazon Reviews Exporter, Webscraper.io, etc.)
 * with high precision to avoid false matches.
 */
export function sniffAndParseReviews(csvText: string): SnifferDetectionResult {
  const { headers, rows } = parseCsv(csvText);

  if (headers.length === 0 || rows.length === 0) {
    return {
      totalRows: 0,
      detectedColumns: {
        bodyCol: null,
        dateCol: null,
        ratingCol: null,
        titleCol: null,
        authorCol: null,
        verifiedCol: null,
      },
      confidence: 0,
      sampleRows: [],
      parsedReviews: [],
    };
  }

  const cleanHeader = (h: string) => h.toLowerCase().replace(/[\s\-_]/g, '');

  const normHeaders = headers.map((h) => ({
    original: h,
    norm: cleanHeader(h),
  }));

  // Targeted keyword matchers
  const dateKeywords = [
    'reviewdate', 'date', 'reviewtime', 'time', 'submissiontime', 'createdat',
    'timestamp', 'reviewedat', 'posteddate', 'submissiondate'
  ];
  const ratingKeywords = [
    'starrating', 'rating', 'stars', 'score', 'reviewrating', 'stars_count', 'rate', 'star'
  ];
  const titleKeywords = [
    'reviewtitle', 'title', 'headline', 'subject', 'summary', 'header'
  ];
  const authorKeywords = [
    'author', 'reviewer', 'user', 'username', 'profilename', 'customername', 'authorname', 'reviewername'
  ];
  const verifiedKeywords = [
    'verifiedpurchase', 'verified', 'isverified', 'verifiedbuyer'
  ];
  const bodyKeywords = [
    'reviewtext', 'reviewbody', 'body', 'content', 'text', 'comment', 'comments',
    'croriginalreviewcontent', 'feedback', 'description', 'fulltext'
  ];

  function findExactOrPrefix(keywords: string[]): string | null {
    for (const kw of keywords) {
      const match = normHeaders.find((h) => h.norm === kw);
      if (match) return match.original;
    }
    for (const kw of keywords) {
      const match = normHeaders.find((h) => h.norm.includes(kw));
      if (match) return match.original;
    }
    return null;
  }

  // Find non-body columns first so they are not misattributed to body
  const dateCol = findExactOrPrefix(dateKeywords);
  const ratingCol = findExactOrPrefix(ratingKeywords);
  const titleCol = findExactOrPrefix(titleKeywords);
  const authorCol = findExactOrPrefix(authorKeywords);
  const verifiedCol = findExactOrPrefix(verifiedKeywords);

  // For body, exclude already identified non-body columns
  let bodyCol: string | null = null;
  for (const kw of bodyKeywords) {
    const match = normHeaders.find(
      (h) => (h.norm === kw || h.norm.includes(kw)) &&
             h.original !== authorCol &&
             h.original !== titleCol &&
             h.original !== dateCol &&
             h.original !== ratingCol &&
             h.original !== verifiedCol
    );
    if (match) {
      bodyCol = match.original;
      break;
    }
  }

  // Fallback heuristic: If bodyCol wasn't found by keyword, check average length of row fields
  if (!bodyCol) {
    let maxAvgLen = 0;
    let bestCol: string | null = null;
    for (const h of headers) {
      if (h === dateCol || h === ratingCol || h === authorCol || h === titleCol || h === verifiedCol) continue;
      const totalLen = rows.reduce((sum, r) => sum + (r[h]?.length ?? 0), 0);
      const avgLen = totalLen / rows.length;
      if (avgLen > maxAvgLen && avgLen > 20) {
        maxAvgLen = avgLen;
        bestCol = h;
      }
    }
    if (bestCol) bodyCol = bestCol;
  }

  // Fallback heuristic for dateCol: check values for date patterns
  let resolvedDateCol = dateCol;
  if (!resolvedDateCol) {
    for (const h of headers) {
      if (h === bodyCol || h === ratingCol || h === authorCol) continue;
      const sampleHits = rows.slice(0, 10).filter((r) => parseReviewDate(r[h] ?? '') !== null).length;
      if (sampleHits >= 3) {
        resolvedDateCol = h;
        break;
      }
    }
  }

  // Fallback heuristic for ratingCol: check values for ratings 1-5
  let resolvedRatingCol = ratingCol;
  if (!resolvedRatingCol) {
    for (const h of headers) {
      if (h === bodyCol || h === resolvedDateCol || h === authorCol) continue;
      const sampleHits = rows.slice(0, 10).filter((r) => parseStarRating(r[h] ?? '') !== null).length;
      if (sampleHits >= 3) {
        resolvedRatingCol = h;
        break;
      }
    }
  }

  let confidence = 0;
  if (bodyCol) confidence += 0.45;
  if (resolvedDateCol) confidence += 0.25;
  if (resolvedRatingCol) confidence += 0.2;
  if (titleCol || authorCol) confidence += 0.1;

  const parsedReviews: SnifferDetectionResult['parsedReviews'] = [];

  for (const r of rows) {
    const rawBody = bodyCol ? r[bodyCol] ?? '' : '';
    if (!rawBody || rawBody.trim().length === 0) continue;

    const rawDate = resolvedDateCol ? r[resolvedDateCol] ?? '' : '';
    const parsedDate = parseReviewDate(rawDate) || new Date().toISOString().slice(0, 10);

    const rawRating = resolvedRatingCol ? r[resolvedRatingCol] ?? '' : '';
    const parsedRating = parseStarRating(rawRating);

    let parsedTitle = titleCol ? r[titleCol] ?? null : null;
    if (parsedTitle) {
      // Clean leading rating like "5.0 out of 5 stars "
      parsedTitle = parsedTitle.replace(/^[0-5](?:\.\d)?\s*out of\s*5(?:\s*stars)?\s*[-–:]?\s*/i, '').trim() || null;
    }

    const parsedAuthor = authorCol ? (r[authorCol] || null) : null;

    let verified = false;
    if (verifiedCol && r[verifiedCol]) {
      const val = r[verifiedCol].toLowerCase();
      verified = val.includes('verified') || val === 'true' || val === 'yes' || val === '1';
    } else if (rawBody.toLowerCase().includes('verified purchase')) {
      verified = true;
    }

    parsedReviews.push({
      body: rawBody.trim(),
      date: parsedDate,
      rating: parsedRating,
      title: parsedTitle,
      author: parsedAuthor,
      verified,
    });
  }

  return {
    totalRows: rows.length,
    detectedColumns: {
      bodyCol,
      dateCol: resolvedDateCol,
      ratingCol: resolvedRatingCol,
      titleCol,
      authorCol,
      verifiedCol,
    },
    confidence: Number(confidence.toFixed(2)),
    sampleRows: rows.slice(0, 5),
    parsedReviews,
  };
}
