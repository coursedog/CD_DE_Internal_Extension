/**
 * @typedef {Object} UploadJobMeta
 * @property {string} mainSchool
 * @property {string} baselineSchool
 * @property {string|null} notionWorkspaceId
 * @property {string|null} initiator
 */

/**
 * @typedef {Object} UploadJobSubpage
 * @property {string} key
 * @property {string} title
 * @property {string|null} id
 * @property {number} totalBatches
 * @property {number} nextBatchIndex
 * @property {('pending'|'running'|'succeeded'|'failed'|'skipped')} status
 * @property {string|null} error
 */

/**
 * @typedef {Object} UploadJobState
 * @property {string} id
 * @property {string} createdAt
 * @property {string|null} startedAt
 * @property {string} updatedAt
 * @property {('pending'|'running'|'succeeded'|'failed'|'cancelled'|'paused')} status
 * @property {UploadJobMeta} meta
 * @property {{ payloadLocation: ('session'|'local'|'idb'|null), payloadKey: (string|null) }} pointers
 * @property {{ mainPageId: (string|null), mainPageUrl: (string|null), subpages: UploadJobSubpage[], totals: { totalBlocks: number, totalBatches: number, totalApiCalls: number } }} notion
 * @property {{ percent: number, currentSubpage: (string|null), currentBatch: number, lastMessage: (string|null), lastHeartbeatAt: string }} progress
 * @property {{ notionUrl: (string|null), uploadReportMeta: { filename: (string|null), size: number } }} result
 * @property {{ message: (string|null), code: (string|null), details: Object }} error
 * @property {{ resumedCount: number, lastResumeAt: (string|null) }} resume
 */


