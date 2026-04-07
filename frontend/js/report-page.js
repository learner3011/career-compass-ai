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
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!token) {
    window.location.href = "login.html";
    return;
  }

  function handleUnauthorized() {
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

  function setStatus(message) {
    document.getElementById("actionStatus").innerText = message || "";
  }

  async function downloadBlob(url, filename) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: token }
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }

        alert(errorData.error || "Download failed");
        return;
      }

      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(objectUrl);
    } catch {
      alert("Unable to reach the server. Please try again.");
    }
  }

  async function enhanceResume() {
    const button = document.getElementById("fixResumeBtn");
    button.disabled = true;
    button.innerText = "Fixing...";
    setStatus("Generating enhanced resume...");

    try {
      const res = await fetch(`${API}/enhance-resume/${id}`, {
        method: "POST",
        headers: { Authorization: token }
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }

        alert(data.error || "Failed to enhance resume");
        setStatus("");
        return;
      }

      document.getElementById("enhancedPreview").innerText =
        data.enhancedResume || "No enhanced resume generated.";
      document.getElementById("downloadEnhancedBtn").disabled = !data.enhancedResume;
      setStatus("Enhanced resume ready.");
    } catch {
      alert("Unable to reach the server. Please try again.");
      setStatus("");
    } finally {
      button.disabled = false;
      button.innerText = "Fix Resume";
    }
  }

  async function loadReport() {
    let data;

    try {
      const res = await fetch(`${API}/report/${id}`, {
        headers: { Authorization: token }
      });
      data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data.error || "Failed to load report");
        if (res.status === 401) {
          handleUnauthorized();
        }
        return;
      }
    } catch {
      alert("Unable to reach the server. Please try again.");
      return;
    }

    const good = Array.isArray(data.good) ? data.good : [];
    const bad = Array.isArray(data.bad) ? data.bad : [];
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

    document.getElementById("reportTitle").innerText = data.filename || "Resume Report";
    document.getElementById("reportMeta").innerText =
      data.jobRole ? `Target role: ${data.jobRole}` : "General resume analysis";
    document.getElementById("score").innerText = data.score ?? 0;
    document.getElementById("jobMatch").innerText = `${data.jobMatch ?? 0}%`;

    document.getElementById("good").innerHTML =
      `<h2>Strengths</h2><ul>${good.map(item => `<li>${item}</li>`).join("") || "<li>No strengths available.</li>"}</ul>`;

    document.getElementById("bad").innerHTML =
      `<h2>Weaknesses</h2><ul>${bad.map(item => `<li>${item}</li>`).join("") || "<li>No weaknesses available.</li>"}</ul>`;

    document.getElementById("suggestions").innerHTML =
      `<h2>Suggestions</h2><ul>${suggestions.map(item => `<li>${item}</li>`).join("") || "<li>No suggestions available.</li>"}</ul>`;

    if (data.enhanced_resume) {
      document.getElementById("enhancedPreview").innerText = data.enhanced_resume;
      document.getElementById("downloadEnhancedBtn").disabled = false;
      setStatus("Enhanced resume already available.");
    }
  }

  document.getElementById("homeBtn").addEventListener("click", () => {
    window.location.href = "home.html";
  });
  document.getElementById("historyBtn").addEventListener("click", () => {
    window.location.href = "history.html";
  });
  document.getElementById("downloadBtn").addEventListener("click", () => {
    downloadBlob(`${API}/download/${id}`, "report.pdf");
  });
  document.getElementById("fixResumeBtn").addEventListener("click", enhanceResume);
  document.getElementById("downloadEnhancedBtn").addEventListener("click", () => {
    downloadBlob(`${API}/download-enhanced/${id}`, "enhanced-resume.pdf");
  });

  syncProfile();
  loadReport();
});
