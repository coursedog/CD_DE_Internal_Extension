// Background script for Coursedog Configuration Reporter

// Import update system modules (Manifest V3 service worker)
importScripts('update-config.js', 'update-manager.js');

// Initialize Update Manager
let updateManager = null;

// Initialize on extension startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed/updated');
  initializeUpdateManager();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] Browser startup');
  initializeUpdateManager();
});

// Initialize update manager
async function initializeUpdateManager() {
  try {
    // Load update configuration and manager
    if (typeof UpdateManager !== 'undefined') {
      updateManager = new UpdateManager();
      await updateManager.initialize();
      console.log('[Background] UpdateManager initialized');
    } else {
      console.warn('[Background] UpdateManager not available');
    }
  } catch (error) {
    console.error('[Background] Failed to initialize UpdateManager:', error);
  }
}

// Handle messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'checkForUpdates') {
    if (updateManager) {
      updateManager.checkForUpdates(message.force || false).then(sendResponse);
      return true; // Will respond asynchronously
    } else {
      sendResponse({ error: true, message: 'UpdateManager not initialized' });
    }
  }
});

chrome.action.onClicked.addListener((tab) => {
  // Open the extension in a new tab in the current window
  chrome.tabs.create({
    url: chrome.runtime.getURL('popup.html'),
    active: true
  });
});

// --- Upload Queue Management ---
let uploadQueue = {
  processing: false,
  queue: []
};

/**
 * Process the upload queue
 */
async function processUploadQueue() {
  if (uploadQueue.processing || uploadQueue.queue.length === 0) {
    return; // Already processing or queue empty
  }
  
  // Get next job from queue
  const nextJob = uploadQueue.queue.shift();
  uploadQueue.processing = true;
  
  console.log(`📤 Processing queued upload: ${nextJob.jobId}`);
  
  // Update job status to pending (ready to start)
  const data = await chrome.storage.local.get('uploadJobs');
  const jobs = data.uploadJobs || {};
  if (jobs[nextJob.jobId]) {
    jobs[nextJob.jobId].status = 'pending';
    jobs[nextJob.jobId].startedAt = new Date().toISOString();
    await chrome.storage.local.set({ uploadJobs: jobs });
  }
  
  // Update snapshot status
  const snapshotData = await chrome.storage.local.get('notionSnapshots');
  const snapshots = snapshotData.notionSnapshots || {};
  if (snapshots[nextJob.jobId]) {
    snapshots[nextJob.jobId].status = 'pending';
    await chrome.storage.local.set({ notionSnapshots: snapshots });
  }
  
  // Start the upload
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'offscreenRunJob', jobId: nextJob.jobId });
}

// --- Offscreen lifecycle & messaging stubs ---

async function ensureOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) return;
  }
  if (chrome.offscreen && chrome.offscreen.createDocument) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Long-running Notion upload with Blob usage and DOM context'
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  (async () => {
    switch (msg.type) {
      case 'startNotionUpload': {
        // Initialize and persist job state
        try {
          const now = new Date().toISOString();
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          
          // ✅ Check if there's already a job running/pending
          const hasRunningJob = Object.values(jobs).some(j => 
            j && (j.status === 'running' || j.status === 'pending')
          );
          
          // ✅ Set initial status based on queue state
          const initialStatus = (uploadQueue.processing || hasRunningJob) ? 'queued' : 'pending';
          
          jobs[msg.jobId] = jobs[msg.jobId] || {
            id: msg.jobId,
            createdAt: now,
            startedAt: null,
            updatedAt: now,
            status: initialStatus,
            meta: msg.meta || {},
            pointers: {
              payloadLocation: (msg.payloadRef && msg.payloadRef.location) || null,
              payloadKey: (msg.payloadRef && msg.payloadRef.key) || null,
              secretLocation: (msg.secretRef && msg.secretRef.location) || null,
              secretKey: (msg.secretRef && msg.secretRef.key) || null
            },
            notion: { mainPageId: null, mainPageUrl: null, subpages: [], totals: { totalBlocks: 0, totalBatches: 0, totalApiCalls: 0 } },
            progress: { percent: 0, currentSubpage: null, currentBatch: 0, lastMessage: null, lastHeartbeatAt: now },
            result: { notionUrl: null, uploadReportMeta: { filename: null, size: 0 } },
            error: { message: null, code: null, details: {} },
            resume: { resumedCount: 0, lastResumeAt: null }
          };
          await chrome.storage.local.set({ uploadJobs: jobs });
          
          // ✅ If there's already a job running, add to queue
          if (uploadQueue.processing || hasRunningJob) {
            uploadQueue.queue.push({
              jobId: msg.jobId,
              queuedAt: Date.now()
            });
            console.log(`📋 Job ${msg.jobId} added to queue (position ${uploadQueue.queue.length})`);
            sendResponse?.({ ok: true, jobId: msg.jobId, queued: true, queuePosition: uploadQueue.queue.length });
          } else {
            // ✅ Start immediately if no job is running
            uploadQueue.processing = true;
            await ensureOffscreenDocument();
            chrome.runtime.sendMessage({ type: 'offscreenRunJob', jobId: msg.jobId });
            sendResponse?.({ ok: true, jobId: msg.jobId, started: true });
          }
        } catch (e) {
          console.error('Error starting upload:', e);
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'cancelNotionUpload': {
        try {
          // Forward cancel to offscreen
          chrome.runtime.sendMessage({ type: 'offscreenCancelJob', jobId: msg.jobId });
          
          // Update job status to cancelled
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          if (jobs[msg.jobId]) {
            jobs[msg.jobId].status = 'cancelled';
            jobs[msg.jobId].updatedAt = new Date().toISOString();
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
          
          // Update snapshot status
          const snapshotData = await chrome.storage.local.get('notionSnapshots');
          const snapshots = snapshotData.notionSnapshots || {};
          if (snapshots[msg.jobId]) {
            snapshots[msg.jobId].status = 'cancelled';
            await chrome.storage.local.set({ notionSnapshots: snapshots });
          }
          
          console.log(`🛑 Job ${msg.jobId} cancelled`);
          sendResponse?.({ ok: true });
        } catch (e) {
          console.error('Cancel job error:', e);
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'removeFromQueue': {
        try {
          // Remove from queue
          const queueIndex = uploadQueue.queue.findIndex(job => job.jobId === msg.jobId);
          if (queueIndex !== -1) {
            uploadQueue.queue.splice(queueIndex, 1);
            console.log(`📋 Job ${msg.jobId} removed from queue`);
          }
          
          // Update job status
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          if (jobs[msg.jobId]) {
            jobs[msg.jobId].status = 'cancelled';
            jobs[msg.jobId].updatedAt = new Date().toISOString();
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
          
          // Update snapshot status
          const snapshotData = await chrome.storage.local.get('notionSnapshots');
          const snapshots = snapshotData.notionSnapshots || {};
          if (snapshots[msg.jobId]) {
            snapshots[msg.jobId].status = 'cancelled';
            await chrome.storage.local.set({ notionSnapshots: snapshots });
          }
          
          // Clean up snapshot data for cancelled job
          if (snapshots[msg.jobId]) {
            try {
              const snapshot = snapshots[msg.jobId];
              if (snapshot.payloadKey) {
                await chrome.storage.local.remove(snapshot.payloadKey);
              }
              if (snapshot.secretKey) {
                await chrome.storage.local.remove(snapshot.secretKey);
              }
              delete snapshots[msg.jobId];
              await chrome.storage.local.set({ notionSnapshots: snapshots });
              console.log(`🧹 Cleaned up snapshot data for cancelled job: ${msg.jobId}`);
            } catch (cleanupError) {
              console.warn('Failed to cleanup snapshot data:', cleanupError);
            }
          }
          
          sendResponse?.({ ok: true });
        } catch (e) {
          console.error('Remove from queue error:', e);
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'offscreenCancelJob': {
        // Some callers send this directly; forward to offscreen and respond immediately
        try { await ensureOffscreenDocument(); } catch (_) {}
        try { chrome.runtime.sendMessage({ type: 'offscreenCancelJob', jobId: msg.jobId }); } catch (_) {}
        sendResponse?.({ ok: true, forwarded: true });
        break;
      }
      case 'getUploadJob':
      case 'listUploadJobs': {
        const data = await chrome.storage.local.get('uploadJobs');
        const jobsMap = data.uploadJobs || {};
        if (msg.type === 'getUploadJob') {
          if (msg.jobId === '__latest__') {
            const jobs = Object.values(jobsMap);
            const latest = jobs.sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))[0] || null;
            sendResponse?.({ ok: true, job: latest });
          } else {
            sendResponse?.({ ok: true, job: jobsMap[msg.jobId] || null });
          }
        } else {
          sendResponse?.({ ok: true, jobs: Object.values(jobsMap) });
        }
        break;
      }
      case 'jobProgress': {
        try {
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          const job = jobs[msg.jobId];
          if (job) {
            job.status = 'running';
            job.updatedAt = new Date().toISOString();
            if (typeof msg.percent === 'number') job.progress.percent = Math.max(job.progress.percent || 0, msg.percent);
            if (msg.message) job.progress.lastMessage = msg.message;
            
            // ✅ Store enhanced progress data
            if (msg.currentOperation) job.progress.currentOperation = msg.currentOperation;
            if (typeof msg.filesProcessed === 'number') job.progress.filesProcessed = msg.filesProcessed;
            if (typeof msg.totalFiles === 'number') job.progress.totalFiles = msg.totalFiles;
            if (typeof msg.estimatedTimeRemaining === 'number') job.progress.estimatedTimeRemaining = msg.estimatedTimeRemaining;
            if (msg.startedAt) job.progress.startedAt = msg.startedAt;
            
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
        } catch (_) {}
        // Forward enhanced progress updates to any open UI
        try { 
          chrome.runtime.sendMessage({ 
            type: 'jobProgress', 
            jobId: msg.jobId, 
            percent: msg.percent, 
            message: msg.message,
            currentOperation: msg.currentOperation,
            filesProcessed: msg.filesProcessed,
            totalFiles: msg.totalFiles,
            estimatedTimeRemaining: msg.estimatedTimeRemaining
          }); 
        } catch (_) {}
        sendResponse?.({ ok: true });
        break;
      }
      case 'jobHeartbeat': {
        try {
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          const job = jobs[msg.jobId];
          if (job) {
            job.status = job.status || 'running';
            job.progress.lastHeartbeatAt = new Date().toISOString();
            job.updatedAt = job.progress.lastHeartbeatAt;
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
        } catch (_) {}
        sendResponse?.({ ok: true });
        break;
      }
      case 'jobCompleted': {
        try {
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          const job = jobs[msg.jobId];
          if (job) {
            job.status = 'succeeded';
            job.updatedAt = new Date().toISOString();
            job.result = { notionUrl: msg.notionUrl || null, uploadReportMeta: msg.uploadReportMeta || { filename: null, size: 0 } };
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
          
          // ✅ Update snapshot status to succeeded
          const snapshotData = await chrome.storage.local.get('notionSnapshots');
          const snapshots = snapshotData.notionSnapshots || {};
          if (snapshots[msg.jobId]) {
            snapshots[msg.jobId].status = 'succeeded';
            await chrome.storage.local.set({ notionSnapshots: snapshots });
          }
        } catch (_) {}
        
        try {
          // Use the jobId as the notification id so we can map clicks to the job
          await chrome.notifications.create(msg.jobId, {
            type: 'basic',
            iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
            title: 'Notion upload complete',
            message: 'Click to open the Notion page.'
          });
        } catch (e) {
          console.warn('Notification (success) failed:', e?.message || e);
        }
        
        // ✅ Mark processing complete and process next in queue
        uploadQueue.processing = false;
        processUploadQueue(); // Start next job if any
        
        // Notify any open UI of completion
        try { chrome.runtime.sendMessage({ type: 'jobCompleted', jobId: msg.jobId, notionUrl: msg.notionUrl || null }); } catch (_) {}
        sendResponse?.({ ok: true });
        break;
      }
      case 'jobFailed': {
        try {
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          const job = jobs[msg.jobId];
          if (job) {
            job.status = 'failed';
            job.updatedAt = new Date().toISOString();
            job.error = msg.error || { message: 'Unknown error', code: null, details: {} };
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
          
          // ✅ Update snapshot status to failed (keep payload for retry)
          const snapshotData = await chrome.storage.local.get('notionSnapshots');
          const snapshots = snapshotData.notionSnapshots || {};
          if (snapshots[msg.jobId]) {
            snapshots[msg.jobId].status = 'failed';
            await chrome.storage.local.set({ notionSnapshots: snapshots });
          }
        } catch (_) {}
        
        // Notify UI to refresh state
        try { chrome.runtime.sendMessage({ type: 'jobsUpdated' }); } catch (_) {}
        // Forward failure details as well
        try { chrome.runtime.sendMessage({ type: 'jobFailed', jobId: msg.jobId, error: msg.error || null }); } catch (_) {}
        
        try {
          await chrome.notifications.create({
            type: 'basic',
            iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
            title: 'Notion upload failed',
            message: (msg.error && msg.error.message) ? msg.error.message : 'An error occurred.'
          });
        } catch (e) {
          console.warn('Notification (failure) failed:', e?.message || e);
        }
        
        // ✅ Mark processing complete and process next in queue (even after failure)
        uploadQueue.processing = false;
        processUploadQueue(); // Start next job if any
        
        sendResponse?.({ ok: true });
        break;
      }
      case 'job:get': {
        try {
          const data = await chrome.storage.local.get('uploadJobs');
          const jobs = data.uploadJobs || {};
          const job = jobs[msg.jobId] || null;
          sendResponse?.({ ok: true, job });
        } catch (e) {
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'job:set': {
        try {
          const curr = await chrome.storage.local.get('uploadJobs');
          const jobs = curr.uploadJobs || {};
          if (msg.job && msg.job.id) {
            jobs[msg.job.id] = msg.job;
            await chrome.storage.local.set({ uploadJobs: jobs });
          }
          sendResponse?.({ ok: true });
        } catch (e) {
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'storage:get': {
        try {
          const area = msg.area === 'session' ? chrome.storage.session : chrome.storage.local;
          const res = await area.get(msg.key);
          sendResponse?.({ ok: true, value: res[msg.key] });
        } catch (e) {
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'storage:set': {
        try {
          const area = msg.area === 'session' ? chrome.storage.session : chrome.storage.local;
          const obj = {}; obj[msg.key] = msg.value;
          await area.set(obj);
          sendResponse?.({ ok: true });
        } catch (e) {
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
      case 'storage:remove': {
        try {
          const area = msg.area === 'session' ? chrome.storage.session : chrome.storage.local;
          await area.remove(msg.key);
          sendResponse?.({ ok: true });
        } catch (e) {
          sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        break;
      }
    }
  })();
  return true; // keep message channel open for async sendResponse
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name === 'upload-watchdog') {
    // Check heartbeat staleness and re-create offscreen if needed (stub)
    await ensureOffscreenDocument();
  }
});

try { chrome.alarms.create('upload-watchdog', { periodInMinutes: 1 }); } catch (_) {}

// Open Notion page when the completion notification is clicked
try {
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    try {
      const data = await chrome.storage.local.get('uploadJobs');
      const jobs = data.uploadJobs || {};
      const job = jobs[notificationId];
      const url = job && job.result && job.result.notionUrl ? job.result.notionUrl : null;
      if (url) {
        try { await chrome.tabs.create({ url }); } catch (_) {}
      }
    } catch (_) {}
  });
} catch (_) {}