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
  const STORAGE_KEY = "careerCompassLatestAnalysis";
  const ENHANCED_KEY = "careerCompassEnhancedResume";
  const USER_EMAIL_KEY = "careerCompassUserEmail";
  let chart;
  let radar;

  if (!localStorage.getItem("token")) {
    window.location.href = "login.html";
    return;
  }

  function setUserEmail(email) {
    const safeEmail = email || "user@example.com";
    localStorage.setItem(USER_EMAIL_KEY, safeEmail);
    document.getElementById("profileEmail").innerText = safeEmail;
    document.getElementById("profileBadge").innerText = safeEmail.charAt(0).toUpperCase();
  }

  async function syncProfile() {
    const storedEmail = localStorage.getItem(USER_EMAIL_KEY);
    if (storedEmail) {
      setUserEmail(storedEmail);
    }

    try {
      const res = await fetch(`${API}/me`, {
        headers: { Authorization: localStorage.getItem("token") }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.email) {
        setUserEmail(data.email);
      }
    } catch {}
  }

  function handleUnauthorized() {
    localStorage.removeItem("token");
    localStorage.removeItem(USER_EMAIL_KEY);
    alert("Your session has expired. Please login again.");
    window.location.href = "login.html";
  }

  function setLoading(isLoading) {
    document.getElementById("loader").classList.toggle("hidden", !isLoading);
    document.getElementById("analyzeBtn").disabled = isLoading;
    document.getElementById("fixResumeBtn").disabled = isLoading;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem(USER_EMAIL_KEY);
    window.location.href = "login.html";
  }

  function goHistory() {
    window.location.href = "history.html";
  }

  function getSavedAnalysis() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function getSavedEnhancedResume() {
    return localStorage.getItem(ENHANCED_KEY) || "";
  }

  function saveAnalysis(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function saveEnhancedResume(text) {
    localStorage.setItem(ENHANCED_KEY, text || "");
  }

  function clearResults() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ENHANCED_KEY);
    document.getElementById("jobRole").value = "";
    document.getElementById("resume").value = "";
    document.getElementById("resultPanel").classList.add("hidden-panel");
    document.getElementById("emptyState").style.display = "block";
    document.getElementById("enhancedResumePreview").innerText = "Generate the enhanced resume to preview it here.";
    document.getElementById("downloadEnhancedBtn").disabled = true;
    document.getElementById("analysisMeta").innerText = "";
    document.getElementById("goodBox").innerHTML = "";
    document.getElementById("badBox").innerHTML = "";
    document.getElementById("suggestionsBox").innerHTML = "";
    document.getElementById("progress").style.width = "0%";
    document.getElementById("score").innerText = "0";
    document.getElementById("jobMatch").innerText = "0";
    document.getElementById("reportIdLabel").innerText = "-";
    if (chart) chart.destroy();
    if (radar) radar.destroy();
  }

  function renderAnalysis(data) {
    if (!data) {
      clearResults();
      return;
    }

    const good = Array.isArray(data.analysis?.good) ? data.analysis.good : [];
    const bad = Array.isArray(data.analysis?.bad) ? data.analysis.bad : [];
    const suggestions = Array.isArray(data.analysis?.suggestions) ? data.analysis.suggestions : [];
    const breakdown = data.breakdown || {};
    const enhancedResume = getSavedEnhancedResume();

    document.getElementById("resultPanel").classList.remove("hidden-panel");
    document.getElementById("emptyState").style.display = "none";
    document.getElementById("jobRole").value = data.jobRole || "";
    document.getElementById("score").innerText = `${data.score ?? 0}`;
    document.getElementById("jobMatch").innerText = `${data.jobMatch ?? 0}%`;
    document.getElementById("reportIdLabel").innerText = data.reportId || "-";
    document.getElementById("analysisMeta").innerText =
      `${data.filename || "Resume"}${data.jobRole ? ` - ${data.jobRole}` : ""}`;
    document.getElementById("progress").style.width = `${data.score ?? 0}%`;

    if (chart) chart.destroy();
    chart = new Chart(document.getElementById("chart"), {
      type: "bar",
      data: {
        labels: ["Strengths", "Weaknesses"],
        datasets: [{
          label: "Resume Analysis",
          backgroundColor: ["#15803d", "#b91c1c"],
          data: [good.length, bad.length]
        }]
      },
      options: { responsive: true, maintainAspectRatio: true }
    });

    if (radar) radar.destroy();
    radar = new Chart(document.getElementById("radar"), {
      type: "radar",
      data: {
        labels: ["Skills", "Experience", "Format"],
        datasets: [{
          label: "Breakdown",
          data: [
            breakdown.skills ?? 0,
            breakdown.experience ?? 0,
            breakdown.format ?? 0
          ],
          backgroundColor: "rgba(217, 119, 6, 0.2)",
          borderColor: "#d97706",
          pointBackgroundColor: "#b45309"
        }]
      },
      options: {
        scales: {
          r: {
            suggestedMin: 0,
            suggestedMax: 100
          }
        }
      }
    });

    document.getElementById("goodBox").innerHTML =
      `<h3>Strengths</h3><ul>${good.map(item => `<li>${item}</li>`).join("") || "<li>No strengths available.</li>"}</ul>`;

    document.getElementById("badBox").innerHTML =
      `<h3>Weaknesses</h3><ul>${bad.map(item => `<li>${item}</li>`).join("") || "<li>No weaknesses available.</li>"}</ul>`;

    document.getElementById("suggestionsBox").innerHTML =
      `<span class="eyebrow">Suggestions</span><h2 class="section-title">How to improve this resume</h2><ul>${suggestions.map(item => `<li>${item}</li>`).join("") || "<li>No suggestions available.</li>"}</ul>`;

    document.getElementById("enhancedResumePreview").innerText =
      enhancedResume || "Generate the enhanced resume to preview it here.";
    document.getElementById("downloadEnhancedBtn").disabled = !enhancedResume || !data.reportId;
  }

  async function uploadResume() {
    const file = document.getElementById("resume").files[0];
    if (!file) return alert("Upload a resume first.");
    if (file.type && file.type !== "application/pdf") {
      return alert("Please upload a PDF resume.");
    }

    setLoading(true);

    try {
      const form = new FormData();
      form.append("resume", file);
      form.append("jobRole", document.getElementById("jobRole").value);

      const res = await fetch(`${API}/upload-resume`, {
        method: "POST",
        headers: { Authorization: localStorage.getItem("token") },
        body: form
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        alert(data.error || "Failed to analyze resume");
        return;
      }

      const enrichedData = {
        ...data,
        filename: file.name,
        jobRole: document.getElementById("jobRole").value || "General"
      };

      saveAnalysis(enrichedData);
      saveEnhancedResume("");
      renderAnalysis(enrichedData);
    } catch {
      alert("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function enhanceResume() {
    const analysis = getSavedAnalysis();
    if (!analysis?.reportId) {
      alert("Analyze a resume first.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API}/enhance-resume/${analysis.reportId}`, {
        method: "POST",
        headers: { Authorization: localStorage.getItem("token") }
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        alert(data.error || "Failed to enhance resume");
        return;
      }

      saveEnhancedResume(data.enhancedResume || "");
      document.getElementById("enhancedResumePreview").innerText =
        data.enhancedResume || "No enhanced resume generated.";
      document.getElementById("downloadEnhancedBtn").disabled = !data.enhancedResume;
    } catch {
      alert("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadEnhancedResume() {
    const analysis = getSavedAnalysis();
    if (!analysis?.reportId) {
      alert("Analyze and enhance a resume first.");
      return;
    }

    try {
      const res = await fetch(`${API}/download-enhanced/${analysis.reportId}`, {
        headers: { Authorization: localStorage.getItem("token") }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        alert(data.error || "Failed to download enhanced resume");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "enhanced-resume.pdf";
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Unable to reach the server. Please try again.");
    }
  }

  document.getElementById("historyBtn").addEventListener("click", goHistory);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("analyzeBtn").addEventListener("click", uploadResume);
  document.getElementById("clearBtn").addEventListener("click", clearResults);
  document.getElementById("fixResumeBtn").addEventListener("click", enhanceResume);
  document.getElementById("downloadEnhancedBtn").addEventListener("click", downloadEnhancedResume);

  renderAnalysis(getSavedAnalysis());
  syncProfile();
});
