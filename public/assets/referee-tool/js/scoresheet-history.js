import { db, ensureRefereeAuth } from './firebase.js';
import {
  doc, getDoc, getDocs, collection, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

// ── URL params ────────────────────────────────────────────────────────────────
// Usage: scoresheet-history.html?competition=go2026&team=42&teamName=Team+Homer
const p             = new URLSearchParams(window.location.search);
const competitionId = p.get('competition') || 'dev';
const teamId        = p.get('team')        || '0';
const teamName      = p.get('teamName')    || 'Unknown Team';

let runs = [];

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  await ensureRefereeAuth();

  document.getElementById('test-name').textContent = 'Score History';
  document.getElementById('team-name').textContent = teamName;

  // Back link
  const backLink = document.getElementById('back-link');
  if (backLink) backLink.href = `${window.__siteBase || ''}/dashboard?competition=${competitionId}`;

  // Load all runs for this team
  await loadRunHistory();

  document.getElementById('loading').hidden = true;
  document.getElementById('app').hidden = false;
}

async function loadRunHistory() {
  try {
    // Query all runs for this team across all slots and tests
    const runsRef = collection(db, 'competitions', competitionId, 'runs');
    const q = query(
      runsRef,
      where('teamId', '==', teamId),
      orderBy('updatedAt', 'desc')
    );
    const snapshot = await getDocs(q);
    
    runs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })).filter(r => r.status === 'submitted');  // Only show submitted runs

    renderRunHistory();
  } catch (err) {
    console.error('Error loading run history:', err);
    document.getElementById('history-list').innerHTML = `<div class="error">Failed to load history: ${err.message}</div>`;
  }
}

function renderRunHistory() {
  const container = document.getElementById('history-list');
  
  if (runs.length === 0) {
    container.innerHTML = '<div class="no-runs">No completed score sheets for this team.</div>';
    return;
  }

  // Group runs by test
  const byTest = {};
  for (const run of runs) {
    const testId = run.testId || 'unknown';
    if (!byTest[testId]) byTest[testId] = [];
    byTest[testId].push(run);
  }

  container.innerHTML = '';
  
  for (const [testId, testRuns] of Object.entries(byTest)) {
    const testSection = document.createElement('div');
    testSection.className = 'test-section';

    const testHeader = document.createElement('div');
    testHeader.className = 'test-header';
    testHeader.textContent = testRuns[0]?.testName || testId;
    testSection.appendChild(testHeader);

    // Calculate totals for this test
    const totalScore = testRuns.reduce((sum, r) => sum + (r.totalScore || 0), 0);
    const avgScore = Math.round(totalScore / testRuns.length);

    const summary = document.createElement('div');
    summary.className = 'test-summary';
    summary.innerHTML = `
      <span class="summary-item">Attempts: <strong>${testRuns.length}</strong></span>
      <span class="summary-item">Total: <strong>${totalScore} pts</strong></span>
      <span class="summary-item">Average: <strong>${avgScore} pts</strong></span>
    `;
    testSection.appendChild(summary);

    // List all runs for this test
    const runsList = document.createElement('div');
    runsList.className = 'runs-list';

    for (const run of testRuns) {
      const runEl = document.createElement('div');
      runEl.className = 'run-item';

      const time = run.submittedAt?.toDate?.() || new Date();
      const timeStr = time.toLocaleString();
      const referee = run.submittedBy || run.lastWriterEmail || 'Unknown';

      runEl.innerHTML = `
        <div class="run-header">
          <span class="run-score">${run.totalScore || 0} pts</span>
          <span class="run-ref">${referee}</span>
          <span class="run-time">${timeStr}</span>
        </div>
        <div class="run-details" hidden>
          <div class="run-slot">Slot: <strong>${run.slotId || 'Unknown'}</strong></div>
          <div class="run-notes">${run.notes ? `<strong>Notes:</strong> ${escapeHtml(run.notes)}` : '<em>No notes</em>'}</div>
          <div class="run-scores">
            <details>
              <summary>Score Breakdown</summary>
              <pre>${formatScores(run.scores)}</pre>
            </details>
          </div>
          ${run.feedEntries?.length > 0 ? `
            <div class="run-feed">
              <details>
                <summary>Activity Feed (${run.feedEntries.length} entries)</summary>
                <div class="feed-list">
                  ${run.feedEntries
                    .sort((a, b) => (b.t || 0) - (a.t || 0))
                    .map(entry => `
                      <div class="feed-entry">
                        <span class="feed-label">${escapeHtml(entry.label)}</span>
                        <span class="feed-delta ${entry.delta > 0 ? 'positive' : 'negative'}">
                          ${entry.delta > 0 ? '+' : ''}${entry.delta}
                        </span>
                        ${entry.elapsed !== null && entry.elapsed !== undefined ? `<span class="feed-time">${formatSeconds(entry.elapsed)}</span>` : ''}
                      </div>
                    `).join('')}
                </div>
              </details>
            </div>
          ` : ''}
        </div>
      `;

      // Toggle details on click
      runEl.querySelector('.run-header').addEventListener('click', () => {
        const details = runEl.querySelector('.run-details');
        details.hidden = !details.hidden;
      });

      runsList.appendChild(runEl);
    }

    testSection.appendChild(runsList);
    container.appendChild(testSection);
  }
}

function formatScores(scores) {
  if (!scores || Object.keys(scores).length === 0) return 'No scores recorded';
  return JSON.stringify(scores, null, 2);
}

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── GO ────────────────────────────────────────────────────────────────────────

init().catch(err => {
  document.getElementById('loading').textContent = `Error: ${err.message}`;
  console.error(err);
});
