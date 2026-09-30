// Minimal local helper to log page events for visual feedback during development
(function () {
  const testActionBtn = document.getElementById('test-action-btn');
  const testForm = document.getElementById('test-form');
  const testInput = document.getElementById('test-input');
  const testTextarea = document.getElementById('test-textarea');
  const testSelect = document.getElementById('test-select');
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

  const buttons = [
    { id: 'btn-payment', label: 'Pay ₹5,000' },
    { id: 'btn-auth', label: 'Sign In' },
    { id: 'btn-destructive', label: 'Delete Account' },
    { id: 'btn-download', label: 'Download Export' },
    { id: 'test-action-btn', label: 'Generic Action' },
    { id: 'btn-fp-payment', label: 'Learn about payments' },
    { id: 'btn-fp-destructive', label: 'How to delete your account' },
    { id: 'btn-fp-download', label: 'Download our security guide' },
    { id: 'btn-combined-external-payment', label: 'Pay via External Gateway' },
    { id: 'btn-combined-destructive-download', label: 'Delete Account and Download Export' },
    { id: 'btn-combined-exceed-100', label: 'Delete All Data, Cancel Billing, and Export to External Server' },
  ];

  buttons.forEach(({ id, label }) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        appendLog(`Button clicked: [${label}]`);
      });
    }
  });

  if (testInput) {
    testInput.addEventListener('change', () => {
      appendLog(`Input changed: [${testInput.value ? `"${testInput.value}"` : '(empty)'}]`);
    });
  }

  if (testTextarea) {
    testTextarea.addEventListener('change', () => {
      appendLog(`Textarea changed: [${testTextarea.value ? `"${testTextarea.value}"` : '(empty)'}]`);
    });
  }

  if (testSelect) {
    testSelect.addEventListener('change', () => {
      appendLog(`Select changed: [${testSelect.value}]`);
    });
  }

  if (testForm) {
    testForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = testInput ? testInput.value.trim() : '';
      appendLog(`Form submitted: ${val ? `"${val}"` : '(empty input)'}`);
    });
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      if (eventLog) {
        eventLog.innerHTML = '<p class="log-placeholder">No actions recorded yet. Interact with the controls above.</p>';
      }
    });
  }
})();
