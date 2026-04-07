function getApiBase() {
  const override = localStorage.getItem("careerCompassApiBaseUrl");
  if (override) return override.replace(/\/$/, "");
  if (window.location.protocol === "file:") return "http://localhost:5000";
  if ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000") {
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return window.location.origin;
}

document.addEventListener("DOMContentLoaded", () => {
  const API = getApiBase();
  const token = localStorage.getItem("token");
  const USER_EMAIL_KEY = "careerCompassUserEmail";
  let allData = [];

  if (!token) {
    window.location.href = "login.html";
    return;
  }

  function handleUnauthorized() {
    localStorage.removeItem("token");
    localStorage.removeItem(USER_EMAIL_KEY);
    alert("Your session has expired. Please login again.");
    window.location.href = "login.html";
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem(USER_EMAIL_KEY);
    window.location.href = "login.html";
  }

  function setUserEmail(email) {
    const safeEmail = email || "user@example.com";
    document.getElementById("profileEmail").innerText = safeEmail;
    document.getElementById("profileBadge").innerText = safeEmail.charAt(0).toUpperCase();
    localStorage.setItem(USER_EMAIL_KEY, safeEmail);
  }

  async function syncProfile() {
    const storedEmail = localStorage.getItem(USER_EMAIL_KEY);
    if (storedEmail) setUserEmail(storedEmail);

    try {
      const res = await fetch(`${API}/me`, {
        headers: { Authorization: token }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.email) setUserEmail(data.email);
    } catch {}
  }

  function getScoreClass(score) {
    if (score >= 75) return "high";
    if (score >= 50) return "medium";
    return "low";
  }

  function formatTimestamp(value) {
    if (!value) return "Unknown time";
    const normalized = typeof value === "string" && value.includes(" ")
      ? `${value.replace(" ", "T")}Z`
      : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function view(id) {
    window.location.href = `report.html?id=${id}`;
  }

  async function deleteReport(id) {
    if (!confirm("Delete this report?")) return;

    try {
      const res = await fetch(`${API}/delete/${id}`, {
        method: "DELETE",
        headers: { Authorization: token }
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        alert(data.error || "Failed to delete report");
        return;
      }

      loadHistory();
    } catch {
      alert("Unable to reach the server. Please try again.");
    }
  }

  function render(data) {
    const container = document.getElementById("history");

    if (!data.length) {
      container.innerHTML = "<p class=\"empty\">No history found</p>";
      return;
    }

    container.innerHTML = data.map(item => `
      <div class="card">
        <div class="card-header">
          <div>
            <h3>${item.filename || "Resume"}</h3>
            <p><b>Role:</b> ${item.jobRole || "N/A"}</p>
          </div>
          <div class="actions">
            <button class="view-btn" data-view-id="${item.id}">View</button>
            <button class="delete-btn" data-delete-id="${item.id}">Delete</button>
          </div>
        </div>
        <div class="badges">
          <span class="badge ${getScoreClass(item.score)}">Score: ${item.score}</span>
          <span class="badge match">Match: ${item.jobMatch}%</span>
        </div>
        <p class="date">${formatTimestamp(item.created_at)}</p>
      </div>
    `).join("");

    container.querySelectorAll("[data-view-id]").forEach(button => {
      button.addEventListener("click", () => view(button.dataset.viewId));
    });

    container.querySelectorAll("[data-delete-id]").forEach(button => {
      button.addEventListener("click", () => deleteReport(button.dataset.deleteId));
    });
  }

  function filterData() {
    const q = document.getElementById("search").value.toLowerCase();
    const filtered = allData.filter(item =>
      (item.filename || "").toLowerCase().includes(q) ||
      (item.jobRole || "").toLowerCase().includes(q)
    );
    render(filtered);
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API}/history`, {
        headers: { Authorization: token }
      });
      const data = await res.json().catch(() => []);

      if (!res.ok) {
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        alert(data.error || "Failed to load history");
        render([]);
        return;
      }

      allData = Array.isArray(data) ? data : [];
      render(allData);
    } catch {
      alert("Unable to reach the server. Please try again.");
      render([]);
    }
  }

  document.getElementById("homeBtn").addEventListener("click", () => {
    window.location.href = "home.html";
  });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("search").addEventListener("input", filterData);

  loadHistory();
  syncProfile();
});
