(function () {
  "use strict";

  console.log(
    `[${new Date().toLocaleTimeString()}] Cursor Smart Auto-Script (v1.0) Initializing...`,
  );

  const CHECK_INTERVAL_MS = 2500; // How often to check the UI state
  const MAX_CONSECUTIVE_ACTION_ATTEMPTS = 3; // For generic continue/approve clicks if DOM doesn't change
  const POST_ACCEPT_CHANGES_DELAY_MS = 2500; // Delay after clicking "Accept [all]" before sending "proceed"
  const MAX_GENERATING_STUCK_TIME_MS = 75000; // 75s: If "Generating..." and AI output hasn't changed

  // --- CSS Selectors (CRITICAL: User MUST verify and refine these for their Cursor version) ---

  // AI's latest message text area (for reading AI state/requests)
  const AI_MESSAGE_TEXT_AREA_SELECTOR =
    "div.hide-if-empty[id^='bubble-'] > div.message-content-animated > span.anysphere-markdown-container-root";

  // "Resume the conversation" link (e.g., after 25 tool calls)
  const RESUME_CONVERSATION_LINK_SELECTOR =
    "span.markdown-link[data-link='command:composer.resumeCurrentChat']";

  // General "Continue" buttons (add others if found)
  const GENERAL_CONTINUE_BUTTON_SELECTORS = [
    RESUME_CONVERSATION_LINK_SELECTOR, // This is a form of continue
    "button[aria-label*='Continue']",
    // "button:contains('Continue')" // Be careful with generic text selectors
  ];

  // General "Approve Command" or "Run" buttons
  const APPROVE_COMMAND_BUTTON_SELECTORS = [
    "button[aria-label*='Approve']",
    "button[aria-label*='Run']",
    // "button:contains('Approve')",
    // "button:contains('Run Command')"
  ];

  // Chat input area and send button
  const CHAT_INPUT_SELECTOR =
    "div.aislash-editor-input[contenteditable='true']";
  const SEND_BUTTON_SELECTOR = // Tries to find an active send button
    "div.composer-button-area div.anysphere-icon-button:not([data-disabled='true']) span.codicon-arrow-up-two";
  const SEND_BUTTON_SELECTOR_ALT = // Parent div might be clickable
    "div.composer-button-area div.anysphere-icon-button:not([data-disabled='true'])";

  // Problematic popups (network errors, etc.)
  const PROBLEMATIC_POPUP_CONTAINER_SELECTOR =
    "div.bg-dropdown-background.border-dropdown-border";
  const PROBLEMATIC_POPUP_TEXTS = [
    "Connection failed. If the problem persists", // Partial match
    "We're having trouble connecting to the model provider", // Partial match
  ];

  // "Generating..." bar (usually near chat input)
  const GENERATING_BAR_PARENT_SELECTOR = "div.full-input-box"; // Container of chat input
  const GENERATING_TEXT_INDICATOR = "Generating...";
  // "Accept" / "Accept all" button on the "Generating..." bar (for file changes)
  const GENERATING_BAR_ACCEPT_BUTTON_SELECTOR = `${GENERATING_BAR_PARENT_SELECTOR} button:contains('Accept'), ${GENERATING_BAR_PARENT_SELECTOR} button:contains('Accept all')`;


  // Diff review bar (for "Accept" / "Accept all" file changes)
  // Context: Look for a bar with file stats like "+X -Y"
  const DIFF_REVIEW_BAR_CONTEXT_SELECTOR = "div:has(> span[class*='codicon-git-'])"; // Example, find a reliable parent of the diff stats + buttons
  const DIFF_ACCEPT_BUTTON_TEXTS = ["accept", "accept all"]; // Lowercase

  // Active terminal command UI block and its "Skip" button
  const TERMINAL_COMMAND_UI_BLOCK_SELECTOR =
    "div.bg-vscode-textSeparator-foreground"; // The dark grey block for a command
  const TERMINAL_SKIP_BUTTON_SELECTOR = `${TERMINAL_COMMAND_UI_BLOCK_SELECTOR} button:has(span.codicon-debug-step-back), ${TERMINAL_COMMAND_UI_BLOCK_SELECTOR} button:contains('Skip')`;
  const TERMINAL_MOVE_TO_BACKGROUND_BUTTON_SELECTOR = `${TERMINAL_COMMAND_UI_BLOCK_SELECTOR} button:contains('Move to background')`;

  // --- State Variables ---
  let consecutiveSameActionAttempts = 0;
  let lastDomHashForNoChangeDetection = "";
  let generatingStateStartTime = null;
  let lastAiMessageTextForGeneratingCheck = "";
  let lastActionTimestamp = 0;
  const ACTION_COOLDOWN_MS = 1500; // Min time between script actions

  // --- Helper Functions ---
  function getVisibleTextContent(element) {
    // ... (Use the recursive version from v0.8.1)
    if (!element) return ""; let text = "";
    function extractText(node) {
      if (node.nodeType === Node.TEXT_NODE) { text += node.nodeValue + " "; }
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.nodeName !== "SCRIPT" && node.nodeName !== "STYLE") {
          for (let i = 0; i < node.childNodes.length; i++) { extractText(node.childNodes[i]); }
        }
      }
    }
    extractText(element); return text.trim().replace(/\s+/g, " ");
  }

  function simpleHash(str) {
    // ... (Use the version from previous scripts)
    let hash = 0; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = (hash << 5) - hash + char; hash |= 0; } return hash;
  }

  async function typeAndSendMessage(message) {
    // ... (Use the version from v0.8 / v0.8.1, ensuring it focuses input, uses execCommand, and clicks send or simulates Enter)
    const inputField = document.querySelector(CHAT_INPUT_SELECTOR);
    if (!inputField) { console.error(`[AutoScript] Chat input field not found.`); return false; }
    inputField.focus(); document.execCommand("selectAll", false, null); document.execCommand("insertText", false, message);
    console.log(`[AutoScript] Typed "${message}" into chat input.`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sendButtonElement = document.querySelector(SEND_BUTTON_SELECTOR) || document.querySelector(SEND_BUTTON_SELECTOR_ALT);
    const clickableSendButton = sendButtonElement ? (sendButtonElement.closest("div.anysphere-icon-button") || sendButtonElement) : null;
    if (clickableSendButton && clickableSendButton.getAttribute("data-disabled") !== "true") {
      console.log(`[AutoScript] Clicking send button.`); clickableSendButton.click(); return true;
    }
    console.warn(`[AutoScript] Send button not found/disabled. Simulating Enter.`);
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true });
    inputField.dispatchEvent(event); return true;
  }

  function findAndClickElement(selectors, specificParent = null, avoidIfParentContainsProblematicText = true) {
    // ... (Use a robust version from previous scripts, ensuring visibility and enabled checks)
    // ... (It should also check `avoidIfParentContainsProblematicText` against `PROBLEMATIC_POPUP_TEXTS`)
    const searchContext = specificParent || document;
    for (const selector of selectors) {
      try {
        const elements = searchContext.querySelectorAll(selector);
        for (const element of elements) {
          const style = window.getComputedStyle(element);
          if (style.display !== "none" && style.visibility !== "hidden" && !(element.disabled || element.getAttribute('aria-disabled') === 'true') && element.offsetParent !== null) {
            if (avoidIfParentContainsProblematicText) {
              let parentProblematicPopup = element.closest(PROBLEMATIC_POPUP_CONTAINER_SELECTOR);
              if (parentProblematicPopup) {
                const popupText = parentProblematicPopup.textContent.toLowerCase();
                if (PROBLEMATIC_POPUP_TEXTS.some(txt => popupText.includes(txt.toLowerCase()))) {
                  continue; // Skip clicking buttons inside these known error popups
                }
              }
            }
            console.log(`[AutoScript] Clicking element via selector "${selector}":`, element.innerText || element.ariaLabel);
            element.click(); lastActionTimestamp = Date.now(); return true;
          }
        }
      } catch (e) { console.warn(`[AutoScript] Error with selector "${selector}":`, e); }
    }
    return false;
  }

  // --- Core Logic Functions ---
  function isHumanInputRequired(aiVisibleMessage) {
    if (!aiVisibleMessage) return false;
    const lowerResponse = aiVisibleMessage.toLowerCase();
    return (
      lowerResponse.includes("current phase: awaiting_human_input") ||
      lowerResponse.includes("awaiting human input") ||
      lowerResponse.includes("please advise") ||
      lowerResponse.includes("i am stuck") ||
      lowerResponse.includes("need your help")
    );
  }

  async function handleProblematicPopups() {
    const popupContainers = document.querySelectorAll(PROBLEMATIC_POPUP_CONTAINER_SELECTOR);
    console.log(`[AutoScript DEBUG] Found ${popupContainers.length} potential problematic popup containers using selector: "${PROBLEMATIC_POPUP_CONTAINER_SELECTOR}"`);

    for (let i = 0; i < popupContainers.length; i++) {
      const container = popupContainers[i];
      const containerText = container.textContent.toLowerCase();
      console.log(`[AutoScript DEBUG] Checking container #${i} text: "${containerText.substring(0, 150)}..."`);

      let matchedProblemText = null;
      for (const problemText of PROBLEMATIC_POPUP_TEXTS) {
        if (containerText.includes(problemText.toLowerCase())) {
          matchedProblemText = problemText;
          break;
        }
      }

      if (matchedProblemText) {
        console.log(`[AutoScript DEBUG] Matched problematic text "${matchedProblemText}" in container #${i}.`);
        const style = window.getComputedStyle(container);
        const isVisible = style.display !== "none" &&
                          style.visibility !== "hidden" &&
                          style.opacity !== "0" && // Ensure not transparent
                          container.offsetParent !== null; // Actually in layout and rendered

        if (isVisible) {
          console.log(`[AutoScript] Problematic popup DETECTED AND VISIBLE. Sending "continue". Matched text: "${matchedProblemText}". Full text snippet: "${container.textContent.substring(0,100)}"`);
          await typeAndSendMessage("continue");
          lastActionTimestamp = Date.now();
          return true; // Action taken
        } else {
          console.log(`[AutoScript DEBUG] Problematic popup text matched for container #${i}, but VISIBILITY CHECK FAILED. Display: ${style.display}, Visibility: ${style.visibility}, Opacity: ${style.opacity}, OffsetParent: ${container.offsetParent === null ? "null" : "exists"}`);
        }
      }
    }
    return false;
  }

  async function handlePendingFileAcceptance() {
    // Find buttons with "accept" or "accept all" text, then verify their context (near file diff stats)
    const allPotentialAcceptButtons = document.querySelectorAll("button, div[role='button']");
    for (const button of allPotentialAcceptButtons) {
      const buttonTextLower = button.textContent.trim().toLowerCase();
      if (DIFF_ACCEPT_BUTTON_TEXTS.includes(buttonTextLower)) {
        // Check context: Is it near file diff stats?
        let parent = button.parentElement;
        let attempts = 0;
        let inDiffContext = false;
        while (parent && attempts < 5) { // Check a few levels up
          const parentText = parent.textContent;
          if ( (parentText.match(/\d+\s*file(s)?/i) && parentText.match(/\+\d+/) && parentText.match(/-\d+/)) ||
               parent.querySelector("span[class*='codicon-git-']") || // Common git icons
               parent.matches(DIFF_REVIEW_BAR_CONTEXT_SELECTOR) // If we have a specific bar selector
          ) {
            inDiffContext = true; break;
          }
          parent = parent.parentElement; attempts++;
        }

        if (inDiffContext) {
          const style = window.getComputedStyle(button);
          if (style.display !== "none" && style.visibility !== "hidden" && !button.disabled && button.offsetParent !== null) {
            console.log(`[AutoScript] Found and clicking diff '${buttonTextLower}' button.`);
            button.click();
            lastActionTimestamp = Date.now();
            await new Promise(resolve => setTimeout(resolve, POST_ACCEPT_CHANGES_DELAY_MS));
            console.log(`[AutoScript] Sending "proceed" after accepting file changes.`);
            await typeAndSendMessage("proceed");
            return true; // Action taken
          }
        }
      }
    }
    return false;
  }

  async function handleAiRequestsTerminalSkip(aiVisibleMessage) {
    if (aiVisibleMessage.toLowerCase().includes("requesting script to click terminal skip button")) {
      const commandBlocks = document.querySelectorAll(TERMINAL_COMMAND_UI_BLOCK_SELECTOR);
      for (const block of commandBlocks) {
        if (block.querySelector(TERMINAL_MOVE_TO_BACKGROUND_BUTTON_SELECTOR) || block.querySelector(TERMINAL_SKIP_BUTTON_SELECTOR.split(',')[0]) || block.querySelector(TERMINAL_SKIP_BUTTON_SELECTOR.split(',')[1].trim())) {
          if (findAndClickElement([TERMINAL_SKIP_BUTTON_SELECTOR.split(',')[0], TERMINAL_SKIP_BUTTON_SELECTOR.split(',')[1].trim()], block, false)) { // Don't avoid problematic text check here, already specific
            console.log(`[AutoScript] Clicked terminal 'Skip' button as per AI request.`);
            // The AI's workflow_state.mdc should handle clearing its request.
            return true; // Action taken
          }
        }
      }
      console.warn(`[AutoScript] AI requested terminal skip, but 'Skip' button not found/clickable in active terminal blocks.`);
    }
    return false;
  }

  async function handleGeneratingBarHang(aiVisibleMessage) {
    const generatingBarParent = document.querySelector(GENERATING_BAR_PARENT_SELECTOR);
    if (!generatingBarParent) return false;

    let isGeneratingTextVisible = false;
    const walker = document.createTreeWalker(generatingBarParent, NodeFilter.SHOW_TEXT);
    let node;
    while(node = walker.nextNode()) {
        if (node.nodeValue.includes(GENERATING_TEXT_INDICATOR)) {
            isGeneratingTextVisible = true; break;
        }
    }
    // Also check for a "Stop" button as part of the "Generating" state
    const stopButtonOnBar = generatingBarParent.querySelector("button:contains('Stop'), button:has(span.codicon-stop-circle)");

    if (isGeneratingTextVisible && stopButtonOnBar && stopButtonOnBar.offsetParent !== null) {
      if (generatingStateStartTime === null || aiVisibleMessage !== lastAiMessageTextForGeneratingCheck) {
        generatingStateStartTime = Date.now();
        lastAiMessageTextForGeneratingCheck = aiVisibleMessage;
      } else if (Date.now() - generatingStateStartTime > MAX_GENERATING_STUCK_TIME_MS) {
        console.warn(`[AutoScript] 'Generating...' state appears stuck.`);
        // Check for "Accept" button on this bar (for file changes)
        const acceptButtonOnGeneratingBar = generatingBarParent.querySelector(GENERATING_BAR_ACCEPT_BUTTON_SELECTOR.split(',')[0]) || generatingBarParent.querySelector(GENERATING_BAR_ACCEPT_BUTTON_SELECTOR.split(',')[1].trim());
        if (acceptButtonOnGeneratingBar && acceptButtonOnGeneratingBar.offsetParent !== null && !acceptButtonOnGeneratingBar.disabled) {
          console.log(`[AutoScript] Clicking 'Accept' on stuck 'Generating...' bar (file changes).`);
          acceptButtonOnGeneratingBar.click();
          lastActionTimestamp = Date.now();
          await new Promise(resolve => setTimeout(resolve, POST_ACCEPT_CHANGES_DELAY_MS));
          console.log(`[AutoScript] Sending "proceed" after accepting changes from stuck 'Generating...' bar.`);
          await typeAndSendMessage("proceed");
        } else {
          console.log(`[AutoScript] Sending "proceed" to try and unstick 'Generating...'.`);
          await typeAndSendMessage("proceed");
          lastActionTimestamp = Date.now();
        }
        generatingStateStartTime = null; lastAiMessageTextForGeneratingCheck = "";
        return true; // Action taken
      }
    } else {
      generatingStateStartTime = null; lastAiMessageTextForGeneratingCheck = "";
    }
    return false;
  }

  // --- Main Loop ---
  async function checkAndProceed() {
    if (Date.now() - lastActionTimestamp < ACTION_COOLDOWN_MS) {
        return; // Respect cooldown
    }

    console.log(`[AutoScript] Checking UI state...`);

    const messageTextAreas = document.querySelectorAll(AI_MESSAGE_TEXT_AREA_SELECTOR);
    let latestAiVisibleMessage = "";
    if (messageTextAreas.length > 0) {
      latestAiVisibleMessage = getVisibleTextContent(messageTextAreas[messageTextAreas.length - 1]);
    }

    // Priority 1: AI is explicitly paused by its own logic
    if (isHumanInputRequired(latestAiVisibleMessage)) {
      console.warn(`[AutoScript] AI awaiting human input. Script pausing. Last AI msg: "${latestAiVisibleMessage.substring(0,100)}"`);
      return;
    }

    // Priority 2: AI explicitly requests script to click terminal "Skip"
    if (await handleAiRequestsTerminalSkip(latestAiVisibleMessage)) {
      consecutiveSameActionAttempts = 0; lastDomHashForNoChangeDetection = ""; return;
    }

    // Priority 3: "Generating..." bar seems stuck
    if (await handleGeneratingBarHang(latestAiVisibleMessage)) {
      consecutiveSameActionAttempts = 0; lastDomHashForNoChangeDetection = ""; return;
    }

    // Priority 4: Problematic error popups (network errors, etc.)
    if (await handleProblematicPopups()) {
      consecutiveSameActionAttempts = 0; lastDomHashForNoChangeDetection = ""; return;
    }

    // Priority 5: Pending diff acceptances ("Accept" / "Accept all")
    if (await handlePendingFileAcceptance()) {
      consecutiveSameActionAttempts = 0; lastDomHashForNoChangeDetection = ""; return;
    }

    // Priority 6: General "Continue" / "Resume conversation" / "Approve Command" buttons
    const currentDOMHash = simpleHash(document.body.innerText); // For detecting if UI changed

    if (findAndClickElement(GENERAL_CONTINUE_BUTTON_SELECTORS, null, true)) { // true to avoid clicking in problematic popups
      if (lastDomHashForNoChangeDetection === currentDOMHash) consecutiveSameActionAttempts++; else consecutiveSameActionAttempts = 0;
      lastDomHashForNoChangeDetection = currentDOMHash;
      if (consecutiveSameActionAttempts >= MAX_CONSECUTIVE_ACTION_ATTEMPTS) {
        console.warn(`[AutoScript] Clicked a 'Continue' type element ${consecutiveSameActionAttempts} times without DOM change. Pausing this action type briefly.`);
        consecutiveSameActionAttempts = 0; // Reset and effectively pause this type of action for a cycle
        return;
      }
      return; // Action taken
    }

    if (findAndClickElement(APPROVE_COMMAND_BUTTON_SELECTORS, null, true)) {
      consecutiveSameActionAttempts = 0; lastDomHashForNoChangeDetection = ""; return; // Action taken
    }

    // If no action taken, reset counter if DOM changed
    if (lastDomHashForNoChangeDetection !== currentDOMHash) {
      consecutiveSameActionAttempts = 0;
    }
    lastDomHashForNoChangeDetection = currentDOMHash;
  }

  // Start the main loop
  setInterval(checkAndProceed, CHECK_INTERVAL_MS);
  console.log(`[AutoScript] Main loop started. Checking every ${CHECK_INTERVAL_MS / 1000}s.`);
  checkAndProceed(); // Run once immediately
})();
