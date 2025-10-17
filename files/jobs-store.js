// Persistent job store helpers (chrome.storage.local/session) - stub implementation

const JOBS_KEY = 'uploadJobs';

async function readJobs() {
  const data = await chrome.storage.local.get(JOBS_KEY);
  return data[JOBS_KEY] || {};
}

async function writeJobs(jobs) {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

async function upsertJob(job) {
  const jobs = await readJobs();
  jobs[job.id] = job;
  await writeJobs(jobs);
}

async function getJob(jobId) {
  const jobs = await readJobs();
  return jobs[jobId] || null;
}

async function setPayload(jobId, payloadKey, payload, location = 'session') {
  if (location === 'session') {
    await chrome.storage.session.set({ [payloadKey]: payload });
  } else {
    await chrome.storage.local.set({ [payloadKey]: payload });
  }
  const job = await getJob(jobId);
  if (job) {
    job.pointers = { payloadLocation: location, payloadKey };
    job.updatedAt = new Date().toISOString();
    await upsertJob(job);
  }
}

async function getPayload(job) {
  const { payloadLocation, payloadKey } = job.pointers || {};
  if (!payloadKey) return null;
  const store = payloadLocation === 'session' ? chrome.storage.session : chrome.storage.local;
  const data = await store.get(payloadKey);
  return data[payloadKey] || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readJobs, writeJobs, upsertJob, getJob, setPayload, getPayload };
}


