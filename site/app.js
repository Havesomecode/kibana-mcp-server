const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
const copyResetTimers = new WeakMap();

function activateTab(targetId) {
  for (const button of tabButtons) {
    const isActive = button.dataset.tabTarget === targetId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  }

  for (const panel of tabPanels) {
    const isActive = panel.id === targetId;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const targetId = button.dataset.tabTarget;
    if (!targetId) {
      return;
    }

    activateTab(targetId);
  });
}

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const targetId = button.getAttribute("data-copy-target");
    if (!targetId) {
      return;
    }

    const target = document.getElementById(targetId);
    const text = target?.textContent?.trim();
    if (!text || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      const previous = button.textContent;
      const existingTimer = copyResetTimers.get(button);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      button.textContent = "Copied";
      button.classList.add("is-copied");
      const timerId = window.setTimeout(() => {
        button.textContent = previous;
        button.classList.remove("is-copied");
        copyResetTimers.delete(button);
      }, 1400);
      copyResetTimers.set(button, timerId);
    } catch {
      // If clipboard access fails, leave the original command visible for manual copy.
    }
  });
}
