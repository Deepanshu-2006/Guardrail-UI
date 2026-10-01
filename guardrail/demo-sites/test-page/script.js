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
    { id: 'btn-auth-sso', label: 'Sign In with External SSO' },
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

  // Day 7: Sequential Pipeline Verification Test
  const seqBtn = document.getElementById('btn-test-sequence');
  if (seqBtn) {
    seqBtn.addEventListener('click', () => {
      appendLog('=== Starting Sequential Pipeline Test ===');
      appendLog('1. Triggering LOW-risk action (Generic Action -> ALLOW)...');
      const lowBtn = document.getElementById('test-action-btn');
      if (lowBtn) lowBtn.click();

      setTimeout(() => {
        appendLog('2. Triggering HIGH-risk action (Delete Account -> WARN)...');
        const highBtn = document.getElementById('btn-destructive');
        if (highBtn) highBtn.click();
      }, 500);

      setTimeout(() => {
        appendLog('3. Triggering CRITICAL-risk action (Exceed 100 -> PROTECT)...');
        const critBtn = document.getElementById('btn-combined-exceed-100');
        if (critBtn) critBtn.click();
        appendLog('=== Sequential Pipeline Test Completed ===');
      }, 1000);
    });
  }

  // Day 7: Rapid Repeated Clicks Test
  const rapidBtn = document.getElementById('btn-test-rapid-clicks');
  if (rapidBtn) {
    rapidBtn.addEventListener('click', () => {
      appendLog('Firing 5 rapid clicks on Payment button...');
      const payBtn = document.getElementById('btn-payment');
      if (payBtn) {
        for (let i = 1; i <= 5; i++) {
          setTimeout(() => {
            appendLog(`Rapid click #${i} fired`);
            payBtn.click();
          }, i * 30);
        }
      }
    });
  }

  // Day 7: Dynamically Created Button Test
  const spawnBtn = document.getElementById('btn-test-spawn-dynamic');
  const dynContainer = document.getElementById('dynamic-button-container');
  if (spawnBtn && dynContainer) {
    let spawnCount = 0;
    spawnBtn.addEventListener('click', () => {
      spawnCount++;
      const dynId = `btn-dynamic-spawned-${spawnCount}`;
      const dyn = document.createElement('button');
      dyn.id = dynId;
      dyn.type = 'button';
      dyn.className = 'btn btn-secondary';
      dyn.style.borderColor = '#10b981';
      dyn.style.fontSize = '13px';
      dyn.textContent = `💳 Dynamic Payment Trigger #${spawnCount}`;
      dyn.addEventListener('click', () => {
        appendLog(`Dynamic Button clicked: [Dynamic Payment Trigger #${spawnCount}]`);
      });
      dynContainer.appendChild(dyn);
      appendLog(`Created dynamic button #${dynId}. Event delegation will automatically catch its click!`);
    });
  }

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
