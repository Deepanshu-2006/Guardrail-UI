// Minimal local helper to log page events for visual feedback during development
(function () {
  const testActionBtn = document.getElementById('test-action-btn');
  const testForm = document.getElementById('test-form');
  const testInput = document.getElementById('test-input');
  const eventLog = document.getElementById('event-log');
  const clearLogBtn = document.getElementById('clear-log-btn');

  function appendLog(message) {
    if (!eventLog) return;

    // Remove placeholder if present
    const placeholder = eventLog.querySelector('.log-placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${escapeHtml(message)}`;

    eventLog.appendChild(entry);
    eventLog.scrollTop = eventLog.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (testActionBtn) {
    testActionBtn.addEventListener('click', () => {
      appendLog('Button clicked: [Test Action]');
    });
  }

  if (testForm) {
    testForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = testInput ? testInput.value.trim() : '';
      appendLog(`Form submitted: ${val ? `"${val}"` : '(empty input)'}`);
      if (testInput) {
        testInput.value = '';
      }
    });
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      if (eventLog) {
        eventLog.innerHTML = '<p class="log-placeholder">No actions recorded yet. Click a button or submit text above.</p>';
      }
    });
  }
})();
