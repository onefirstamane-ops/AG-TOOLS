
/* =====================================================
   AG TOOLS — FRONTEND APPLICATION
   File: script.js
   Backend: Flask API
   ===================================================== */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

// Render backend URL
const API_BASE = "https://ag-tools-0n7t.onrender.com";

// আপনার নিজের GitHub Pages frontend URL
const APP_NAME = "AG TOOLS";

const FREE_TOOL_LIMIT = 20;
const VIP_TOOL_LIMIT = 53;
const VIP_DAYS = 30;

/* ---------------- APP STATE ---------------- */

const state = {
  user: null,
  csrfToken: "",
  tools: [],
  search: "",
  category: "all",
  loading: false
};

/* ---------------- DOM HELPERS ---------------- */

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showElement(element) {
  if (element) {
    element.hidden = false;
    element.classList.remove("hidden");
  }
}

function hideElement(element) {
  if (element) {
    element.hidden = true;
    element.classList.add("hidden");
  }
}

/* ---------------- NOTIFICATIONS ---------------- */

function toast(message, type = "info") {
  let container = $(".toast-container");

  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;

  container.appendChild(item);

  // Keep notifications temporary without using HTML injection.
  window.setTimeout(() => item.remove(), 4500);
}

/* ---------------- API CLIENT ---------------- */

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  const headers = {
    "Accept": "application/json",
    ...(options.headers || {})
  };

  const config = {
    method,
    headers,
    credentials: "include",
    mode: "cors"
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(options.body);
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!state.csrfToken) {
      await refreshCSRF();
    }

    headers["X-CSRF-Token"] = state.csrfToken;
  }

  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, config);
  } catch (err) {
    throw new Error(
      "Backend-এ সংযোগ হচ্ছে না। Render service Live আছে কি না পরীক্ষা করুন।"
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

async function refreshCSRF() {
  let response;

  try {
    response = await fetch(`${API_BASE}/api/csrf`, {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "application/json" }
    });
  } catch (err) {
    throw new Error("Backend-এ সংযোগ করা যায়নি।");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.csrf_token) {
    throw new Error(data.error || "CSRF token পাওয়া যায়নি।");
  }

  state.csrfToken = data.csrf_token;
  return state.csrfToken;
}

/* ---------------- AUTHENTICATION ---------------- */

async function registerAccount(email, password) {
  const data = await api("/api/register", {
    method: "POST",
    body: { email, password }
  });

  state.user = data.user;
  state.csrfToken = data.csrf_token || state.csrfToken;

  renderAccount();
  toast("Account তৈরি হয়েছে!", "success");
  return data;
}

async function loginAccount(email, password) {
  const data = await api("/api/login", {
    method: "POST",
    body: { email, password }
  });

  state.user = data.user;
  state.csrfToken = data.csrf_token || state.csrfToken;

  renderAccount();
  toast("Login সফল হয়েছে!", "success");
  return data;
}

async function logoutAccount() {
  await api("/api/logout", { method: "POST" });

  state.user = null;
  state.csrfToken = "";

  await refreshCSRF();
  renderAccount();

  toast("Logout সফল হয়েছে।", "success");
}

async function loadAccount() {
  try {
    await refreshCSRF();

    const data = await api("/api/me");
    state.user = data.user;
  } catch (err) {
    state.user = null;

    // A guest may receive 401; that is not a backend outage.
    if (!String(err.message).includes("401")) {
      console.info("Account not loaded:", err.message);
    }
  }

  renderAccount();
}

/* ---------------- ACCOUNT UI ---------------- */

function renderAccount() {
  const user = state.user;
  const loggedIn = Boolean(user);

  $$("[data-auth-only]").forEach(el => {
    el.hidden = !loggedIn;
    el.classList.toggle("hidden", !loggedIn);
  });

  $$("[data-guest-only]").forEach(el => {
    el.hidden = loggedIn;
    el.classList.toggle("hidden", loggedIn);
  });

  $$("[data-user-email]").forEach(el => {
    el.textContent = user ? user.email : "Guest";
  });

  $$("[data-user-role]").forEach(el => {
    el.textContent = user
      ? (user.role === "vip" ? "VIP Member" :
         user.role === "admin" ? "Admin" : "Normal User")
      : "Guest";
  });

  $$("[data-tool-count]").forEach(el => {
    el.textContent = user
      ? String(user.total_tools || FREE_TOOL_LIMIT)
      : String(FREE_TOOL_LIMIT);
  });

  $$("[data-vip-status]").forEach(el => {
    el.textContent = user?.vip_active ? "Active" : "Not Active";
  });

  renderToolLocks();
}

/* ---------------- AUTH FORM BINDINGS ---------------- */

function bindRegisterForm() {
  const form = $("#register-form") || $("[data-register-form]");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = $('[name="email"]', form)?.value.trim();
    const password = $('[name="password"]', form)?.value;

    if (!email || !password) {
      toast("Email ও Password দিন।", "error");
      return;
    }

    const submit = $('button[type="submit"]', form);

    try {
      if (submit) submit.disabled = true;

      await registerAccount(email, password);
      form.reset();

      document.dispatchEvent(new CustomEvent("ag:registered"));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function bindLoginForm() {
  const form = $("#login-form") || $("[data-login-form]");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = $('[name="email"]', form)?.value.trim();
    const password = $('[name="password"]', form)?.value;

    if (!email || !password) {
      toast("Email ও Password দিন।", "error");
      return;
    }

    const submit = $('button[type="submit"]', form);

    try {
      if (submit) submit.disabled = true;

      await loginAccount(email, password);
      form.reset();

      document.dispatchEvent(new CustomEvent("ag:loggedin"));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function bindLogoutButtons() {
  $$("[data-logout], #logout-btn").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        await logoutAccount();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

/* ---------------- TOOL DATA ---------------- */

// Tool names and categories shown in the interface.
// Real tool execution requires a matching implementation.

const TOOL_CATALOG = [
  ["Text Case Converter", "text", "Aa"],
  ["Word Counter", "text", "W"],
  ["Character Counter", "text", "C"],
  ["Remove Extra Spaces", "text", "S"],
  ["Reverse Text", "text", "R"],
  ["Text to Slug", "text", "T"],
  ["JSON Formatter", "developer", "{}"],
  ["Base64 Encoder", "developer", "64"],
  ["URL Encoder", "developer", "URL"],
  ["HTML Escape", "developer", "<>"],
  ["Password Generator", "security", "P"],
  ["Random Number", "utility", "#"],
  ["Percentage Calculator", "calculator", "%"],
  ["Age Calculator", "calculator", "A"],
  ["Unit Converter", "calculator", "↔"],
  ["BMI Calculator", "calculator", "B"],
  ["Stopwatch", "utility", "⏱"],
  ["Countdown Timer", "utility", "◷"],
  ["QR Text Generator", "utility", "QR"],
  ["Color Converter", "design", "RGB"],

  ["AI Prompt Builder", "ai", "AI"],
  ["Advanced JSON Tools", "developer", "{}"],
  ["Code Formatter Pro", "developer", "CF"],
  ["Regex Tester", "developer", ".*"],
  ["Markdown Preview", "developer", "MD"],
  ["Diff Checker", "developer", "DI"],
  ["JWT Decoder", "security", "JWT"],
  ["Hash Generator", "security", "#"],
  ["Secure Token Generator", "security", "TK"],
  ["UUID Generator", "developer", "ID"],
  ["Advanced QR Tools", "utility", "QR"],
  ["Image Metadata Viewer", "media", "IMG"],
  ["Image Dimension Checker", "media", "PX"],
  ["SVG Optimizer", "design", "SVG"],
  ["CSS Gradient Builder", "design", "CSS"],
  ["Shadow Generator", "design", "SH"],
  ["Palette Generator", "design", "CL"],
  ["Contrast Checker", "design", "AA"],
  ["Color Palette Exporter", "design", "HEX"],
  ["Advanced Calculator", "calculator", "CALC"],
  ["Scientific Calculator", "calculator", "SCI"],
  ["Date Difference", "calculator", "DATE"],
  ["Time Zone Converter", "utility", "TZ"],
  ["CSV Viewer", "developer", "CSV"],
  ["CSV to JSON", "developer", "CSV"],
  ["JSON to CSV", "developer", "JSON"],
  ["XML Formatter", "developer", "XML"],
  ["SQL Formatter", "developer", "SQL"],
  ["Text Compare Pro", "text", "DIFF"],
  ["Lorem Ipsum Generator", "text", "TXT"],
  ["Advanced Word Tools", "text", "W+"],
  ["Developer Snippet Library", "developer", "LIB"],
  ["Website Checklist", "utility", "WEB"]
].map((item, index) => ({
  id: index + 1,
  name: item[0],
  category: item[1],
  icon: item[2],
  vip: index >= FREE_TOOL_LIMIT,
  description: item[3] || (
    index >= FREE_TOOL_LIMIT
      ? "VIP membership required"
      : "Free utility tool"
  )
}));

state.tools = TOOL_CATALOG;

/* ---------------- TOOL LOCKS ---------------- */

function hasVIPAccess() {
  return Boolean(
    state.user &&
    (state.user.role === "admin" || state.user.vip_active)
  );
}

function renderToolLocks() {
  $$("[data-vip-tool]").forEach(card => {
    const locked = !hasVIPAccess();

    card.classList.toggle("locked", locked);
    card.setAttribute("aria-disabled", String(locked));

    const button = $("[data-tool-open]", card);

    if (button) {
      button.textContent = locked ? "Unlock VIP" : "Open Tool";
    }
  });
}

function createToolCard(tool) {
  const card = document.createElement("article");

  card.className = `tool-card ${tool.vip ? "vip-card" : ""}`;
  card.dataset.toolId = String(tool.id);
  card.dataset.category = tool.category;

  if (tool.vip) {
    card.dataset.vipTool = "true";
  }

  card.innerHTML = `
    <div class="tool-card-header flex-between">
      <div class="tool-icon">${escapeHTML(tool.icon)}</div>
      ${
        tool.vip
          ? '<span class="vip-badge">★ VIP</span>'
          : '<span class="badge badge-success">FREE</span>'
      }
    </div>
    <h3 class="tool-name">${escapeHTML(tool.name)}</h3>
    <p class="tool-description">${escapeHTML(tool.description)}</p>
    <div class="tool-card-footer">
      <span class="muted">${escapeHTML(tool.category)}</span>
      <button class="btn btn-sm btn-outline"
              type="button"
              data-tool-open
              data-tool-id="${tool.id}">
        ${tool.vip && !hasVIPAccess() ? "Unlock VIP" : "Open Tool"}
      </button>
    </div>
  `;

  return card;
}

function renderTools(selector = "#tools-grid") {
  const grid = $(selector);

  if (!grid) return;

  const filtered = state.tools.filter(tool => {
    const matchesSearch = (
      tool.name.toLowerCase().includes(state.search.toLowerCase()) ||
      tool.category.toLowerCase().includes(state.search.toLowerCase())
    );

    const matchesCategory =
      state.category === "all" ||
      tool.category === state.category;

    const matchesAccess =
      state.category === "free" ? !tool.vip :
      state.category === "vip" ? tool.vip : true;

    return matchesSearch && matchesCategory && matchesAccess;
  });

  grid.replaceChildren();

  filtered.forEach(tool => {
    grid.appendChild(createToolCard(tool));
  });

  renderToolLocks();
}

function bindToolSearch() {
  const input = $("#tool-search") || $("[data-tool-search]");

  if (input) {
    input.addEventListener("input", () => {
      state.search = input.value.trim();
      renderTools();
    });
  }

  $$("[data-category-filter]").forEach(button => {
    button.addEventListener("click", () => {
      state.category = button.dataset.categoryFilter || "all";

      $$("[data-category-filter]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      renderTools();
    });
  });
}

/* ---------------- BASIC FREE TOOL EXECUTION ---------------- */

function openTool(toolId) {
  const tool = state.tools.find(item => item.id === Number(toolId));

  if (!tool) {
    toast("Tool পাওয়া যায়নি।", "error");
    return;
  }

  if (tool.vip && !hasVIPAccess()) {
    toast("এই Tool ব্যবহার করতে VIP Membership লাগবে।", "error");
    showVIPSection();
    return;
  }

  // The catalog is only a directory. Tools that do not yet
  // have a real implementation must not pretend to run.
  switch (tool.name) {
    case "Text Case Converter":
      runTextCaseTool();
      break;

    case "Word Counter":
      runWordCounter();
      break;

    case "Character Counter":
      runCharacterCounter();
      break;

    case "Remove Extra Spaces":
      runRemoveSpaces();
      break;

    case "Reverse Text":
      runReverseText();
      break;

    case "Text to Slug":
      runSlugTool();
      break;

    case "JSON Formatter":
      runJSONFormatter();
      break;

    case "Base64 Encoder":
      runBase64Tool();
      break;

    case "URL Encoder":
      runURLEncoder();
      break;

    case "HTML Escape":
      runHTMLEscape();
      break;

    case "Password Generator":
      runPasswordGenerator();
      break;

    case "Random Number":
      runRandomNumber();
      break;

    case "Percentage Calculator":
      runPercentageCalculator();
      break;

    case "Color Converter":
      runColorConverter();
      break;

    default:
      toast(
        `${tool.name}: এই Tool-এর কার্যকর implementation এখনো যোগ করা হয়নি।`,
        "info"
      );
  }
}

function runTextCaseTool() {
  const text = prompt("Text লিখুন:");
  if (text === null) return;

  const choice = prompt(
    "1 = UPPERCASE\n2 = lowercase\n3 = Title Case"
  );

  let result;

  if (choice === "1") {
    result = text.toUpperCase();
  } else if (choice === "2") {
    result = text.toLowerCase();
  } else if (choice === "3") {
    result = text.replace(/\b\w/g, char => char.toUpperCase());
  } else {
    return;
  }

  showResult("Text Case Converter", result);
}

function runWordCounter() {
  const text = prompt("Text লিখুন:");
  if (text === null) return;

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  showResult("Word Counter", `Words: ${words}`);
}

function runCharacterCounter() {
  const text = prompt("Text লিখুন:");
  if (text === null) return;

  showResult(
    "Character Counter",
    `Characters: ${text.length}\nWithout spaces: ${text.replace(/\s/g, "").length}`
  );
}

function runRemoveSpaces() {
  const text = prompt("Text লিখুন:");
  if (text === null) return;

  showResult(
    "Remove Extra Spaces",
    text.replace(/\s+/g, " ").trim()
  );
}

function runReverseText() {
  const text = prompt("Text লিখুন:");
  if (text === null) return;

  showResult("Reverse Text", Array.from(text).reverse().join(""));
}

function runSlugTool() {
  const text = prompt("Title লিখুন:");
  if (text === null) return;

  const slug = text
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  showResult("Text to Slug", slug);
}

function runJSONFormatter() {
  const text = prompt("JSON paste করুন:");
  if (text === null) return;

  try {
    showResult(
      "JSON Formatter",
      JSON.stringify(JSON.parse(text), null, 2)
    );
  } catch (err) {
    toast("JSON সঠিক নয়।", "error");
  }
}

function runBase64Tool() {
  const text = prompt("Encode করার text লিখুন:");
  if (text === null) return;

  try {
    showResult("Base64 Encoder", btoa(unescape(encodeURIComponent(text))));
  } catch (err) {
    toast("Text encode করা যায়নি।", "error");
  }
}

function runURLEncoder() {
  const text = prompt("Text বা URL লিখুন:");
  if (text === null) return;

  showResult("URL Encoder", encodeURIComponent(text));
}

function runHTMLEscape() {
  const text = prompt("HTML text লিখুন:");
  if (text === null) return;

  showResult("HTML Escape", escapeHTML(text));
}

function runPasswordGenerator() {
  const length = Number(prompt("Password length (8–64):", "16"));

  if (!Number.isInteger(length) || length < 8 || length > 64) {
    toast("Length অবশ্যই 8 থেকে 64 হতে হবে।", "error");
    return;
  }

  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";

  const random = new Uint32Array(length);
  crypto.getRandomValues(random);

  let password = "";

  for (let i = 0; i < length; i++) {
    password += alphabet[random[i] % alphabet.length];
  }

  showResult("Password Generator", password);
}

function runRandomNumber() {
  const min = Number(prompt("Minimum number:", "1"));
  const max = Number(prompt("Maximum number:", "100"));

  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    max < min ||
    max - min > 1000000000
  ) {
    toast("সঠিক Minimum ও Maximum দিন।", "error");
    return;
  }

  const result = min + Math.floor(Math.random() * (max - min + 1));
  showResult("Random Number", String(result));
}

function runPercentageCalculator() {
  const amount = Number(prompt("Total amount:"));
  const percent = Number(prompt("Percentage:"));

  if (!Number.isFinite(amount) || !Number.isFinite(percent)) {
    toast("সঠিক সংখ্যা দিন।", "error");
    return;
  }

  showResult(
    "Percentage Calculator",
    `${percent}% of ${amount} = ${(amount * percent / 100).toFixed(4)}`
  );
}

function runColorConverter() {
  const hex = prompt("HEX color লিখুন, যেমন #28F0E2:");
  if (hex === null) return;

  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());

  if (!match) {
    toast("৬ অক্ষরের HEX color দিন।", "error");
    return;
  }

  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  showResult("Color Converter", `HEX: #${value.toUpperCase()}\nRGB: ${r}, ${g}, ${b}`);
}

function showResult(title, text) {
  const result = window.prompt(`${title}\n\nCopy করার জন্য নিচের text:`, text);

  if (result !== null) {
    copyText(result);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    toast("Copied!", "success");
  } catch (err) {
    // Clipboard API may be unavailable in some browser contexts.
    const area = document.createElement("textarea");
    area.value = String(text);
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();

    const success = document.execCommand("copy");
    area.remove();

    toast(
      success ? "Copied!" : "Text select করে copy করুন।",
      success ? "success" : "info"
    );
  }
}

/* ---------------- VIP MEMBERSHIP ---------------- */

function showVIPSection() {
  const section = $("#vip-section") || $("[data-vip-section]");

  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    toast("VIP Section HTML-এ যোগ করতে হবে।", "info");
  }
}

async function requestVIP(paymentMethod, transactionRef) {
  if (!state.user) {
    toast("আগে Login করুন।", "error");
    return;
  }

  if (state.user.vip_active) {
    toast("তোমার VIP ইতিমধ্যে Active।", "success");
    return;
  }

  const result = await api("/api/vip/request", {
    method: "POST",
    body: {
      payment_method: paymentMethod,
      transaction_ref: transactionRef
    }
  });

  toast(result.message || "VIP request জমা হয়েছে।", "success");
  await refreshVIPStatus();
}

async function refreshVIPStatus() {
  if (!state.user) return null;

  const data = await api("/api/vip/status");

  if (data.user) {
    state.user = data.user;
    renderAccount();
  }

  $$("[data-vip-requests]").forEach(container => {
    container.replaceChildren();

    (data.requests || []).forEach(item => {
      const row = document.createElement("div");
      row.className = "panel";
      row.style.marginBottom = "10px";

      const title = document.createElement("strong");
      title.textContent = `Request #${item.id}`;

      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent =
        `${item.payment_method} · ${item.status} · ${item.created_at}`;

      row.append(title, detail);
      container.appendChild(row);
    });
  });

  return data;
}

function bindVIPRequestForm() {
  const form = $("#vip-request-form") || $("[data-vip-request-form]");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const method = $('[name="payment_method"]', form)?.value;
    const reference = $('[name="transaction_ref"]', form)?.value.trim();

    if (!method || !reference) {
      toast("Payment method ও transaction reference দিন।", "error");
      return;
    }

    const submit = $('button[type="submit"]', form);

    try {
      if (submit) submit.disabled = true;

      await requestVIP(method, reference);
      form.reset();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

/* ---------------- MOBILE MENU ---------------- */

function bindMobileMenu() {
  const button = $(".menu-toggle") || $(".mobile-menu-button");
  const menu = $(".nav-links") || $(".nav-menu");

  if (!button || !menu) return;

  button.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("open");
    menu.classList.toggle("show", isOpen);
    button.setAttribute("aria-expanded", String(isOpen));
  });

  $$("a", menu).forEach(link => {
    link.addEventListener("click", () => {
      menu.classList.remove("open", "show");
      button.setAttribute("aria-expanded", "false");
    });
  });
}

/* ---------------- GLOBAL CLICK HANDLERS ---------------- */

function bindGlobalActions() {
  document.addEventListener("click", async event => {
    const openButton = event.target.closest("[data-tool-open]");

    if (openButton) {
      openTool(openButton.dataset.toolId);
      return;
    }

    const copyButton = event.target.closest("[data-copy]");

    if (copyButton) {
      const value = copyButton.dataset.copy;

      if (value) {
        await copyText(value);
      }
    }
  });
}

/* ---------------- HEALTH CHECK ---------------- */

async function checkBackend() {
  const indicator = $("[data-backend-status]");

  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      method: "GET",
      mode: "cors",
      headers: { "Accept": "application/json" }
    });

    const data = await response.json();

    if (!response.ok || data.status !== "ok") {
      throw new Error("Backend is not healthy");
    }

    if (indicator) {
      indicator.textContent = "Backend Online";
      indicator.className = "badge badge-success";
    }

    return true;
  } catch (err) {
    if (indicator) {
      indicator.textContent = "Backend Offline";
      indicator.className = "badge badge-danger";
    }

    console.warn("Backend health check failed:", err.message);
    return false;
  }
}

/* ---------------- INITIALIZE ---------------- */

async function initApp() {
  bindRegisterForm();
  bindLoginForm();
  bindLogoutButtons();
  bindToolSearch();
  bindVIPRequestForm();
  bindMobileMenu();
  bindGlobalActions();

  renderTools();
  await checkBackend();
  await loadAccount();

  document.dispatchEvent(new CustomEvent("ag:ready"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
  initApp();
}

/* ---------------- PUBLIC API ---------------- */

window.AGTools = Object.freeze({
  api,
  loginAccount,
  registerAccount,
  logoutAccount,
  refreshVIPStatus,
  requestVIP,
  renderTools,
  checkBackend,
  copyText,
  getUser: () => state.user
});
