function getApiBase() {
  const override = localStorage.getItem("careerCompassApiBaseUrl");
  if (override) return override.replace(/\/$/, "");
  if (window.location.protocol === "file:") return "http://localhost:5000";
  if ((window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000") {
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return window.location.origin;
}

async function signup() {
  const API = getApiBase();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }

  try {
    const res = await fetch(`${API}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "Signup failed");
      return;
    }

    alert(data.message || "Verification code sent");
    window.location.href = `verify.html?email=${encodeURIComponent(data.email || email)}`;
  } catch {
    alert("Unable to reach the server. Please try again.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const signupBtn = document.getElementById("signupBtn");
  if (signupBtn) {
    signupBtn.addEventListener("click", signup);
  }
});
